# Leapsake — Status & Next Steps (the single oracle)

> **This is the one file that tracks status across every workstream.** What just shipped +
> what's next live *here*; the design docs (the [`encryption/`](./encryption/) folder for
> V3 sync, and each shared package's own `README.md` for its architecture) link here rather
> than restating status, so they can't drift. **Picking up work? Read this file for *what to
> do next*, then the relevant design doc for the *why*.** Update *this* file per increment;
> keep the design docs stable.
>
> **Updated 2026-06-22** (recovery-phrase increment landed; UI pending manual verification).

## Where things stand

- **V1 desktop + V1.5 local CRM** and **V2 mobile** (feature-complete vs. desktop, verified
  iOS + Android) — ✅ done. (Delivery history is in git; durable lessons are in
  [`../AGENTS.md`](../AGENTS.md) and the package READMEs.)
- **V3 · Encryption + sync** — **Stage 1 (zero-knowledge sync) is done** on both clients,
  verified desktop ↔ mobile over the wire. **Stage 2 (at-rest) is done on both clients**
  (the local file is encrypted on desktop *and* mobile). **The recovery-phrase increment is
  code-complete** — the recovery key is now a 24-word phrase that recovers **both** loss
  events (lost OS keychain → reopen the local file; forgot password → recover the account on
  a new device). Crypto/core/relay paths are test-verified; **the UI on both clients is not
  yet manually verified** (see *What's next → Immediate verification*). Stages 3–4 (sharing,
  SSR) remain post-launch. Design: [`encryption/`](./encryption/).
- **V3 · Reconciliation (dedup & merge)** — Increments A, B, and C's merge-on-join are
  built; only C's bulk-import dedup remains (deferred until the importer exists). Design:
  [`packages/core/README.md`](../packages/core/README.md).

---

## Recently shipped

### Encryption + sync — Stage 1 (the zero-knowledge core)

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

### Encryption + sync — Stage 2 (at-rest encryption, desktop)

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

### Encryption + sync — Stage 2 (at-rest encryption, mobile)

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
  bytes random, not the `SQLite format 3` magic). iOS verification is **pending a local Xcode
  upgrade**: the prebuild + SQLCipher integration are correct (amalgamation vendored, pods
  resolved, compiles), but RN 0.85 / Expo 56's prebuilt `ExpoModulesJSI` requires Swift tools 6.2
  (Xcode 16.4+) and the local Xcode is 16.2 (Swift 6.0) — an environment gate unrelated to this
  change. The shared code path is platform-identical, so Android's pass exercises it fully.

### Encryption + sync — recovery phrase (make the recovery key a real lifeline)

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
- **Stage B — single-device recovery (core verified, UI not).** New enclave secret
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
- **Stage C — cross-device recovery (core+relay verified, UI not).** `deriveRecoveryVerifier`
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

### Reconciliation (dedup & merge)

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

---

## What's next

> **v0.1 launch line.** Items are grouped by launch scope. The pivot: **the web app is
> post-launch**, and it's the render vehicle for every URL-based share — so capability links
> and Stage 3 sharing defer with it. Mobile + desktop + the blind relay are judged enough for
> v0.1 person-data management. More pre-v0.1 polish/testing will be added here as launch nears.

### Pre-v0.1 (toward initial launch)

**Encryption + sync** — Stage 1 is done (desktop ↔ mobile over-the-wire demo verified: a
person + decrypted milestone note converge both ways through a localhost `apps/server` relay).
What's left for launch:
- **Stage 2 — at-rest encryption.** **Done on both clients** (see Recently shipped).
- **Recovery phrase.** **Done (code-complete), pending UI verification** (see Recently
  shipped + *Immediate verification* below). Replaced the base64 placeholder.
