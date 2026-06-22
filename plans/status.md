# Leapsake — Status & Next Steps (the single oracle)

> **This is the one file that tracks status across every workstream.** What just shipped +
> what's next live *here*; the design docs (the [`encryption/`](./encryption/) folder for
> V3 sync, and each shared package's own `README.md` for its architecture) link here rather
> than restating status, so they can't drift. **Picking up work? Read this file for *what to
> do next*, then the relevant design doc for the *why*.** Update *this* file per increment;
> keep the design docs stable.
>
> **Updated 2026-06-22.**

## Where things stand

- **V1 desktop + V1.5 local CRM** and **V2 mobile** (feature-complete vs. desktop, verified
  iOS + Android) — ✅ done. (Delivery history is in git; durable lessons are in
  [`../AGENTS.md`](../AGENTS.md) and the package READMEs.)
- **V3 · Encryption + sync** — **Stage 1 (zero-knowledge sync) is done** on both clients,
  verified desktop ↔ mobile over the wire. **Stage 2 (at-rest) is now done on desktop**
  (the local file is encrypted; mobile at-rest is the follow-on increment). Stages 3–4
  (sharing, SSR) remain post-launch. Design: [`encryption/`](./encryption/).
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
  to avoid — **accepted** for at-rest; mitigated by prebuilds + a `pnpm --filter @leapsake/desktop
  rebuild` step (`@electron/rebuild`) for the Electron ABI.
- **Whole-DB key custody:** a random 256-bit key minted once on first launch and held **only** in
  the OS enclave via the `KeyStore` (`db-key`), supplied at open time. It is deliberately **not** a
  `key_wrap` row — that table lives inside the encrypted DB (chicken-and-egg) — and is orthogonal to
  the in-DB master-key hierarchy (at-rest protects the *file*; per-item content keys live *inside*).
- **Existing-data upgrade:** a pre-Stage-2 plaintext file is detected by its `SQLite format 3`
  header and re-keyed in place on first launch, keeping the original as `leapsake.db.plaintext.bak`.
  Idempotent; a no-op for fresh installs and already-encrypted files.
- Code: `apps/desktop/src/main/db/{encrypted-sqlite-driver,database-key,plaintext-migration}.ts`;
  the old plaintext `node-sqlite-driver.ts` is removed. Tests run under Vitest's Node ABI and prove
  ciphertext-at-rest, wrong-key rejection, BLOB round-trip, and the plaintext→encrypted migration.
  `packages/data` integration tests stay on `node:sqlite` `:memory:` (encryption is a driver concern).

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
- **Stage 2 — at-rest encryption.** **Desktop is done** (see Recently shipped:
  `better-sqlite3-multiple-ciphers` behind the `SqliteDriver` port, whole-DB key in the OS
  enclave, plaintext→encrypted upgrade-on-launch). **Remaining: mobile at-rest** — its own
  increment with its own backend question (verify expo-sqlite's SQLCipher path on SDK 56, else
  `@op-engineering/op-sqlite` via a config plugin); same key-custody pattern, lifted from
  desktop's `database-key.ts`. Stage 2's convenience doors (passkeys, Tier-1 escrow) stay
  additive/post-launch.
- **Relay hardening** — TLS, challenge–response vs. bearer replay, device-scoped tokens,
  proxy-aware/shared rate limiter (`encryption/security-review.md` §3).
- **Human-transcribable recovery-key encoding** (base64 today; the only Tier-2 way back in).
- **CK revocation / GC on entity delete** (sync-era cleanup; stops orphaned keys).
- **True background-fetch sync + a configurable sync-*interval* UI.**

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
