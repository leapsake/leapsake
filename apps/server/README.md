# @leapsake/server

The Leapsake **blind sync relay** — the V3 transport host behind zero-knowledge
sync. It is deliberately the "least clever option"
([`plans/encryption/sync.md`](../../plans/encryption/sync.md) §2): a `node:http` +
`node:sqlite` + `node:crypto` service that stores and serves opaque,
already-encrypted records. It ships as a single esbuild bundle with **no runtime
`node_modules`** (only Node built-ins) — `zod`, `proxy-addr`, and the workspace
packages are inlined at build time.

It can read, merge, or order **nothing** about content — it stores ciphertext +
cleartext sync metadata (UUIDs, `updated_at`, `deleted_at`) in a per-account
append log whose autoincrement `seq` **is** the opaque delivery cursor. The relay
store is its own schema, independent of the clients' `packages/data` migrations.

## Who is expected to run this, and when *(decided 2026-07-05)*

The hosting strategy is **incremental and reversible**, and this package is step one:

1. **Self-hosted relay (v0.1).** There is **no hosted relay at v0.1** — multi-device sync users
   run this themselves. Single-device use needs no server at all and remains the
   layperson-complete path.
2. **An official paid hosted relay**, later. Before it can store other people's data it needs
   the hosted-relay gate in [`plans/v0-2.md`](../../plans/v0-2.md): OPAQUE login, server-escrow
   recovery as an opt-in dial, quotas / registration-token enforcement, and a shared
   cross-process rate-limit counter.
3. **User-customizable / BYO storage**, as the endgame.

*Mantra: simplicity and security first, followed closely by total customizability.*

The design already optimizes the layperson flow, so **nothing needs reworking when the hosted
relay arrives** — it is a deployment change, not an architecture change.

⚠️ **Backup is a capability this relay advertises, not a promise clients assume.** The relay is
designed to be disposable, and not every operator will keep a durable copy. Clients ask, and
**absent an answer they assume none** — which is why a last-device forget is worded as deletion.
See [`@leapsake/key-custody`](../../packages/key-custody/README.md).

## Auth (blind)

Two credentials, one durable and one short-lived (threat H3 below). The
durable **verifier** is sent as `Authorization: Bearer <accountId>.<b64(authVerifier)>`
to the two login endpoints only (`POST /accounts/session`, `GET /accounts/bootstrap`);
the relay persists just `sha256(verifier)`, constant-time-compares it, and namespaces
records by the **authenticated** identity (never the request body). Each login mints a
random, short-lived **session token** (`Authorization: Session <token>`) that carries
the hot `push`/`pull` path — so the raw verifier transits _once per login_, not per
request. Sessions are in-memory and per-process (ephemeral; a restart costs each device
one silent re-login). A bad/absent credential is `401`.

Because the verifier is HKDF-independent of the KEK
([`packages/crypto`](../../packages/crypto/README.md)), the relay authenticates a device
without ever holding anything that could unwrap the master key. The auth model and its
accepted residual risks are in
[`plans/encryption/security-review.md`](../../plans/encryption/security-review.md); the
attacks it is built against are the register below.

## Threat register

Four attacks found by an adversarial review of the shipped relay + client on
**2026-07-05**, kept here because the code cites them by id and a reader needs one
place to look them up. Three are closed; the open one is scoped to a tier that does
not exist yet.

| Id     | The attack                                                                                                                                                                                             | Where it stands                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** | The relay observes the raw auth verifier and stores `kdfSalt` + `wrap(MK, KEK)`, so an operator can crack passwords **entirely offline** and decrypt the account. Zero-knowledge reduces to password strength. | **Open, gated.** Sessions (H3) cut the observation window to once per login; OPAQUE closes it and is required before any hosted tier — [`plans/v0-2.md`](../../plans/v0-2.md) → *Hosted-relay gate*. |
| **H2** | `GET /accounts/bootstrap` is the de-facto login endpoint, so unlimited 401s let an attacker with a username grind passwords online. A hit yields the verifier **and** the KEK.                              | **Closed.** A third per-IP throttle charges only *failed* logins, on its own counter (`RELAY_BOOTSTRAP_RATE_LIMIT_MAX`); `relay.test.ts` asserts 401→401→429 and budget independence. |
| **H3** | The verifier was a forever-valid bearer on every request — replayable, non-expiring, one per account — and nothing in the repo terminated TLS.                                                          | **Closed for transit.** Session tokens (`POST /accounts/session`) plus both TLS options above. **Still open:** per-device tokens + revocation, and a shared session store for multi-node. |
| **M3** | A hostile or buggy relay can serve a too-short ciphertext; `open()` had no length guard and `pull()` no per-record try/catch, so one bad row aborted every batch forever — a denial of *convergence*.      | **Closed, client-side.** `open()` length-guards before the `subarray` (`packages/crypto`) and `pull()` skips-and-logs a poison record while the cursor still advances (`packages/sync`). |