- **Relay hardening** — TLS, challenge–response vs. bearer replay, device-scoped tokens,
  proxy-aware/shared rate limiter (`encryption/security-review.md` §3). **Now also covers the
  two new recovery endpoints**: `POST /accounts/reset` is a state-changing, password-resetting
  surface gated only by the recovery verifier (256-bit, so brute force is infeasible) and is
  **not rate-limited** today — add it to the limiter in the hardening pass; `GET
  /accounts/recovery` serves the recovery escrow under the same verifier gate.
- **CK revocation / GC on entity delete** (sync-era cleanup; stops orphaned keys).
- **True background-fetch sync + a configurable sync-*interval* UI.**

#### Immediate verification (recovery phrase — UI not yet exercised)

The crypto/core/relay layers are test-verified; the **UI and boot flows could not be run in
the build agent** and need a human pass. Verify and report back:
- **Desktop reveal:** enable sync → the reveal shows a 24-word phrase (not base64); the same
  phrase appears under Settings → "Reveal recovery phrase".
- **Desktop single-device recovery:** with `leapsake.db` + `leapsake.db.recovery` present,
  delete the `db-key` entry from the OS keychain (or the `db-key` line in
  `<userData>/keystore.json`) → relaunch → the `RecoveryGate` prompts for the phrase →
  entering it restores access (wrong phrase shows an error and re-prompts).
- **Desktop cross-device recovery:** second profile/instance → login flow → "Forgot your
  password? Recover with your recovery phrase" → enter phrase + a new password → data
  converges over a localhost `apps/server` relay; the new password then unlocks on relaunch.
- **Mobile:** the same reveal + boot-recovery + recover-with-phrase flows on a dev client
  (Android emulator, as in Stage 2 mobile verification). Confirm the `leapsake-recovery.db`
  sidecar is created beside the main DB.

#### Identified issues / follow-ups from this increment

- **Password reset invalidates other devices' relay credential** (no re-auth flow). After a
  recovery resets the password, *other* devices still hold the old password-derived
  `authVerifier`, so their `runAccountSync` will start failing with **401** and silently stop
  (data stays intact locally). This is standard "reset logs out other sessions," but there is
  **no UI to re-connect** a device after a remote password change. Add a flow: on a sync 401,
  surface "your password changed elsewhere — re-enter it to reconnect" and re-derive
  salt/verifier (a `lookup` + password re-entry, no new MK). Touches the scheduler's `onError`
  path and `runAccountSync` callers.
- **Per-device vs per-account recovery phrase.** The phrase is unified (local file **and**
  account) only on the device that *enabled* sync or *recovered* the account. A device that
  joined by **password** keeps its **own** first-launch recovery key for its local-file
  sidecar; the account-MK recovery phrase remains the enabling device's. So "Reveal recovery
  phrase" on a password-joined device shows that device's *local-file* phrase, not the account
  phrase — a possible point of user confusion. (A password join can't adopt the account phrase
  because it never sees it.) Decide whether to document this in-product or revisit.
- **Fixed — merge-on-same-ms LWW tie** (was: flaky `merge-people.test.ts`). Root cause was a
  real correctness bug, not just test noise: a merge that re-points/tombstones a row in the same
  millisecond the row was created stamped an equal `updated_at`, so whole-row LWW's canonical
  tiebreak could keep the *pre-merge* version on other devices (a re-point stranded on the
  tombstoned loser, or a resurrected loser). Fixed by making every merge write strictly advance
  the row's clock — `updated_at = MAX(?, updated_at + 1)` in `people.softDelete` and all six
  `repointEntity`/`repointOwner` paths (`relationships`, `tags`, `dismissals`, `milestones`,
  `contact-methods`, `not-a-duplicate`). Verified deterministic over repeated runs.
- **Relay store migration:** new columns are added via `ALTER TABLE relay_account ADD COLUMN`
  (try/catch on duplicate) in `apps/server/src/store.ts` — fine for the single-node SQLite
  relay; revisit if the relay store ever moves backends.

**Distribution (launch-gating)** — code signing, macOS notarization, auto-update; v0.1 can't
ship without distributable apps. (None yet.)

