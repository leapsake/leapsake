# Leapsake Encryption — Security Findings (adversarial review)

> **What this doc is.** A recorded *adversarial* code+design review of the shipped
> Stage-1/Stage-2 encryption and the blind relay — the "try to poke holes" pass, as
> opposed to [`security-review.md`](./security-review.md), which is the design review
> that *pins* the primitives and argues they meet the model's properties. This doc is
> the **backlog of holes found**: each with a severity, the concrete attack, the
> affected code, and a proposed mitigation, so a future agent can pick one up and fix
> it without re-deriving the analysis.
>
> **Relationship to the other docs.** [`model.md`](./model.md) is the *why*;
> [`security-review.md`](./security-review.md) §3 already lists several *accepted*
> residual risks — where a finding here overlaps one of those, it says so and only adds
> ranking/urgency. [`status.md`](../status.md) is the status oracle; the "Relay
> hardening" backlog there is the delivery home for the relay-side fixes.
>
> **Reviewed at:** commit `e7e3d36` (proxy-aware client-IP rate limiting), 2026-07-05.
> Scope: `packages/crypto`, `packages/data` (sync engine + transport + repos),
> `packages/key-custody` (`session.ts`), `packages/core` (`sync.ts`), `apps/server` (relay), both `KeyStore`
> adapters. **Not** a third-party cryptographic audit (that's still worth commissioning
> before a public at-scale launch — see `security-review.md` scope note).

## Verdict

The architecture is sound: envelope encryption + a KEK layer, the Argon2id→HKDF split
of KEK vs. auth verifier, hash-of-verifier storage with constant-time compares, per-row
`alg` versioning, namespacing by *authenticated* identity (never request body), AEAD
that fails closed, and a sync allowlist that excludes the key tables *by construction*.
No finding below requires reworking the model. The theme of the high-severity findings
is narrower and specific: **the "zero-knowledge against the relay" claim is currently
doing more work than the live-relay threat model supports** — against an honest-but-
curious operator, account confidentiality reduces to *one interactive-strength Argon2id
pass over a user password that the relay observes in cleartext on every request.*
Closing H1 + H2 is what makes the zero-knowledge claim actually true against the
adversary the model names (the untrusted server operator).

---

## HIGH

### H1 — The live relay is a standing offline password-cracking oracle

`security-review.md` §3 frames the offline-attack cost as arising "on a relay-store
leak," where only `sha256(verifier)` leaks. That understates it. The relay receives the
**raw auth verifier** in the `Authorization` header on *every* authenticated request
(`apps/server/src/relay.ts` `authenticate`, ~L166–191), and it permanently stores
`kdfSalt`, `wrap(MK, KEK)`, and the full ciphertext log. So a curious operator — or
anything sitting at TLS termination, or an access log that captures headers — need not
break any hash. They can run, entirely offline, per candidate password:

```
guess → Argon2id(guess, salt) → HKDF auth branch → compare to an OBSERVED verifier
     → on a hit, HKDF kek branch → unwrap wrap(MK, KEK) → decrypt the whole account
```

The zero-knowledge property against the relay therefore reduces exactly to *password
strength, stretched by one OWASP-interactive Argon2id pass*. The adversary here is the
relay the model designed to be **blind**, not merely a DB thief.