Findings that are not about the relay live with the code they constrain: the
Argon2id cost in [`packages/crypto`](../../packages/crypto/README.md), master-key
residency and recovery-phrase backpressure in
[`packages/key-custody`](../../packages/key-custody/README.md) and
[`plans/v0-2.md`](../../plans/v0-2.md).

## Routes (`src/relay.ts`)

| Route                            | Auth                        | Purpose                                                                                           |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /accounts`                 | optional registration token | register `{ accountId, username, authVerifier, kdfSalt, wrappedMasterKey }`; dup username → `409` |
| `GET /accounts/lookup?username=` | none (prelogin)             | → `{ accountId, kdfSalt }` \| `404`                                                               |
| `POST /accounts/session`         | verifier bearer             | → `{ token, expiresAt }` — mint a short-lived session                                             |
| `GET /accounts/bootstrap`        | verifier bearer             | → `{ wrappedMasterKey, token, expiresAt }` for a joining device                                   |
| `POST /sync/push`                | session                     | append `{ records }` to the account log                                                           |
| `GET /sync/pull?since=<cursor>`  | session                     | → `{ records, cursor }`                                                                           |

The unauthenticated endpoints are per-IP rate-limited (`RateLimit`, env-tunable) as
the username-enumeration mitigation; the recovery-authed endpoints
(`/accounts/recovery`, `/accounts/reset`) carry a separate, stricter throttle; and
**failed** logins at the two verifier-checking endpoints share a third throttle
(the online-guessing mitigation, H2/H3). Defaults and env-var names are centralized
in `src/config.ts`.

## Running

**Dev** — TypeScript straight from source via `tsx`:

```sh
PORT=4000 pnpm --filter @leapsake/server dev   # add RELAY_DB=:memory: for a throwaway store
```

**Production** — the relay bundles to a single self-contained ESM file
(`dist/index.mjs`) with **no runtime `node_modules`**: esbuild inlines `zod`,
`proxy-addr`, `@noble/ciphers`, and the workspace packages, leaving only Node
built-ins external (`node:http`, `node:sqlite`, `node:crypto`). This is what the
container image runs.

```sh
pnpm --filter @leapsake/server build   # → dist/index.mjs
pnpm --filter @leapsake/server start   # node dist/index.mjs
```

## Deploy (self-host)

Self-hosting is the v0.1 sync path. The relay is content-blind, so _running_ one is
low-stakes — but it must sit behind **TLS**: never serve it on plain HTTP anywhere real
(TLS protects the wire, including each device's one-per-login verifier). There are two
ways to terminate TLS; they're independent and compose freely:

- **Option A — TLS in front (recommended, the default).** A reverse proxy
  (Caddy/nginx/a load balancer) terminates HTTPS and forwards to the relay, which speaks
  plain HTTP on a private network. Lowest effort — Caddy auto-provisions and auto-renews
  Let's Encrypt certs. This repo ships a turnkey Caddy setup (below).
- **Option B — TLS in the relay.** Set `RELAY_TLS_CERT` + `RELAY_TLS_KEY` (PEM file paths;
  `RELAY_TLS_KEY_PASSPHRASE` for an encrypted key) and the relay speaks HTTPS directly, no
  proxy. For self-hosters who'd rather not run one; you own cert acquisition + renewal.
  Quickstart below.
- **A + B together** is meaningful only when the proxy and relay run on **different hosts**
  (it also encrypts that hop); on a single host it's redundant-but-harmless.
- **Neither** (plain HTTP, nothing in front) is dev/loopback only — the relay warns at
  startup if it's run in production (`NODE_ENV=production`) with neither TLS nor a trusted
  proxy set.

### Quickstart — Option A with Docker + Caddy

From the repo root, with a DNS record pointing your domain at the host:

```sh
RELAY_DOMAIN=relay.example.com ACME_EMAIL=you@example.com docker compose up -d --build
```

Caddy fetches a certificate and reverse-proxies HTTPS → the relay; point clients at
`https://relay.example.com`. The blind append-log persists in the `relay-data` volume;
certs persist in `caddy-data`.