**Reconciliation** (quality; can land pre- or post-launch as capacity allows):
- **Fuzzy / typo-tolerant name matching** — the scorer's reserved `"low"` tier via
  `fastest-levenshtein` or `cmpstr`, entirely inside `duplicate-score.ts`'s `sameFoldedName`
  predicate — no caller/API change.
- **`libphonenumber-js` phone normalization** — E.164 canonicalization; its own increment.
- **Pets / generalized `mergeEntities`** — small follow-on; the reference graph is entity-typed.
- **Bulk-import dedup** — deferred until the importer exists (then mostly A+B reuse, honoring
  the `not_a_duplicate` memory).

**Client / UX** (sequenced *after* the encryption work above):
- **Home screen** — a task/reminder surface (upcoming birthdays/holidays + user- &
  Leapsake-defined tasks) on the existing desktop + mobile clients. Doubles as the first-run
  **sync-onboarding** entry point ("Already using Leapsake on another device?"), so onboarding
  and the Home task/reminder UI are learned together. (New workstream; design TBD.)

### Post-launch (after the web app)

- **Web app — encryption Stage 4** (SSR split-session rendering + PWA; `model.md` §10): the
  no-JS accessibility floor and the gate for all URL-based sharing. "No client JS required"
  means *progressive enhancement of privacy* — no-JS, the render server decrypts transiently;
  with JS, decryption is client-side and the server stays zero-knowledge. Framework still open
  (Remix / Next.js / React Router). **Low retrofit risk** — the KEK layer makes the SSR
  session-key door additive, the auth-verifier split it needs is already built, and web is just
  another `core` consumer behind existing ports; no migrations/breaking changes foreseen.
- **Capability-link sharing** (`model.md` §11; the last unbuilt Stage-1 design item):
  zero-knowledge public links (key in the `#fragment`, no `key_wrap` row). Needs the web app as
  render vehicle **and** a prior URL-formation decision (see Open questions).
- **Stage 3 — authenticated sharing** — account keypair + public-key directory (TOFU-vs-verify
  trust) + constrained principals (hosted links, Alexa, CardDAV). Kept **entirely** post-web:
  even native-to-native sharing (which could ride the relay without a URL) defers with it.
  Needs an external crypto audit before public ship.
- **Custody tiers** — Tier-1 server escrow (email/password reset) + Tier-0; **passkeys**
  (WebAuthn PRF) as another unlock door. Each is one more MK wrapping, re-encrypting nothing.
- Registration-token enforcement / paid relay; username reconciliation across relays; the
  high-entropy sync-code / QR-pairing unlock door.

---

## Open questions

**Encryption** (each tied to a not-yet-started stage):
- Asymmetric scheme (X25519/Ed25519) — reviewed when **Stage 3** needs it; plus an **external**
  crypto audit before public ship (the recorded review is an internal design audit).
- Public-key directory trust model (TOFU vs. verification) — **Stage 3**.
- Web framework — must support both SSR (no-JS) and a client-side decryption path in one app
  (`model.md` §10) — **Stage 4**.
- Share-URL formation — how the official/paid instance (`leapsake.com` / `app.leapsake.com`)
  vs. self-hosted instances at arbitrary domains form & resolve share URLs, and how account
  identity / the public-key directory reconcile across relays and domains. Blocks
  **capability-link sharing**; tied to the **web app** + **Stage 3**.
- Metadata minimization — explicitly out of scope for V3; revisit later.
- Confidential-computing enclave for SSR — the **Stage 4** ceiling; only if server-side
  decryption trust ever needs hardening.

**Reconciliation:**
- Survivorship granularity — v1 keeps the survivor's scalar fields wholesale; a per-field
  picker is deferred; revisit if users hit it.
- Concurrent merges — two devices merging overlapping pairs differently is an edge case
  (re-points + tombstones may diverge under LWW). Acceptable to defer; noted, not solved.