> **DECIDED (2026-07-05).** **OPAQUE is the chosen mitigation, gated on the hosted-relay
> era** (v0.1 sync is self-host-only, so the operator is the user's own choice); the
> Secret-Key pepper (mitigation 1 below) is **declined as a default** — it fully closes
> the hole but adds a second user-held secret (a known support burden that breaks
> password-only join); at most a much-later opt-in dial after passkeys. Full decision +
> the honest residual (a maximally malicious operator can still *actively* grind guesses
> under OPAQUE using its own OPRF key — only user-held entropy removes that) recorded in
> [`sync.md`](./sync.md) §4 *Auth-hardening decision*. Until then, H3's session tokens
> shrink the observation window to once-per-login.

- **Severity:** High for any relay not operated by the data owner themselves — which is
  the entire point of Tier 2 (untrusted operator).
- **Mitigations (escalating; see decision note above):**
  1. *Fully closes the hole, but declined as default:* a per-account **client-held Secret
     Key / pepper** mixed into the KDF input (1Password's model). The password alone stops
     being sufficient to derive the KEK, so an observed verifier is no longer a crackable
     oracle. Demotes H1 *and* M1 together — at the cost of a second user-held secret.
  2. *Medium:* **challenge–response** login — relay sends a nonce, client returns
     `HMAC(verifier, nonce)` — so the raw verifier never transits. Caveat: this makes
     the relay store the verifier (or an HMAC key) rather than its hash, trading against
     the store-leak property; weigh explicitly. (Superseded by the OPAQUE decision.)
  3. *Chosen:* an **aPAKE (OPAQUE)** — nothing crack-usable transits and a stolen store
     alone is not an oracle; also addresses replay (H3) and enumeration in one
     construction. Residual: an actively malicious operator can still grind offline with
     its own OPRF key — accepted; see the decision note.

### H2 — Online password guessing on `GET /accounts/bootstrap` is unthrottled

> **DONE (2026-07-05).** A third per-IP limiter now throttles **failed** authentications
> at `GET /accounts/bootstrap` (`DEFAULT_BOOTSTRAP_RATE_LIMIT` = 10/min, env
> `RELAY_BOOTSTRAP_RATE_LIMIT_MAX`/`_WINDOW_MS`). Only failures consume the budget, on its
> own counter, so a legitimate join/re-auth is never charged and the enumeration/recovery
> budgets are untouched. Per-IP only (per-account keying + lockout-with-recovery left as a
> tracked follow-up — it opens a lockout-DoS vector). Tested
> (`apps/server/test/relay.test.ts`: 401→401→429 + valid-bootstrap-unaffected +
> budget-independence) and `curl`-smoked. Code: `apps/server/src/{config,relay,index}.ts`.

The rate limiters cover the two unauthenticated enumeration routes and the two recovery
routes — but **not** `bootstrap`, which is the de-facto login endpoint
(`apps/server/src/relay.ts`, the `/accounts/bootstrap` handler, ~L371–388). The inline
rationale ("the authenticated routes aren't enumeration oracles, so aren't throttled")
misses that bootstrap is a *password* oracle: an attacker with a username gets
`accountId + salt` from the unauthed `lookup`, then grinds candidate passwords against
bootstrap with unlimited 401s. Each guess costs the attacker one Argon2id run and costs
the relay nothing to keep rejecting.

- **Severity:** High impact, trivial fix. A successful guess yields the verifier (full
  relay read/write for the account) **and** the KEK (via the `wrap(MK, KEK)` the same
  endpoint returns) → total account compromise.
- **Mitigation:** throttle failed authentications on `bootstrap` per-account **and**
  per-IP (the recovery routes already show the pattern — a stricter fixed window /
  backoff applied *before* the verifier check). Consider lockout-with-recovery or
  alerting on sustained failures. Reuse the existing `createRateLimiter` +
  `clientIp` seam.

### H3 — Bearer credential: replayable, non-expiring, non-rotatable, one-per-account; no TLS in-repo

Already acknowledged as deferred in `security-review.md` §3 ("Relay auth hardening
deferred"); ranked here for the backlog. The verifier is a forever-valid bearer sent on
every request, with **no device-scoped tokens, no expiry, no per-device revocation**
(revoking one device means a full password change). TLS is assumed at a termination
layer that does not exist in the repo, and `apps/server/src/index.ts` serves plain HTTP.

- **Severity:** High before any public / multi-user deployment; tolerable for the
  current internal slice *only if* it runs behind TLS the operator controls.
- **Mitigation:** the named follow-ups (TLS, challenge–response, device tokens) **plus**
  one addition that also shrinks H1: exchange the verifier once at login for a
  **short-lived session token**, and send that per request instead of the verifier —
  turning the H1 observation window from "every request, forever" into "once per login."
- **Status — session tokens DONE (2026-07-05).** The verifier is now exchanged once at
  `POST /accounts/session` (and folded into `GET /accounts/bootstrap`) for a short-lived,
  in-memory session token that authenticates the hot `push`/`pull` path via
  `Authorization: Session <token>`; the raw verifier no longer transits per-request
  (`apps/server/src/relay.ts`, `packages/sync/src/http-transport.ts`, TTL in
  `config.ts` / `RELAY_SESSION_TTL_MS`). The transport manages the lifecycle itself
  (login on first use / near expiry; re-login-and-retry on 401), so nothing above it
  changed.
- **Status — TLS DONE (2026-07-05).** The deploy gate is closed both ways (both shippable,
  orthogonal, composable): **Option A** — a TLS-terminating proxy in front, shipped as the
  `apps/server/Dockerfile` + root `docker-compose.yml` (relay + Caddy auto-TLS) + deploy
  docs; **Option B** — in-process TLS in the relay (`createRelayServer`'s `tls` option over
  `node:https`, env `RELAY_TLS_CERT`/`RELAY_TLS_KEY`). A production run with neither TLS nor
  a trusted proxy warns at startup. **Still open here:** per-device tokens / revocation and
  replay defense. Sessions are per-process in-memory, so a multi-node relay needs a shared
  session store — the same follow-up as the shared rate-limit counter (security-review.md §3).

---

## MEDIUM

### M1 — Argon2id m=19 MiB / t=2 is the interactive-login floor, but here it is the *encryption* strength

19 MiB / t=2 / p=1 is OWASP's minimum for sub-second interactive login. In this system
that same parameter is the *sole* stretch protecting at-rest and relay confidentiality
against an offline attacker (see H1). 19 MiB is cheap to attack at scale on GPU/ASIC.
The choice is defensible given pure-JS on Hermes, but the *documented* justification is
mobile UX, not resistance to an adversary holding the salt + an observed verifier.

- **Severity:** Medium; compounds H1.
- **Mitigation:** measure Hermes headroom and raise memory cost as far as mobile
  tolerates (many RN apps bear 46–64 MiB). `KDF_ALG` versioning already makes a bump a
  clean non-migrating change (`packages/crypto/src/kdf.ts`) — use it. Raising the cost is
  now the **primary** lever here: the H1-a pepper was declined as a default (see H1
  decision note), and even under OPAQUE this parameter still stretches a malicious
  operator's active grind — so it stays load-bearing.

### M2 — No key zeroization; master key is a long-lived plaintext `Uint8Array`

`KeySession.masterKey`, the derived KEK, and unwrapped content keys live in ordinary JS
`Uint8Array`s for the process lifetime (`packages/key-custody/src/session.ts`,
`packages/data/src/content-cipher.ts`). Nothing wipes them; in V8/Hermes you cannot
reliably anyway (GC copies/interns). `security-review.md` discusses zeroization only for
the future SSR path, not the native clients that hold MK indefinitely today.

- **Severity:** Medium — matters for memory-dump / swap / crash-report exposure on an
  already-compromised device; largely unavoidable in a GC'd runtime.
- **Mitigation:** best-effort `.fill(0)` on the **KEK** and transient wrap keys right
  after use (the KEK is derived then used once in `enableSync` / `unlock*` — easy to
  wipe); document MK residency as an accepted limit; keep Stage-2 at-rest encryption as
  the real device-theft mitigation. Audit error/log paths so no key-bearing object is
  ever stringified into a log or crash report.

### M3 — A hostile/buggy relay can stall the pull loop with a short ciphertext (convergence DoS)

> **DONE (2026-07-05).** Both halves of the proposed mitigation shipped: (a) `open()`
> (`packages/crypto/src/wrap.ts`) length-guards `sealed.length < NONCE_BYTES + TAG_BYTES`
> and throws `"sealed blob too short"` before the `subarray`; (b) `SyncEngine.pull()`
> (`packages/sync/src/engine.ts`) wraps each record's decode/decrypt/apply in
> try/catch that **skips-and-logs** (`console.warn`) instead of aborting the batch, and the
> cursor still advances to the batch high-water mark, so a poison row is pulled once,
> skipped, and never re-seen — breaking the permanent stall. `applied` now counts only
> rows actually applied. Tested (`wrap.test.ts` too-short-blob; `relay.test.ts` E2E: a
> garbage-ciphertext record injected onto the relay is skipped while the valid record still
> converges, non-vacuously verified).

`open` / `unwrapKey` (`packages/crypto/src/wrap.ts`, L44) does `sealed.subarray(0, 24)`
then decrypts the remainder, with no minimum-length guard. The relay accepts any base64
for `ciphertext` / `wrappedKey` (`apps/server/src/relay.ts` `wireRecordSchema`, ~L79–86)
and stores it blindly. A peer then pulls it and calls `open()` in the sync engine
(`packages/sync/src/engine.ts` `pull`, L109) inside a loop with **no per-record
try/catch** — so one malformed record throws and aborts the *entire* batch, and it will
re-throw on every subsequent pull. That is a targeted denial of *convergence*, injected
by a compromised relay or a single corrupt row. (It is not a confidentiality break — AEAD
still fails closed.)

- **Severity:** Medium.
- **Mitigation:** (a) length-guard `open` — throw a typed "sealed blob too short" before
  `subarray` when `sealed.length < NONCE_BYTES + 16`; (b) wrap the per-record
  decode/apply in `engine.ts` `pull()` in try/catch that **skips-and-logs** a record
  that fails to decrypt/parse rather than aborting the batch. (b) also stops a genuinely
  corrupt row from poisoning sync permanently.

### M4 — On-device recovery-phrase entry has no local backpressure

The relay throttles the recovery routes well, but on-device `unlockWithRecoveryKey`
(`packages/key-custody/src/session.ts`) and the phrase-entry UI gate access to MK with no
attempt limiting. Less severe than the password path because the phrase is 256-bit, but
the asymmetry is worth noting: passwords get a 12-char floor + Argon2id, the recovery
path gets neither locally.

- **Severity:** Low–Medium; defense-in-depth.
- **Mitigation:** a small local delay / backoff on repeated failed phrase entry.

---

## LOW / accepted (recorded for completeness)

These are either already documented as accepted in `security-review.md` §3 / `model.md`
§12, or minor platform notes. Listed so a future reader doesn't re-flag them as new.

- **Username enumeration** via `lookup` + the registration 409 — intrinsic to
  username+password zero-knowledge login; throttled; accepted in `security-review.md` §3.
- **Metadata leakage** (record counts, blob sizes, sync timing, who-shares-with-whom) —
  explicitly out of scope for V3 (`model.md` §12). Revisit before "privacy-first"
  marketing at scale.
- **Single-node in-memory rate limiter** — a multi-node relay needs a shared counter or
  the throttles collapse; already the open §3 limiter follow-up in `status.md`.
- **`safeStorage` weak backend on Linux** — `safeStorage.isEncryptionAvailable()`
  (`apps/desktop/src/main/keystore/safe-storage-keystore.ts`) returns `true` even when
  Electron falls back to the weak `basic_text` backend (no real OS keyring present). The
  enclave secret is then only lightly protected at rest. Worth a platform note / warning;
  the secret is only as safe as the OS keyring actually present.
- **`AFTER_FIRST_UNLOCK` on mobile** (`apps/mobile/keystore/secure-store-keystore.ts`)
  keeps the enclave secret readable to background sync after the first post-boot unlock —
  a deliberate, reasonable trade, but it means at-rest-after-first-unlock protection
  leans entirely on the OS lockscreen. Name it as an accepted limit.

---

## Suggested fix order (before anyone else's data touches the relay)

1. ~~**H2** — throttle `bootstrap` auth failures.~~ **Done (2026-07-05).** Closed the open
   *online* guessing door. Pure relay change.
2. ~~**M3** — length-guard `open` + per-record try/catch in `pull`.~~ **Done (2026-07-05).**
   Closed the relay-driven convergence DoS and hardened against corrupt rows.
3. **H3** — require TLS + move to short-lived session tokens. Deployment gate: do not run
   `index.ts` on plain HTTP anywhere real. Also shrinks H1's observation window to
   once-per-login.
4. **H1 — via OPAQUE** (decided 2026-07-05, `sync.md` §4): required before the official/
   hosted relay era; not a v0.1 gate since v0.1 sync is self-host-only. The H1-a pepper is
   declined as a default (opt-in dial at most, after passkeys).

M1 (raise Argon2 cost), M2, M4, and the LOW items are legitimately post-launch / larger,
but should be tracked so the zero-knowledge claim and the roadmap stay honest with each
other.
