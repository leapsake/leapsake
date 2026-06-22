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
- **V3 · Encryption + sync** — **Stage 1 (zero-knowledge sync) is code-complete** on both
  clients. One acceptance gate left (a desktop ↔ mobile over-the-wire demo). Stages 2–4
  (at-rest, sharing, SSR) are ahead. Design: [`encryption/`](./encryption/).
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

### Encryption + sync

**The one acceptance gate to call Stage 1 done:**
- A desktop ↔ mobile over-the-wire demo against a localhost `apps/server` relay (needs a
  simulator/device). Enable sync on one client, log in + "Sync now" on the other, confirm a
  person + decrypted milestone note converge both ways. Mobile's UI is verified at the code
  level; desktop↔desktop was verified live (two `--user-data-dir` profiles, 2026-06-20).

**Stage 1 polish (deferred, none blocking the gate):**
- Capability-link sharing (`#fragment`, `model.md` §11) — the last unbuilt Stage-1 design
  item; key rides the URL, no `key_wrap` row.
- CK revocation / GC on entity delete (a sync-era cleanup concern).
- Relay hardening before a public, at-scale relay: TLS, challenge–response vs. bearer replay,
  device-scoped tokens, proxy-aware/shared rate limiter (`encryption/security-review.md` §3).
- A human-transcribable recovery-key encoding (both clients show base64 today).
- Sync onboarding prompt ("Already using Leapsake on another device? Sync now").
- Native background-fetch / true background sync; a configurable sync-*interval* UI.
- Registration-token enforcement / paid relay; username reconciliation across relays.
- Additive future unlock doors (none foreclosed — each is one more `key_wrap` of MK): the
  high-entropy sync-code / QR-pairing door, and the email/password door for the paid tier.

**Stages 2–4 (designed, not started; this is when `encryption/` should start collapsing toward
a flat doc):**
- **Stage 2** — whole-DB at-rest encryption + the custody dial + passkeys + Tier-1 escrow.
- **Stage 3** — account keypair + public-key directory + authenticated / constrained sharing
  (hosted links, Alexa, CardDAV).
- **Stage 4** — SSR split-session rendering for the no-JS web app.

### Reconciliation

- **Bulk-import dedup (C's other half) — deferred until the importer exists** *(next)*. Dedup
  incoming contacts against existing People via A+B, honoring the `not_a_duplicate` memory.
  Mostly *reuse* of A+B, not new logic.
- **Fuzzy / typo-tolerant name matching** — turn on the scorer's reserved `"low"` tier via
  `fastest-levenshtein` or `cmpstr`; lands entirely inside `duplicate-score.ts`'s
  `sameFoldedName` predicate — no caller/API change.
- **`libphonenumber-js` phone normalization** — E.164 canonicalization so the same number in
  different formats matches; its own increment (touches the contact-method normalization layer).
- **Pets / generalized `mergeEntities`** — the reference graph is already entity-typed, so a
  `mergePets` is a small follow-on.

### V3 · Distribution & web (cross-cutting, not yet started)

- **Distribution** graduates with sync — code signing, macOS notarization, and an auto-update
  mechanism. "Truly distributable" is only meaningful once there's something to sync, so it
  ships alongside the sync work above (no signing/notarization/auto-update yet).
- **Web app** — add it and choose its framework then (Remix / Next.js / React Router
  candidates). Server-rendered with progressive enhancement. **Privacy note** (`encryption/
  model.md` §10): "no client JS required" means *progressive enhancement of privacy* — with no
  JS the render server decrypts transiently for the session; with JS, decryption is
  client-side only and the server stays zero-knowledge. The framework must support both paths
  in one app (this is also encryption Stage 4 / the open web-framework question below).

---

## Open questions

**Encryption** (each tied to a not-yet-started stage):
- Asymmetric scheme (X25519/Ed25519) — reviewed when **Stage 3** needs it; plus an **external**
  crypto audit before public ship (the recorded review is an internal design audit).
- Public-key directory trust model (TOFU vs. verification) — **Stage 3**.
- Web framework — must support both SSR (no-JS) and a client-side decryption path in one app
  (`model.md` §10) — **Stage 4**.
- Metadata minimization — explicitly out of scope for V3; revisit later.
- Confidential-computing enclave for SSR — the **Stage 4** ceiling; only if server-side
  decryption trust ever needs hardening.

**Reconciliation:**
- Survivorship granularity — v1 keeps the survivor's scalar fields wholesale; a per-field
  picker is deferred; revisit if users hit it.
- Concurrent merges — two devices merging overlapping pairs differently is an edge case
  (re-points + tombstones may diverge under LWW). Acceptable to defer; noted, not solved.
