# Leapsake — Sync Transport & Merge

> **This doc owns the two genuinely-open sync decisions** that the model
> ([`model.md`](./model.md)) and schema ([`schema.md`](./schema.md)) deliberately left
> as TODOs: **(1) the transport seam** — how encrypted bytes move between devices — and
> **(2) the merge model** — how concurrent edits reconcile. It also records the
> **P2P decision**: true peer-to-peer is a *deferred adapter, not a closed door*.
>
> **Why these two live together.** The merge model and the transport are coupled by one
> constraint: because the server is a **blind blob store** that cannot read content
> (`model.md` §9.1), *all merging happens client-side on decrypted data*. That same
> property is exactly what keeps P2P possible — so the transport choice and the merge
> choice must both avoid assuming a server that can order or merge.
>
> For build status and where this sits in the staging plan, see
> [`status.md`](../status.md). This is a **Stage-1** concern.

## 1. The transport is untrusted, therefore swappable

The load-bearing realization: **content is encrypted *before* it leaves the device**
(per-item content keys, `model.md` §3). The transport never sees plaintext and never
holds an unwrapped key. So the transport is not a trust boundary — it is a **dumb pipe
for ciphertext**, and dumb pipes are interchangeable.

That makes the transport the same kind of seam as `SqliteDriver` (`AGENTS.md`,
[`packages/data`](../../packages/data/README.md)) and `KeyStore` (`model.md` §13): **define
a port, ship one adapter now, add others later without reshaping anything above the line.**

### The `SyncTransport` port (sketch — finalized at build time)

```ts
// Moves opaque, already-encrypted records between this device and its peers.
// It never sees plaintext, never holds a key, never merges. Everything below is
// ciphertext + sync metadata (UUIDs, updated_at, deleted_at) — never domain fields.
interface SyncTransport {
  // Push locally-changed encrypted records since the last successful sync.
  push(records: EncryptedRecord[]): Promise<void>;
  // Pull encrypted records changed elsewhere since `since` (an opaque cursor).
  pull(since: Cursor): Promise<{ records: EncryptedRecord[]; cursor: Cursor }>;
  // Optional: subscribe to live changes where the transport supports it.
  subscribe?(since: Cursor, onBatch: (b: EncryptedRecord[]) => void): Unsubscribe;
}
```

The exact shape (batching, cursors, live vs. poll) is settled when the first adapter is
written; the point recorded *here* is that **the relay must be one implementation of a
port, never hardwired into `core`.**

## 2. Adapter 1 (now): the blind relay

The V3 transport is a **centralized but blind** relay — the §14 hybrid conclusion
(`model.md` §14): a public, durable host is *required anyway* for shareable URLs and the
SSR web app, so a relay is not an extra cost, it is already on the critical path.

What it is:

- An authenticated HTTPS endpoint that stores and serves **encrypted records** ordered
  by an opaque cursor. Plain request/response; no exotic protocol.
- **Blind** — it stores ciphertext + sync metadata (`updated_at`, `deleted_at`, UUIDs)
  and nothing else. It cannot read, merge, or order *content*; it only orders *delivery*.
- The same host already enforces share access policy (`schema.md` §2.5) and serves
  capability-link blobs. Sync is one more blind-blob surface on it.

This is deliberately the *least* clever option, and that is the point: with E2E
encryption doing the hard work, the transport has no reason to be sophisticated. It is
the low-homebrew-risk choice precisely because it does so little.

> **Caveat — the relay is disposable by design, not yet by build.** Nothing ever deletes
> from the append log, so it accumulates every version of every row and is currently
> serving as an *accidental* durable backup. The retention problem, and why the obvious
> fix corrupts joining devices, is explored in [`prune.md`](./prune.md) — **exploratory,
> nothing decided.**

## 3. The P2P decision — a deferred adapter, not a closed door

**Decision: do not build P2P for V3; do not foreclose it either.** True peer-to-peer
sync (and the decentralization it represents) stays a first-class roadmap item,
implemented later as **a second `SyncTransport` adapter** alongside the relay.

### What keeps the door open (the invariants to honor now)

P2P remains addable later *for free* as long as we never violate these — and the model
already satisfies all four:

1. **Encrypt before transport.** Already true (`model.md` §3). A P2P peer is just
   another dumb pipe for the same ciphertext.
2. **Merge is client-side and order-independent.** Already committed (`model.md` §9.1).
   The thing that would quietly weld the door shut is depending on a
   **server-authoritative global sequence number or clock** for ordering. We must not.
   A CRDT is inherently safe here; LWW-on-wall-clock-`updated_at` + tombstones is *also*
   safe (it works peer-to-peer with no central authority). See §4.
3. **Transport behind the `SyncTransport` port** (§1) — so "P2P" is an adapter swap, not
   a rewrite.
