# @leapsake/server

The Leapsake **blind sync relay** — the V3 transport host behind zero-knowledge
sync. It is deliberately the "least clever option"
([`plans/encryption/sync.md`](../../plans/encryption/sync.md) §2): a `node:http`

- `node:sqlite` + `node:crypto` service (zero runtime deps beyond `zod`; `tsx`
  only to run it) that stores and serves opaque, already-encrypted records.

It can read, merge, or order **nothing** about content — it stores ciphertext +
cleartext sync metadata (UUIDs, `updated_at`, `deleted_at`) in a per-account
append log whose autoincrement `seq` **is** the opaque delivery cursor. The relay
store is its own schema, independent of the clients' `packages/data` migrations.

## Auth (blind)

`Authorization: Bearer <accountId>.<b64(authVerifier)>`. The relay persists only
`sha256(verifier)`, constant-time-compares it, and namespaces records by the
**authenticated** identity (never the request body) — a bad/absent bearer is
`401`. Because the verifier is HKDF-independent of the KEK
([`packages/crypto`](../../packages/crypto/README.md)), the relay authenticates a
device without ever holding anything that could unwrap the master key. The auth
model and its accepted residual risks are in
[`plans/encryption/security-review.md`](../../plans/encryption/security-review.md).

## Routes (`src/relay.ts`)

| Route                            | Auth                        | Purpose                                                                                           |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /accounts`                 | optional registration token | register `{ accountId, username, authVerifier, kdfSalt, wrappedMasterKey }`; dup username → `409` |
| `GET /accounts/lookup?username=` | none (prelogin)             | → `{ accountId, kdfSalt }` \| `404`                                                               |
| `GET /accounts/bootstrap`        | bearer                      | → `{ wrappedMasterKey }` for a joining device                                                     |
| `POST /sync/push`                | bearer                      | append `{ records }` to the account log                                                           |
| `GET /sync/pull?since=<cursor>`  | bearer                      | → `{ records, cursor }`                                                                           |

The unauthenticated endpoints are per-IP rate-limited (`RateLimit`, env-tunable)
as the username-enumeration mitigation; the recovery-authed endpoints
(`/accounts/recovery`, `/accounts/reset`) carry a separate, stricter throttle.
Defaults and env-var names are centralized in `src/config.ts`.

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

> **Hardening still ahead** before a public, at-scale relay: TLS termination,
> challenge–response to defeat bearer replay, device-scoped tokens, and a
> proxy-aware / shared rate limiter. Tracked in the encryption status oracle and
> `security-review.md`.