The relay image is standalone (one bundled file, no `node_modules`). To build it alone:

```sh
docker build -f apps/server/Dockerfile -t leapsake-relay .
```

### Quickstart — Option B with in-process TLS (no proxy)

Point the relay at a cert + key and it terminates HTTPS itself. Bring your own
certificate (e.g. `certbot certonly`); the relay does not fetch or renew certs. Running
the image directly, with the certs and store mounted in:

```sh
docker run -d --name leapsake-relay -p 443:443 \
  -e PORT=443 \
  -e RELAY_TLS_CERT=/tls/fullchain.pem \
  -e RELAY_TLS_KEY=/tls/privkey.pem \
  -v /etc/letsencrypt/live/relay.example.com:/tls:ro \
  -v leapsake-relay-data:/data \
  leapsake-relay
```

Point clients at `https://relay.example.com`. Set both `RELAY_TLS_CERT` and
`RELAY_TLS_KEY` or neither — exactly one is a fatal misconfiguration. (No front proxy
means no `X-Forwarded-For`, so leave `RELAY_TRUSTED_PROXIES` unset; the rate limiters key
on the real socket IP.)

### Configuration

All knobs are env vars, centralized in [`src/config.ts`](./src/config.ts):

| Env                                             | Default        | Purpose                                                                                                                                                            |
| ----------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                                          | `4000`         | HTTP listen port                                                                                                                                                   |
| `RELAY_DB`                                      | `relay.db`     | store path, or `:memory:`                                                                                                                                          |
| `RELAY_TRUSTED_PROXIES`                         | _(none)_       | comma-separated proxy IPs / CIDRs / `proxy-addr` presets (`loopback`, `uniquelocal`) so rate limiters see the real client IP — **set this in any Option A deploy** |
| `RELAY_REGISTRATION_TOKEN`                      | _(none)_       | if set, `POST /accounts` requires a matching `X-Registration-Token`; unset ⇒ open relay                                                                            |
| `RELAY_SESSION_TTL_MS`                          | `3600000`      | session-token lifetime (1h)                                                                                                                                        |
| `RELAY_TLS_CERT` / `RELAY_TLS_KEY`              | _(none)_       | PEM file paths for in-process TLS (Option B); set **both** to speak HTTPS, or neither for plain HTTP behind a proxy                                                |
| `RELAY_TLS_KEY_PASSPHRASE`                      | _(none)_       | passphrase for an encrypted `RELAY_TLS_KEY`                                                                                                                        |
| `RELAY_RATE_LIMIT_MAX` / `_WINDOW_MS`           | `60` / `60000` | unauthenticated-endpoint throttle                                                                                                                                  |
| `RELAY_RECOVERY_RATE_LIMIT_MAX` / `_WINDOW_MS`  | `10` / `60000` | recovery-endpoint throttle                                                                                                                                         |
| `RELAY_BOOTSTRAP_RATE_LIMIT_MAX` / `_WINDOW_MS` | `10` / `60000` | failed-login throttle (bootstrap + session)                                                                                                                        |

### Backups

At-rest encryption makes each _client's_ store the source of truth; the relay holds only
ciphertext. Losing `relay.db` costs at most one re-join per device (sync.md §2), but back
up the `relay-data` volume anyway to avoid that friction.

### A note on password strength (self-host honesty)

The v0.1 auth uses a username + password verifier. A relay operator who is _actively
malicious_ could attempt offline guesses against a weak account password (the H1 residual,
fully closed later by OPAQUE at the hosted-relay tier). On a self-hosted relay the operator
is you or someone you chose to trust — but **use a strong password** regardless. Details:
[`plans/encryption/sync.md`](../../plans/encryption/sync.md) §4.

> **Still ahead** before a public, at-scale relay: per-device tokens + revocation, replay
> defense, and a shared cross-process session + rate-limit store for multi-node — the open
> half of H3, tracked in [`plans/v0-2.md`](../../plans/v0-2.md).