4. **Identity is by keypair.** P2P dials peers by public key; we already plan
   `device.public_key` (for QR device-linking, `schema.md` §2.2) and an account keypair.
   Those device keys can double as P2P node identities later — no schema change.

### Why not now, and the Iroh assessment

- **The hybrid already needs a relay**, and once you have a blind relay for sharing +
  web, pure-P2P personal sync buys little for a personal-CRM syncing a handful of
  devices — at real cross-platform cost. P2P shines for large fleets / serverless /
  large-file swarming, not this shape. So the relay is first and P2P is additive.
- **[Iroh](https://www.iroh.computer/) is the leading P2P candidate** when we do this:
  it is a connectivity layer (dial peers by node-ID over QUIC, NAT hole-punching, relay
  fallback) plus content-addressed blobs, and it has
  [JS bindings](https://docs.iroh.computer/languages/javascript) (`@number0/iroh`,
  napi-based) so it is consumable from TypeScript.
- **The honest caveat is platform reach, not language.** The "TypeScript everywhere"
  principle (`AGENTS.md`, Guiding Principles) is about *our source*, not dependencies — a non-TS
  dependency consumed from TS is fine. The friction with Iroh is specifically:
  - **Desktop / Node:** a napi native module — genuinely consumable, the easy case.
  - **React Native:** a native module means leaving **Expo Go** for a dev build / custom
    native module — a real cost against the zero-dev-build workflow V2 preserved.
  - **Browser / web:** the WASM + WebTransport path is real but nascent.
- **So the likely path** when P2P graduates: an **Iroh adapter, desktop-first**, with
  the relay adapter remaining the universal fallback (and the only transport on web).
  The port makes "different transports on different platforms" natural — the same way
  `KeyStore` and `SqliteDriver` already have per-platform adapters.
- Iroh would **not** replace `packages/crypto` — it secures *transport*, which our
  envelope already makes untrusted. It does not provide the envelope, at-rest
  encryption, capability links, or the merge model. It is a transport adapter and
  nothing more.

## 4. The merge model

The one decision that touches the **domain** per-item rows (e.g. `person`), not the key
tables — the key tables are conflict-free by construction (`schema.md` §1, §3). Merge
happens **client-side, on decrypted data**, and must be **order-independent** (§3
invariant 2).

### Settled constraints

- The §4.2 sync-safe substrate is already on every table: UUID PKs, epoch-ms
  `updated_at`, `deleted_at` tombstones. Soft deletes propagate; UUIDs never collide.
- The **key tables merge trivially** — union-of-grants minus union-of-revokes
  (`schema.md` §1). Nothing below changes that.
- Whatever we pick must work **peer-to-peer**, i.e. with no central merger or
  authoritative clock (§3).

### The options

| Option | What it is | Cost | P2P-safe? |
|---|---|---|---|
| **LWW-on-`updated_at` + tombstones** | last writer (by wall-clock `updated_at`) wins per row; deletes are tombstones | tiny — the schema already supports it; pure app code, no dep | ✅ yes |
| **CRDT (Automerge / Yjs)** | conflict-free replicated data type; concurrent edits *merge* instead of one winning | a WASM-core dependency + a **document** data model that doesn't match our SQLite rows (real architectural fork) | ✅ yes (built for it) |
| **Op-log / event sourcing** | sync a log of operations, replay to converge | most homebrew; we'd own the hard parts | ✅ yes, but most work |

### Decision (confirmed) — whole-row LWW

**Decided: whole-row LWW-on-`updated_at` + tombstones; a CRDT is a scoped escalation,
not the default.** The pure resolver is now built (`resolveMerge` /
`SyncRow` in `packages/schema/src/merge.ts`, proven in `merge.test.ts`; see
[`status.md`](../status.md) §2). Reasoning:

- This is a **single-user, few-devices personal CRM.** True concurrent edits to *the
  same field of the same record* on two devices at once are rare. For that workload,
  row-level LWW is usually indistinguishable from a CRDT in practice — and it is *far*
  simpler, adds **zero dependencies**, and the schema already carries everything it
  needs.
- It honors every P2P invariant (§3), so it does not foreclose anything.
- A CRDT (Automerge is the strongest candidate — it ships a sync protocol and pluggable
  network/storage adapters, and merges client-side, which fits our blind relay) is the
  legitimate "someone else solved concurrency" move **if** LWW's lost-update window
  proves to matter. But it is a real fork: Automerge is a *document* model, so adopting
  it means encrypting Automerge document updates as the opaque `EncryptedRecord` blobs
  and reconciling that with the row/repository model — a meaningful redesign to take on
  only when justified.
- **Escalation path, not a one-way door:** because merge is isolated to the domain rows
  and any clock/vector column is *additive* (`schema.md` §3 marker), we can move from
  LWW to a CRDT later without reshaping the key tables or the transport.

**Granularity — whole-row, not per-field (decided).** The resolver reconciles a row at a
time. Per-field LWW (an LWW-Map) was considered and deferred: it needs a per-field clock
store, per-repo write-path stamping, and trickier tombstone/resurrection rules, to shrink
an already-rare window for this single-user/few-device workload. It stays an *additive,
per-entity* escalation later — the whole-row `updated_at` is a valid field-clock floor, so
a missing field clock falls back to it and old rows just work.

**The cost we accepted — the lost-update window.** Whole-row LWW means two devices that
edit *different fields of the same record* inside one sync gap keep only the
higher-`updatedAt` row; the other field change is lost. This is characterized and asserted
in `merge.test.ts`. For this domain that collision is uncommon and the simplicity (zero
deps, no new columns) wins; if a specific entity ever shows real field-contention pain,
escalate just that entity to per-field (or CRDT) per the path above.

**How convergence is guaranteed.** `resolveMerge` is `max` over a *total order* on rows
(primary: `updatedAt`; tiebreak: canonical serialization for same-ms writes), so it is
commutative, idempotent, and associative — folding a pulled batch converges regardless of
arrival order, with no central clock or server sequence (honoring §3 invariant 2).

**Wired (done for every entity).** `resolveMerge` drives each repo's `upsertFromRemote`, fed
by the registry-driven `SyncEngine` over the `SyncTransport` port (in-memory adapter;
`packages/data`). Each pulled row is reconciled against the local one — tombstones included —
and the winner is written verbatim, preserving the remote clock. This merge/collect/apply
machinery is now generated for each entity by a single `defineSyncable` helper (derived from
the entity's Zod row schema), so a new entity is **one registration behind an opt-in
allowlist** — never hand-rolled SQL. Sync is deliberately opt-in (not on-by-default) so the
device-local key tables can never replicate; see [`status.md`](../status.md) §2. The engine
also **persists its own watermarks** (the push high-water mark and the pull cursor) in a
device-local `sync_state` table and self-drives via `sync()`, so a fresh engine resumes
where it left off. The **real authenticated HTTPS blind-relay adapter and the relay server
(`apps/server`, §2) are now built** — two devices converge over the wire through a host that
stores only ciphertext (see [`status.md`](../status.md)). What remains is **multi-device
account login** — giving a second device the master key — plus the `apps/` sync trigger,
phased in [`status.md`](../status.md) (Phase A/B/C).

### The account-bootstrap channel (how a second device gets the master key)

The domain sync log is useless to a fresh device — every record is sealed under MK, which it
doesn't have. So the master key reaches a new device through a **separate, account-level
channel on the same relay**, never through the sync log. The decided shape is
**username + password login** (the Bitwarden / Standard Notes "protected symmetric key"
pattern): at enable-sync, device 1 uploads `wrap(MK, password-KEK)` — ciphertext — keyed by a
unique username; a second device looks the account up by username (prelogin → public salt),
derives the KEK from the same password, fetches the wrapped MK, and unwraps it locally. The
relay stays blind: it holds only the public salt, `sha256(verifier)`, and the ciphertext
wrapped key. **Accepted stance:** a username/password is required to *sync*, and — since 2026-07-27 —
also to *encrypt at all*. It is never required **to start**: a fresh install runs Unauthenticated, with
no keys and a plaintext store, until the user creates an account. That account is created
locally and a relay is bound afterwards, so by the time this bootstrap runs the password door
and recovery key already exist and **no new key material is minted here**
([`model.md`](./model.md) §7.2, §7.5 Phase 1). *(This supersedes the earlier stance that the
enclave alone gives local at-rest — it did, under a key the user did not hold, which is the
trade §7.2 reverses.)* A joining device **keeps** its pre-existing
local data — the join pulls the account first, detects the duplicates it introduced, and
prompts the user to review them (the cross-cutting reconciliation workstream,
[`../../packages/core/README.md`](../../packages/core/README.md); this replaced the original "overwrite/abandon"
cut). QR/code device-pairing is a deferred second adapter for the same bootstrap step.

### Join-scheme decision — username/password is the launch default (decided 2026-06-20)

Weighed against a **high-entropy sync code** ("something you have": one code, QR-or-paste,
doubling as the recovery key) and a rigorous **aPAKE (OPAQUE)**. **Decision: ship
username/password as the single launch scheme.** Recorded so it isn't relitigated:

- **Why.** Universal and familiar (lowest adoption friction), it sets up the paid
  email/password tier as a continuum rather than a jump, and it's "something you know" — no
  device co-location, unlike a QR scan. The Bitwarden / 1Password / Standard Notes model: a
  respectable point on the privacy/usability curve, not the maximally-private one.
- **Accepted, mitigated costs** (measurably weaker than a high-entropy code, not free):
  *enumeration* — a username rendezvous is an existence oracle (the unauthenticated `lookup` +
  registration's 409), mitigated by per-IP **rate limiting** and intrinsic to user-chosen
  handles; *offline brute-force* — a human password is a weaker KEK, mitigated by a 12-char
  floor, the recovery-key backstop, and the relay storing only `sha256(verifier)`; *no reset*
  — the familiar flow wrongly implies a reset exists, but in a zero-knowledge store it doesn't,
  and the UI says so plainly.
- **Rejected — sync code only.** Strictly stronger on privacy and simpler in total secrets,
  but trades away familiarity and the paid on-ramp. Deferred to a **future additive door**.
- **Rejected (for now) — OPAQUE / aPAKE.** The only design giving usernames *and*
  enumeration-resistance *and* no offline precomputation, but a vetted-dependency + complexity
  cost that doesn't fit dependency-minimal Stage 1. Revisit if enumeration becomes a real threat.
- **Reversible — not a one-way door.** MK has multiple independent unlock doors, each one
  `key_wrap` row added with no re-encryption (`model.md` §4). A future high-entropy-code or
  paid email/password door is purely additive. Caveat: you can stop *offering* a scheme to new
  accounts but can't *remove* an existing account's door without locking it out.

**Access control is orthogonal to zero-knowledge.** *Who may read* the bytes is settled by
the envelope; *who may store* bytes on a given relay is a separate, content-blind concern.
The established pattern — a host-issued **registration token** at account creation (cf. Matrix
registration tokens, Tailscale auth keys) — lets a relay host optionally gate usage (a future
paid/official relay) without ever seeing plaintext. The relay reserves this as a documented,
env-gated seam (public when unset); enforcement is a future phase.

### Auth-hardening decision — OPAQUE at the hosted-relay gate (decided 2026-07-05)

The problem being decided:
[`security-findings.md`](./security-findings.md) **H1** — the relay observes the raw auth
verifier on every request, so against a curious *operator* (the exact adversary the blind
relay is designed for), account confidentiality reduces to password strength stretched by
one interactive Argon2id pass. Three candidate fixes were weighed **through the
accessibility lens** (`model.md` §1: security defaults must not cost laypeople usability).
Recorded so it isn't relitigated:

- **Decision: OPAQUE (an aPAKE) is the chosen fix, required before any official/hosted
  relay stores other people's data** — "the hosted-relay gate." Not v0.1 scope (v0.1 sync
  is self-host-only; the operator is the user or someone they chose to trust). The deciding
  criterion: OPAQUE keeps login *exactly* username + password — the entire cost is
  engineering (a vetted protocol dependency), zero new user-visible burden.
- **v0.1 posture until then:** the current verifier scheme, plus **H3** (TLS required +
  short-lived session tokens, which shrink verifier observation from "every request,
  forever" to "once per login"), plus an honest sentence in the self-hosting docs: *a relay
  operator could attempt offline guesses against a weak password — use a strong one.*
- **Passkeys (WebAuthn PRF): supported eventually, deliberately not the default.** A
  passkey-derived key is high-entropy (nothing crackable at all) and platform-synced — but
  passkeys are not yet common or universally understood enough to be the layperson default.
  They land as one more additive MK unlock door (`model.md` §4/§5), post-launch.
- **A 1Password-style Secret Key / client pepper (findings H1-a): declined as a default.**
  It is the only option that *fully* closes the operator-crack hole, but it introduces a
  second user-held secret — new-device join stops working with just a password, and the
  "emergency kit" model is a notorious support burden. At most a much-later **opt-in**
  hardening dial, sequenced after passkeys.
- **The honest limit, accepted:** OPAQUE eliminates passive observation and third-party
  offline cracking (nothing crack-usable transits, and a stolen store alone is not an
  oracle), but a *maximally malicious operator* — who holds the server's own OPRF key —
  can still mount an **active** offline guessing campaign against a weak password. Only
  user-held entropy (a passkey, the pepper, the recovery key) removes that entirely. This
  residual is accepted for the password door, mitigated by the 12-char floor and by the
  Argon2 cost (findings M1); users wanting stronger custody get it via the passkey door
  when it ships.

## 5. How this fits the encryption model (recap)

- **Encryption** (`model.md`) protects *content*; **this doc** moves and reconciles the
  already-encrypted records. They are orthogonal layers joined at one seam: the
  transport carries `EncryptedRecord`s, never plaintext.
- The **relay** is the §14 "centralized but blind" host — centralized for *availability
  and policy*, zero-knowledge for *confidentiality*.
- **P2P** is the same encrypted records over a different pipe, later, behind the same
  port.
- **Merge** is the only piece that touches decrypted domain data, and it lives entirely
  on the client — which is what makes both zero-knowledge *and* P2P possible.
