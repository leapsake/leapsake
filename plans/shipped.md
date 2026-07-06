# Leapsake — Shipped increments (the archive)

> **What this file is.** The detailed build narratives for *finished* increments, moved
> out of [`status.md`](./status.md) so the oracle stays lean. **Do not read this file to
> pick up new work** — read `status.md`. Load a section here only when you need the
> history, verification record, or decision detail of a specific finished increment.
> (Durable *lessons* belong in [`AGENTS.md`](../AGENTS.md) or a package README; durable
> *design* belongs in the design docs; this is delivery history that was too useful to
> lose to git archaeology alone.)

**Index**

- [Encryption + sync — Stage 1 (the zero-knowledge core)](#encryption--sync--stage-1-the-zero-knowledge-core)
- [Encryption + sync — Stage 2 (at-rest, desktop)](#encryption--sync--stage-2-at-rest-encryption-desktop)
- [Encryption + sync — Stage 2 (at-rest, mobile)](#encryption--sync--stage-2-at-rest-encryption-mobile)
- [Encryption + sync — recovery phrase](#encryption--sync--recovery-phrase-make-the-recovery-key-a-real-lifeline)
- [Encryption + sync — device re-auth after a remote password reset](#encryption--sync--device-re-auth-after-a-remote-password-reset)
- [Relay hardening — landed items](#relay-hardening--landed-items)
- [Reconciliation (dedup & merge)](#reconciliation-dedup--merge)
- [Testing — the `SqliteDriver` contract suite](#testing--the-sqlitedriver-contract-suite-keystone-backlog-steps-12)
- [Testing — the mobile native self-test](#testing--the-mobile-native-self-test-keystone-backlog-step-3a)
- [Verification record — recovery phrase](#verification-record--recovery-phrase-complete)
- [Issues found & fixed during verification](#issues-found--fixed-during-verification)

---

## Encryption + sync — Stage 1 (the zero-knowledge core)

Everything below is in code with module-level doc comments; this is the index. Design lives
in [`encryption/`](./encryption/) (`model.md` for the why, `sync.md` for transport/merge,
`schema.md` for the key tables, `custody-sequence.md` for the key lifecycle).

- **Crypto & keys** — `packages/crypto` (XChaCha20-Poly1305 seal/wrap; the Argon2id→HKDF
  password door splitting a KEK + auth verifier; salt/recovery-key minting) + the `KeyStore`
  port and its desktop (`safeStorage`) / mobile (`expo-secure-store`) adapters. Params pinned
  in [`encryption/security-review.md`](./encryption/security-review.md) +
  [`packages/crypto/README.md`](../packages/crypto/README.md). Key tables: migration 11
  (`content_key` + `key_wrap`), migration 14 (`account` + `device`).
- **Content encryption** — `ContentCipher` wired into the milestones repo: `milestone.note`
  is encrypted at rest under a per-item content key (migration 12), the first encrypted field.
  Extending to more fields is a per-repo change, not new mechanism.
- **Sync engine** — whole-row **LWW merge** + tombstones (`resolveMerge`); a registry-driven
  `SyncEngine` over a `SyncTransport` port where **every entity is one `defineSyncable` call**
  behind an opt-in allowlist (guard test excludes the device-local key/`sync_state` tables);
  durable watermarks (`sync_state`, migration 13) so it resumes after restart.
- **The blind HTTPS relay** — `createHttpSyncTransport` + `apps/server` (see
  [`apps/server/README.md`](../apps/server/README.md)); two devices converge over the wire
  through a host that stores only ciphertext.
- **Background sync** — `createSyncScheduler` drives sync from real events (write → debounced
  push; foreground/focus → pull; launch/enable/join) with a long backstop interval;
  **reactive invalidation** refreshes the current screen on an applied pull; an **auto-sync
  toggle** (per-client, default ON, never replicates) gates *automatic* sync while manual
  "Sync now" keeps working.
- **Multi-device account login** — join model is **username + password** (decided; rationale
  in [`encryption/sync.md`](./encryption/sync.md)). Built across the relay bootstrap channel
  (`/accounts`, `/accounts/lookup`, `/accounts/bootstrap`; migration 15), core `joinAccount`
  (fetch + unwrap MK → adopt under this device's enclave), a shared core sync assembly
  (`packages/core/src/sync.ts`), and the desktop + mobile UI (combined identity-first flow,
  "Sync now", "Disconnect account", recovery-key reveal, 12-char floor, "no password reset"
  copy, relay per-IP rate limiting).

## Encryption + sync — Stage 2 (at-rest encryption, desktop)

Whole-DB encryption on desktop (`model.md` §8): the on-disk `leapsake.db` is now ciphertext,
decrypted into memory only while the process holds the device's whole-DB key. Search, kinship,
and timelines are untouched — they still run on in-memory plaintext. A backend swap behind the
existing `SqliteDriver` port, with **zero edits above the driver**.

- **Backend decision (spiked):** `better-sqlite3-multiple-ciphers` (SQLite3-Multiple-Ciphers,
  SQLCipher-compatible) over a WASM build — it is the only maintained, batteries-included
  encrypted SQLite for Node/Electron, ships prebuilt binaries for **both** Node (Vitest) and
  Electron (the app) so there is no node-gyp compile, and is synchronous (a near drop-in for the
  old `node:sqlite` driver). This reintroduces a native addon — the cost `node:sqlite` was chosen
  to avoid — **accepted** for at-rest; mitigated by prebuilds + an automatic ABI guard
  (`scripts/ensure-sqlite-abi.mjs`, via `prebuild-install`) wired into `dev`/`start`/`test` so the
  one native binary flips between the Electron and Node (Vitest) ABIs with no manual `rebuild` step.
- **Whole-DB key custody:** a random 256-bit key minted once on first launch and held **only** in
  the OS enclave via the `KeyStore` (`db-key`), supplied at open time. It is deliberately **not** a
  `key_wrap` row — that table lives inside the encrypted DB (chicken-and-egg) — and is orthogonal to
  the in-DB master-key hierarchy (at-rest protects the *file*; per-item content keys live *inside*).
- **Existing-data upgrade:** a pre-Stage-2 plaintext file is detected by its `SQLite format 3`
  header and re-keyed in place on first launch, keeping the original as `leapsake.db.plaintext.bak`.
  Idempotent; a no-op for fresh installs and already-encrypted files.
- Code: `apps/desktop/src/main/db/{encrypted-sqlite-driver,plaintext-migration}.ts`;
  the old plaintext `node-sqlite-driver.ts` is removed. Tests run under Vitest's Node ABI and prove
  ciphertext-at-rest, wrong-key rejection, BLOB round-trip, and the plaintext→encrypted migration.
  `packages/data` integration tests stay on `node:sqlite` `:memory:` (encryption is a driver concern).
- The whole-DB key custody helper (`ensureDatabaseKey`, `DATABASE_KEY`, the SQLCipher
  `rawKeyLiteral`) now lives in **`packages/crypto/src/database-key.ts`** — shared by both clients
  rather than desktop-local (its doc always anticipated this lift). Its unit test moved to
  `packages/crypto/test/`.

## Encryption + sync — Stage 2 (at-rest encryption, mobile)

The same whole-DB at-rest property on mobile, mirroring desktop's pattern: the on-disk
`leapsake.db` is now ciphertext, decrypted into memory only while the app holds the device's
whole-DB key. Search/kinship/timelines untouched (in-memory plaintext, as on desktop).

- **Backend decision (verified, not spiked):** **expo-sqlite's own native SQLCipher** —
  v56 ships the `useSQLCipher` config-plugin build flag, which vendors the SQLCipher amalgamation
  (`-DSQLITE_HAS_CODEC=1 -DSQLCIPHER_CRYPTO_CC`, Apple CommonCrypto on iOS). So this is a
  **key-supply change on the engine already in use** — `expoSqliteDriver` is reused **unchanged**
  — not a new driver or a `@op-engineering/op-sqlite` dependency.
- **Whole-DB key custody:** identical pattern to desktop — `ensureDatabaseKey` (now shared, from
  `@leapsake/crypto`) mints a random 256-bit key once and holds it **only** in `expo-secure-store`
  (the OS enclave), supplied at open time via `PRAGMA key` as the **first** statement on the fresh
  connection, before migrations (SQLCipher requires it precede all DB access). Orthogonal to the
  in-DB master-key hierarchy.
- **No plaintext→encrypted migration** (deliberate): v0.1 is pre-launch, so mobile installs are
  dev/test only — fresh installs get a fresh encrypted DB; dev devices reinstall. (Desktop's
  `plaintext-migration.ts` is intentionally **not** ported; if ever needed, SQLCipher wants the
  `sqlcipher_export()`/ATTACH idiom, not desktop's `PRAGMA rekey`.)
- **Dev runtime moved off Expo Go to a local custom dev client** — SQLCipher is a native build
  flag, so Expo Go (which bundles only stock modules) can't host it; *any* at-rest backend forces
  this. Built locally with `expo prebuild` + `expo run:ios`/`run:android` (stock Xcode/Gradle),
  **no EAS / no cloud** — `prebuild` emits standard, fully-regenerable `ios/`/`android/` projects
  (gitignored; `app.json` + plugins stay the source of truth). Added `expo-dev-client`; dev scripts
  now use `--dev-client` / `run:ios` / `run:android`.
- Code: `apps/mobile/lib/core-context.tsx` (key supply in bootstrap), `apps/mobile/app.json`
  (`useSQLCipher` plugin), `apps/mobile/package.json` + `.gitignore`. No Node-runnable test is
  possible (mobile SQLCipher is a native iOS/Android module, unlike desktop's Node-ABI binary);
  **verified on an Android emulator** — the dev client built with the SQLCipher amalgamation,
  booted, keyed the DB, ran all migrations, and the on-disk `leapsake.db` is ciphertext (first
  bytes random, not the `SQLite format 3` magic). **iOS verified too (2026-06-24):** the local
  toolchain was upgraded to **Xcode 26.5 / Swift 6.2** (clearing the prebuilt `ExpoModulesJSI`
  requirement of RN 0.85 / Expo 56 that previously blocked the iOS dev-client build on Xcode 16.2 /
  Swift 6.0), the iOS 26.5 simulator runtime installed, and a clean `expo prebuild` + `expo run:ios`
  produced a green native build (SQLCipher dev client compiled, signed, installed, launched, and
  the JS bundle loaded) on the iPhone 16 Pro (iOS 26.5) simulator. So **both iOS and Android are
  verified first-class native targets** — the shared code path is platform-identical.

## Encryption + sync — recovery phrase (make the recovery key a real lifeline)

The recovery key was previously inert: minted at `enableSync`, shown once as base64, wired to
nothing. This increment makes one **24-word recovery phrase** recover **both** at-rest loss
events, and is the unifying decision behind the design: `enableSync` now **reuses the device's
enclave recovery key** (minted at first launch) instead of generating a fresh one, so the same
phrase opens the local file *and* the account. Design context in the plan
`~/.claude/plans/read-plans-readme-md-make-a-inherited-dragonfly.md` and [`encryption/model.md`](./encryption/) §6.

- **Stage A — encoding (verified).** `@scure/bip39` in `packages/crypto`;
  `recovery-phrase.ts` = `encodeRecoveryPhrase`/`decodeRecoveryPhrase` (tolerant parse +
  BIP39 checksum, so a mangled paste fails with a friendly message, not an opaque AEAD error).
  Both clients' one-time reveal renders a numbered 24-word grid. Unit-tested.
- **Stage B — single-device recovery.** New enclave secret
  `recovery-key` (`packages/crypto/src/recovery.ts`: `ensureRecoveryKey`,
  `sealDbKeyForRecovery`/`openDbKeyFromRecovery`, `LSKR1` versioned blob) wraps the **db-key**
  into a sidecar *outside* the encrypted DB, so a lost OS keychain can be recovered with the
  phrase. Desktop: `apps/desktop/src/main/db/open.ts` (3-case boot: normal / fresh+plaintext /
  keychain-loss recovery; sidecar `leapsake.db.recovery`; rewritten every boot so key-adoption
  self-heals) — **Node-ABI tested against the real encrypted engine** (`apps/desktop/test/open.test.ts`).
  Mobile: sidecar in a *second, unencrypted* expo-sqlite DB `leapsake-recovery.db`
  (`apps/mobile/db/recovery-sidecar.ts`) — chosen to avoid adding a native filesystem dep (no
  new prebuild). Boot recovery prompt: desktop `RecoveryGate` + `window.boot` bridge
  (`preload/index.ts`, `main.tsx`, `main/index.ts` boot restructure — window now created
  *before* the DB opens); mobile `RecoveryGate` in `core-context.tsx`. "Reveal recovery
  phrase" added to Settings on both (works for non-sync local-only users too).
- **Stage C — cross-device recovery.** `deriveRecoveryVerifier`
  (HKDF branch of the recovery key, `packages/crypto/src/kdf.ts`). The relay now escrows
  `wrap(MK, recoveryKey)` + `sha256(recoveryVerifier)` (`apps/server` `store.ts` columns +
  `ALTER TABLE` for existing DBs; `relay.ts` `GET /accounts/recovery` + `POST /accounts/reset`
  behind a distinct `Authorization: Recovery …` scheme). `recoverAccount` /
  `recoverAccountViaRelay` (`packages/core`): look up → fetch escrow → unwrap MK → **set a new
  password** (reset on the relay) → adopt MK + the account recovery key locally. Transport:
  `fetchRecovery`/`resetCredentials` (`packages/data/src/http-sync-transport.ts`). UI: "Recover
  with recovery phrase" in the login flow (`RecoverStep`) + `sync.recover` IPC/SyncApi on both
  clients. **End-to-end test** (`apps/server/test/relay.test.ts`) proves a fresh device
  recovers MK from the phrase, reads device-1's data, and the new password unlocks locally;
  plus wrong-phrase rejection.

## Encryption + sync — device re-auth after a remote password reset

Closes the gap the recovery-phrase increment opened: a recovery resets the account password,
which rotates the account's `kdfSalt` + `authVerifier` on the relay, so *other* devices' stored
credential goes stale and their background sync starts failing with **401** — previously a raw
`"failed: 401"` with no recovery path short of Disconnect + rejoin. Re-auth is **"re-join an
account you are already on"**: it reuses the join machinery but *updates* the local account row
and skips device registration. **The master key is never touched** (it stays in the enclave);
only the password-derived door is refreshed. No relay write.

- **Core** — `reauthenticate` (`packages/core/src/key-session.ts`): `lookup` the rotated salt →
  `deriveKeyMaterial` → `fetchBootstrap` (the relay's verifier gate **401s a wrong password
  before any unwrap**) → assert the recovered MK equals this device's enclave MK (defense in
  depth) → atomically `accountRepo.updateCredentials` + re-wrap the local `password` door.
  `reauthenticateViaRelay` + `isRelayAuthError` (`sync.ts`) wrap it for the clients;
  `AccountRepo.updateCredentials` (`packages/data`) is the new singleton-row update.
- **Clients** — the sync-activity payload gained `needsReauth`; both schedulers' `onError`
  flag a 401 via `isRelayAuthError`, and Settings shows a "your password was changed on another
  device — re-enter it to reconnect" prompt wired to a new `sync.reauthenticate(password)`
  (desktop IPC `sync:reauthenticate` + preload bridge; mobile `SyncApi.reauthenticate`). A
  success kicks a sync so the device reconnects immediately.
- **Tests** — `apps/server/test/relay.test.ts` proves an end-to-end reset → 401 → re-auth →
  converge (plus a wrong-password rejection that leaves the local credential untouched);
  `packages/core/test/reauthenticate.test.ts` unit-tests the credential rotation, password-door
  re-wrap, MK-unchanged, and different-account refusal.

## Relay hardening — landed items

The findings backlog is [`encryption/security-findings.md`](./encryption/security-findings.md);
the remaining items are tracked in [`status.md`](./status.md). Landed so far:

- **Session tokens (H3, the session half) — done (2026-07-05).** The password-derived verifier
  was a forever-valid bearer sent on *every* `push`/`pull`, so the relay observed it on every
  request — the H1 exposure H3 shrinks. Now the verifier is exchanged **once per login** for a
  short-lived session token: a new `POST /accounts/session` (verifier-authed) mints a random
  32-byte token, and `GET /accounts/bootstrap` mints one too (a join is already a login), so a
  joining device never logs in twice. The hot path (`/sync/push`, `/sync/pull`) switched from the
  verifier `Bearer` to `Authorization: Session <token>` — a hard cutover, so the raw verifier is
  no longer accepted there at all. Sessions live **in-memory, per-process** (`sha256(token)` →
  `{accountId, expiresAt}`, keyed by hash so a memory dump yields no usable bearer; lazy-purged on
  mint), *not* in the durable blind store — they're ephemeral non-user-data, and a relay restart
  costs each device one silent re-login. TTL is `DEFAULT_SESSION_TTL_MS` (1 h; env
  `RELAY_SESSION_TTL_MS`). The client half is entirely inside the transport
  (`packages/data/src/http-sync-transport.ts`): it logs in on first use / near expiry, caches the
  token, and on a 401 re-logs-in once and retries — so `SyncEngine`/`core`/the apps are unchanged,
  and a re-login that *itself* 401s (verifier now stale = password reset elsewhere) still surfaces
  as a 401, preserving `isRelayAuthError`. Failed logins at both verifier-checking endpoints share
  the H2 bootstrap throttle (a guessing grind can't be laundered across them). Files:
  `apps/server/src/{relay,config,index}.ts`, `packages/data/src/http-sync-transport.ts`. Tested
  (`relay.test.ts`: mint→authorize-hot-path, raw-verifier-rejected-on-hot-path, expired-token-401;
  `packages/data/test/http-sync-transport.test.ts`: login-once-and-reuse, Session-scheme-never-
  verifier, re-login-on-401-retry, stale-verifier-propagates-401, credential-less-throws). **Still
  open (H3):** TLS (the deploy gate, next), per-device tokens/revocation, replay defense; a
  multi-node relay needs a shared session store (bundled with the shared rate-limit counter).
- **Bootstrap online-guessing throttle (H2) — done (2026-07-05).** `GET /accounts/bootstrap` (the
  de-facto login endpoint) was the one auth route with **no rate limit**: an attacker with a
  username (from the unauthed `lookup`) could grind passwords against it with unlimited 401s, and a
  hit returns *both* the verifier and `wrap(MK, KEK)` → total account compromise. Added a third
  per-IP limiter (`DEFAULT_BOOTSTRAP_RATE_LIMIT` = 10/min; env `RELAY_BOOTSTRAP_RATE_LIMIT_MAX`/
  `_WINDOW_MS`) that counts only **failed** auths, on its own counter, so a legitimate join/re-auth
  is never charged and the enumeration/recovery budgets are untouched. Per-IP only (per-account
  keying + lockout-with-recovery deferred — it opens a lockout-DoS vector). Tested
  (`apps/server/test/relay.test.ts`: 401→401→429, valid-bootstrap-unaffected, budget-independence)
  + `curl` smoke.
- **Convergence-DoS hardening (M3) — done (2026-07-05).** A short/garbage ciphertext (a corrupt row
  or one injected by a hostile relay) threw in `open()` and aborted the *entire* `pull` batch —
  and, since the cursor never advanced past it, re-threw on every later pull, permanently stalling
  sync. Fixed both halves: `open()` (`packages/crypto/src/wrap.ts`) length-guards
  `< NONCE_BYTES + TAG_BYTES` with a typed throw, and `SyncEngine.pull()`
  (`packages/data/src/sync-engine.ts`) wraps each record in try/catch that **skips-and-logs** and
  keeps going, with the cursor still advancing (poison pulled once, skipped, never re-seen).
  `applied` now counts only rows actually applied. Tested (`wrap.test.ts` too-short-blob;
  `relay.test.ts` E2E skip-and-converge, verified non-vacuous). Not a confidentiality change — AEAD
  still fails closed.
- **Proxy-aware client IP — done (2026-06-26).** Behind a reverse proxy the per-IP limiters keyed
  on `req.socket.remoteAddress` (the *proxy's* IP for every client), collapsing both throttles to
  one shared bucket (self-DoS) or, if widened, to a no-op. Now a `clientIp(req)` helper recovers
  the real client from `X-Forwarded-For` via `proxy-addr` (the Express `trust proxy` resolver,
  so IPv6 / IPv4-mapped-IPv6 are handled), but **only** for connections from a configured trusted
  proxy — an **IP/CIDR allowlist** (`RELAY_TRUSTED_PROXIES`, comma-separated IPs/CIDRs or presets
  `loopback`/`uniquelocal`; `DEFAULT_TRUSTED_PROXIES = []`). **Secure by default:** unset → trust
  none → XFF ignored → byte-for-byte prior behavior, so a forged header can't mint fresh buckets.
  Compiled once at server construction; both `throttled`/`throttledRecovery` call sites swapped.
  Tested (`apps/server/test/relay.test.ts`: per-client buckets behind a trusted proxy, XFF ignored
  with no trust configured, rightmost-untrusted/anti-spoof selection) + manual `curl` smoke of the
  env wiring. Single-node only; the **shared counter** for multi-node relays remains open.
- **Recovery-endpoint rate-limiting — done (2026-06-26).** `POST /accounts/reset` (state-changing
  password reset) and `GET /accounts/recovery` (escrow read) are both gated only by the 256-bit
  recovery verifier — brute force is already infeasible, but they were **unthrottled**. Added a
  *separate, tighter* per-IP limiter (`DEFAULT_RECOVERY_RATE_LIMIT` = 10/min, vs. 60/min for
  enumeration; env `RELAY_RECOVERY_RATE_LIMIT_MAX`/`_WINDOW_MS`) applied **before**
  `authenticateRecovery` so a wrong-verifier guesser is throttled, on its own counter so it never
  shares the enumeration budget. Defense-in-depth + flood/DoS mitigation. Tested
  (`apps/server/test/relay.test.ts`: throttle-before-auth + budget-independence).

## Reconciliation (dedup & merge)

Detail + reuse rationale in [`packages/core/README.md`](../packages/core/README.md).

- **A — the merge primitive** — `core.people.merge(survivorId, loserId)`: re-points every FK
  (relationships, taggings, milestones, the three contact tables, dismissals,
  `not_a_duplicate`) from loser → survivor, prunes self-loops/dup-edges, bumps the survivor's
  `updatedAt`, soft-deletes the loser. Manual "Merge" UI on both clients. **Syncs for free.**
- **B — duplicate detection + "not a duplicate" memory** — a pure exact-match scorer
  (`scoreDuplicate`, tiers as named constants, a reserved `"low"` for a future fuzzy upgrade);
  a syncable `not_a_duplicate` table (migration 16) so a rejection never re-nags on another
  device; `core.duplicates.findCandidates()`/`reject()`; a "Review duplicates" UI on both
  clients.
- **C — merge-on-join (detect + prompt, no auto-merge)** — a joining device now **keeps** its
  local data: it pulls the account first, detects the duplicates the join introduced, and
  prompts the user to review them (merge stays manual). Replaces the old "overwrite/abandon".

## Testing — the `SqliteDriver` contract suite (keystone, backlog steps 1–2)

The first automated guard on the driver port: one reusable spec that pins any `SqliteDriver`
to identical observable behavior, so the two unrelated backends (desktop
`better-sqlite3-multiple-ciphers`, mobile `expo-sqlite`) behind it can't silently diverge —
the seam directly under at-rest encryption. Design + open decisions in
[`testing/`](./testing/).

- **Shared, framework-agnostic spec** — `runDriverContract(testApi, makeDriver)` in
  `packages/data/src/testing/driver-contract.ts`, exported via the **`@leapsake/data/testing`**
  subpath. It imports no test runner: callers inject `{ describe, it, expect }` + a driver
  factory, so the future mobile native tier runs the *same* spec unchanged (backlog step 3).
  Schema-independent (each case makes its own throwaway table; no migrations); each case
  provisions/tears down its own driver, so the injected API needs no hooks.
- **Desktop conformance run wired** — `apps/desktop/test/integration/driver-contract.test.ts`
  runs it against the **production** `encryptedSqliteDriver` via `makeEncryptedTestDriver`;
  green under `pnpm test` (424 total). 11 cases cover run+get, `get()`→`undefined` on miss,
  `all` all/`[]`/ordering, positional binding, BLOB round-trip, multi-statement `exec`,
  transaction commit/rollback-and-rethrow/return-value, NULL round-trip. Verified
  non-vacuous (deliberately breaking desktop `get`'s miss-coercion reddens exactly that case).
- **Scope decision:** desktop-encrypted driver only for now; the spec is already
  factory-agnostic, so a second node:sqlite run (or the mobile run) is additive.

## Testing — the mobile native self-test (keystone, backlog step 3a)

The mobile half of the seam-proof desktop already had: the *same* `runDriverContract` spec
now runs against the **real** `expoSqliteDriver` on the native SQLCipher engine, in-app on a
simulator/emulator — the only prod-faithful way to exercise it (expo-sqlite can't load
headlessly; `testing/mobile-engine.md`). **Green on both iOS and Android** (all 11 cases
PASS). Design + the staleness/coverage enforcement model in [`testing/`](./testing/).

- **In-app dev-only self-test** — `apps/mobile/app/dev-selftest.tsx` runs the suite in a
  `useEffect` and renders a PASS/FAIL banner + per-case list. Reached by deep link
  `leapsake://dev-selftest` (no link from any shipping screen); `__DEV__`-gated (redirects
  home in a release build, so it's unreachable in production).
- **Runner shim + factory (reusable infra, not screens)** — `apps/mobile/test/test-api.ts`
  is a tiny `describe`/`it`/`expect` that *collects* results (no Vitest on device), typed
  against the spec's `TestApi` so its matcher surface can't drift.
  `apps/mobile/test/driver-contract-selftest.ts` is the `DriverFactory`: a fresh,
  **encrypted** throwaway DB per case (`openDatabaseSync` + `execSync('PRAGMA key …')`,
  mirroring the production boot), wrapping the real `expoSqliteDriver`; cleaned up via
  `closeSync` + `deleteDatabaseAsync`.
- **Built to surface divergence, not smooth it** — keyed like prod, real native engine, no
  mock/WASM/stub. Verified non-vacuous (flipping the driver's get-miss `?? undefined` to
  `?? null` reddens exactly that case). A zero-case run reads FAIL (`total > 0` required),
  so a broken import can't fake a green.
- **Terminal-confirmable hook for step 3b** — the result banner carries
  `testID=driver-selftest-status` with `accessibilityLabel` `PASS`/`FAIL`/`ERROR`, the
  stable signal the future Maestro/Detox harness asserts from the CLI.
- **Two known follow-ups** (both in `testing/README.md`): the harness (step 3b) is what makes
  the mobile leg *terminal* — until then it's a manual gate; and the harness still ships in
  the release JS bundle behind the `__DEV__` gate (RN is a single bundle — `import()` only
  defers eval, it doesn't strip), so a true exclusion (a production Metro
  `resolver.resolveRequest` stub) is deferred to an app-size pass.

## Verification record — recovery phrase (complete)

All recovery-phrase UI/boot flows are manually verified on **both clients**; the increment is
done. The dev harness (kept live in [`status.md`](./status.md)) is reused by future sync work.

- **Desktop (2026-06-25, all four flows):** reveal (24-word phrase, not base64; same phrase under
  Settings → "Reveal recovery phrase"); single-device keychain-loss recovery (delete the `db-key`
  line in `<userData>/keystore.json` → relaunch → `RecoveryGate` → phrase restores access);
  cross-device recovery (a second `--user-data-dir` instance recovers and converges over the
  relay); re-auth after the remote reset (device 1's 401 → friendly prompt → reconnect). Surfaced
  + fixed three bugs (below).
- **Mobile (2026-06-26, all flows):** reveal (`app/(tabs)/settings.tsx`); cross-device recover
  (`RecoverStep`) converging with a desktop instance over the relay; re-auth prompt;
  single-device boot recovery via the `leapsake://dev-clear-dbkey` affordance (a `__DEV__`-only
  deep link, `apps/mobile/app/dev-clear-dbkey.tsx`, that deletes only the secure-store `db-key`) →
  force-quit/relaunch → mobile `RecoveryGate`. Confirmed `leapsake-recovery.db` sits beside the
  main DB.

## Issues found & fixed during verification

- **Successful boot recovery landed on `ErrorPage`** — **fixed (2026-06-25)**. Found during the
  desktop single-device recovery verification: after the `RecoveryGate` accepted the phrase and
  the DB opened, the app showed "Something went wrong" (and only a "Go back to people" link got
  you in). Root cause: the renderer's data router was created at **module load**, and
  `createHashRouter` runs the index route's loader (`views.entityList`) **eagerly** — during a
  human-paced recovery boot that fires before the main process has opened the DB and registered
  its IPC, so the initial load rejected ("No handler registered") and the router opened straight
  into its `errorElement`. Fixed by building the router **lazily** once boot is `ready`:
  `router.tsx` now exports `createAppRouter()` (route tree extracted to a typed `routes`
  array), and `main.tsx`'s boot gate constructs it only on the `ready` transition (sync-activity
  revalidation now targets that instance). Re-verified the recovery boot lands directly on the
  people list. **Normal launches were unaffected** (the core registers before the renderer JS
  runs); only the slow recovery boot lost the race.
- **Manual "Sync now" leaked a raw `401` while awaiting re-auth** — **fixed (2026-06-25)**.
  With the re-auth prompt showing, pressing "Sync now" again surfaced a raw
  `Error invoking remote method 'sync:now': … failed: 401` instead of the friendly prompt. The
  background path routes a 401 to the prompt via the scheduler's `onError`, but the **manual**
  `scheduler.trigger()` rethrows without that routing. Fixed in `apps/desktop/src/main/index.ts`
  (the `sync:now` handler now broadcasts the same `needsReauth` activity on an
  `isRelayAuthError`, with the prompt copy hoisted to a shared `REAUTH_PROMPT` const reused by
  `onError`) and `screens/Settings.tsx` (the `syncNow` catch recognizes a `401` → flips
  `needsReauth` and suppresses the raw message, letting the broadcast's friendly text win).
  **Not re-exercised against a fresh live 401** (re-staging needs another password rotation).
- **Unhandled promise rejection on the background 401 path** — **fixed (2026-06-25)**. While
  device 1 was stale (pre-re-auth), the main-process log showed
  `UnhandledPromiseRejectionWarning: Error: relay GET /sync/pull… failed: 401` from
  `runAccountSync` under the scheduler's auto-trigger. Root cause: `trigger()` in
  `packages/core/src/sync-scheduler.ts` routes a failure to `onError` and then **rethrows**, but
  every event-driven caller fires `void scheduler.autoTrigger()` with no `.catch()`, so the
  rejection escaped. Fixed **at the source** — `autoTrigger()` now swallows the rejection after
  `onError` has seen it (`trigger().catch(() => undefined)`); only the manual `trigger()` still
  rethrows (so "Sync now" keeps surfacing errors). One change covers **both clients'** auto sites.
  To preserve the dev-terminal signal the swallow removed, both clients' `onError` now
  `console.error` on the non-401 branch. Guarded by a new `sync-scheduler.test.ts` case
  (autoTrigger resolves on failure while trigger rejects).
- **Password reset invalidates other devices' relay credential** — **fixed** (see *device
  re-auth after a remote password reset* above). A sync 401 now surfaces a re-enter-password
  prompt on both clients that re-derives the device's credential locally (no new MK) and
  resumes syncing.
- **Merge-on-same-ms LWW tie** (was: flaky `merge-people.test.ts`) — **fixed**. Root cause was a
  real correctness bug, not just test noise: a merge that re-points/tombstones a row in the same
  millisecond the row was created stamped an equal `updated_at`, so whole-row LWW's canonical
  tiebreak could keep the *pre-merge* version on other devices (a re-point stranded on the
  tombstoned loser, or a resurrected loser). Fixed by making every merge write strictly advance
  the row's clock — `updated_at = MAX(?, updated_at + 1)` in `people.softDelete` and all six
  `repointEntity`/`repointOwner` paths (`relationships`, `tags`, `dismissals`, `milestones`,
  `contact-methods`, `not-a-duplicate`). Verified deterministic over repeated runs.
