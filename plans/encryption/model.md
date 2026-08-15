# Leapsake Encryption, Privacy & Sharing — The Model

> **This is the *stable* "why" doc — the conceptual model and the locked decisions.**
> It rarely changes. It is the source of truth for *how* Leapsake protects data and
> shares it, and it feeds the V3 work tracked in [`status.md`](../status.md). The point of
> writing the model first is the same as the sync-safe-from-day-one decision (`AGENTS.md`):
> encryption and key-custody decisions are brutally expensive to reverse, so we decide the
> *model* before we touch
> a row.
>
> **For *when* each part ships and *what is built*, see [`status.md`](../status.md)** —
> the single source of truth for the staged delivery plan, the build log, and the next
> slice. This doc describes the full target; `status.md` says when each piece lands.
> The KEK layer (§4) is what makes that staging cheap: every later capability is *one
> more wrapping of the master key, with no re-encryption of existing data.*
>
> **This doc owns custody end to end** — the states (§7.2), the exits (§7.3), the store
> layout (§7.4), and the key lifecycle phase by phase (§7.5). If you are touching
> onboarding, the boot path, or anything that assumes a key exists, §7 is the section.
>
> **Companion docs:** [`sync.md`](./sync.md) (the transport seam + merge model + the P2P
> decision),
> and, for the constructions themselves, [`packages/crypto`](../../packages/crypto/README.md)
> (why each primitive holds these properties) plus
> [`apps/server/README.md`](../../apps/server/README.md) → *Threat register* (the attacks the
> relay is built against). Start at [`README.md`](./README.md) if you're new to this folder.

## 1. Goals

- **Offline-first, single-device-complete.** The app works fully on one device with
  **no account, no password, and no sync *required to start*.** Sync is opt-in; nothing
  about the privacy model may require a server to use Leapsake.
- **Encryption follows custody** *(decided 2026-07-26 — §7.2)*. Leapsake encrypts as soon
  as the user holds a secret that can open the encryption, and not before. A brand-new
  install with no account is **plaintext on disk and mints no keys at all**; creating an
  account (username + password) is the single act that turns encryption on. The reason is
  in §7.2: a key the user does not hold protects little and can lose everything.
- **Default to the safest practice; let the user choose otherwise.** A core product
  theme: *default to the practices that protect and respect the user, but give them
  control to use their data how they want.* Security is a **configurable dial**, set
  high by default, not a fixed wall.
- **Accessibility is the tiebreak** *(decided 2026-07-05)*. Leapsake should feel as close
  to a familiar centralized app as possible while being safer under the hood. When a
  safest-practice *default* would force a layperson through hoops (a second secret to
  carry, an unfamiliar ritual), re-evaluate it: keep the safe **mechanism**, but make the
  hoop **opt-in** rather than default. Laypeople get sensible defaults; power users get
  the dials. (Worked example: the auth-hardening decision in [`sync.md`](./sync.md) §4 —
  OPAQUE over a user-held Secret Key.)
- **Zero-knowledge by default.** Servers should, by default, store only ciphertext
  they cannot read. The user holds the keys.
- **Modern-SaaS convenience without surrendering privacy.** Arbitrary sharing (a
  contact, a photo album) with others — including unauthenticated users via a URL —
  with revocable, time-/visit-limited, and authenticated-only links. The aim is
  Google-Drive-grade empowerment on top of a zero-knowledge default.

## 2. Three separable layers — know which one is doing the work

Leapsake encrypts in three distinct places. They have different jobs, different costs,
and ship independently. **Conflating them is the most common way to reason wrongly about
this system**, so they are named up front and referred to by name throughout.

| Layer | What it protects | Key | Answers |
|---|---|---|---|
| **1 · File lock** | the whole `leapsake.db` file on this device | `db-key`, whole-DB (§8) | *"someone has my disk"* |
| **2 · Sync envelope** | every row that leaves the device | `seal(json(row), MK)` under the master key | *"the relay can't read my data"* |
| **3 · Per-item content keys** | one item at a time, inside the DB | random CK per item, `wrap(CK, MK)` (§3) | *"you may read **this**, not everything"* |

Three consequences worth internalizing:

- **Layer 1 does nothing for sync.** Sync ships rows over HTTP, not the file. Turning the
  file lock off would not expose one byte to a relay; turning it on protects nothing that
  leaves the device. This is the piece that fights our `node:sqlite` choice (§8), and it is
  mostly about device theft / other-process access.
- **Layer 2 is what makes the relay blind, and it is the high-value, hard-to-retrofit
  property.** Every synced row is sealed *whole* under MK before it is pushed
  (`packages/sync/src/engine.ts`), so the relay stores opaque blobs for people, milestones,
  contact methods — everything, not just fields marked sensitive.
- **Layer 3's only unique job is sharing.** Because layer 2 already seals whole rows, a
  per-item key adds **no confidentiality against the relay** today. What it adds is
  *granularity*: you cannot hand a friend (or Alexa, or a hosted link) access to one
  contact if everything is sealed under your single master key — you need a per-item key
  you can re-wrap for them (§11, Stage 3).

#### 2.1 Layer 3 keeps its mechanism and loses its only user *(decided 2026-07-27; **done 2026-07-28**)*

> ✅ **Built — migration 27.** `milestone.note` is a plain column; `createMilestonesRepo`
> takes no cipher and `syncableRepos` no longer takes a master key, because no repo is
> anything but plaintext-row. `content_key`, `key_wrap`, `createContentCipher`, and
> `EncryptedRecord.wrappedKey` are all untouched, awaiting photos.
>
> One correction to the paragraph below: *"migrate existing notes back to the plaintext
> column"* is **not possible** and was not done. Migrations run before the key session
> exists — the very reason migration 12 could only upgrade rows lazily — so migration 27
> cannot decrypt what it drops. A note written while a key was held is lost with the column.
> Accepted pre-v0.1 (dev profiles only) rather than solved with a two-phase post-key pass.

Today exactly one field uses layer 3 — `milestone.note` — and it earns nothing. Layer 2
already seals the whole row containing that note, and on sync the note is *decrypted on
collect and re-sealed under the receiving device's own key*, so the wrapped key never even
travels. It is also **not a rehearsal for photos**, which is the reason it was worth
keeping: those are two different patterns that merely share primitives.

| | What the CK encrypts | Where the wrapped CK goes |
|---|---|---|
| **Photo (v0.2)** | bytes in a blob *outside* the database | on the wire, in `EncryptedRecord.wrappedKey` |
| **`milestone.note` (today)** | a field *inside* the database | nowhere — re-sealed per device |

**So: drop `milestone.note` as a consumer; keep the mechanism.** Concretely, remove the
`(note, note_ciphertext)` split and the decrypt-on-collect / re-seal-on-apply path, and
migrate existing notes back to the plaintext column. Keep `content_key`,
`createContentCipher`, and the reserved `wrappedKey` slot untouched. The immediate payoff is
that a whole axis disappears from the custody work: layer 3 no longer has to behave
correctly in both custody states, and step 6 of the §8.1 conversion vanishes. Only dev
installs hold encrypted notes today, so the migration is nearly free now and will not be
later.

> **Do not read this as "layer 3 is speculative."** It is the *only* layer that can protect
> a photo, because a blob living outside the database is reachable by neither layer 1 nor
> layer 2 — [`../v0-2.md`](../v0-2.md)'s files invariant #2 is built on it. It is also the only
> layer that can express "you may read *this album* and nothing else."

#### 2.2 Four guardrails so v0.2 sharing stays possible

A shared album is **bytes plus rows** — timestamps, location, and "who is in this photo."
So per-item keys must work for rows, not only blobs. None of that is v0.1 work; all of it
is easy to foreclose by accident, so it is pinned here:

1. **`EncryptedRecord.wrappedKey` stays** — reserved, unused, and specifically *not*
   deleted as dead-code cleanup. It is the hook that lets a row be sealed under a per-item
   key instead of directly under MK.
2. **Sealing a row under a CK must be a per-repo choice, not a global engine mode** — some
   rows shareable, some not, within the same push.
3. **CK scoping is a real mismatch, check it before v0.2.** `content_key` currently enforces
   *one CK per entity* (the `content_key_entity_active` unique index), but a shared album
   wants one CK per **sharing unit** spanning many rows and blobs — which is what §3
   actually says ("every shareable *unit*"). Changing it is a migration, not a
   re-encryption, so it is survivable; discovering it mid-build is not.
4. **People tags are the unsolved one, and it is a data-model question, not a crypto one.**
   "Who is in this photo" points at a Person row the recipient may have no right to read.
   Sharing an album with tags either leaks a contact reference or needs a **projection**
   (share the name, not the person record). Decide it when photos are designed; do not let
   the file schema assume a shared album can dereference the owner's People rows.

## 3. The unifying mechanism: per-item keys + key wrapping

The single most important decision. **Do not encrypt everything under one master
key.** Instead:

- **Every shareable unit** (a contact, a photo album, a "share bundle") gets its own
  random **content key**.
- That content key is then **wrapped** (encrypted) under whichever keys should have
  access:
  - wrapped under the owner's **master key** → owner can always read it;
  - wrapped under another user's **public key** → that authenticated person can read
    it;
  - placed in a **URL fragment** → anyone with the link can read it;
  - wrapped under a **server principal's key** → a server-side renderer / Alexa /
    hosted link can read *exactly that item* (§9, §11).

The server stores ciphertext plus a small bag of *wrapped* keys per item. It never
holds an unwrapped key, so it stays zero-knowledge even while brokering sharing. This
is **envelope encryption**, and it is what makes at-rest, sync, sharing, the
multi-client story, and the configurable security dial all the **same** operation:
*wrap this content key for that principal, at the trust level the user chose.*

> **Architectural statement.** Build *one* strong mechanism (per-item content keys +
> a wrapped master key). Expose "security level" and "which client/server can read"
> as **policy over key custody**, not as separate codepaths.

Rejected alternative: **field-level encryption** (encrypt column values, leave schema
plaintext). It breaks `search-service`, indexing, and any `WHERE`/`JOIN` on encrypted
columns — the entire data layer assumes it queries plaintext. So: whole-DB at rest
(§8) + per-item content keys for sync/sharing, **not** field-level.

## 4. The key hierarchy

The load-bearing detail: **never derive the master key directly from the
passphrase.** Insert a key-encryption-key (KEK) layer.

```
passphrase ──Argon2id──► KEK ──┐
recovery key ──────────────────┤
device enclave (cached) ───────┼─►(unwraps)─► MASTER KEY
                               │                  │
[server-held key] ─(optional)──┘                  ├─► wraps ► per-item CONTENT KEYS
                                                  └─► protects ► ACCOUNT KEYPAIR
                                                                   • public key → published to a directory
                                                                   • private key → unwraps shares sent to you
```

Why the indirection matters:

- **Change the passphrase without re-encrypting any data** — just re-wrap the master
  key under a new KEK.
- **Multiple independent unlock paths to the same master key** — passphrase *or*
  recovery key *or* device enclave *or* (optionally) a server-held key. Each is just
  another wrapping. This is the mechanism that makes the security dial (§5),
  recovery (§6), and passkeys-later (§7) all cheap.
- **Per-item content keys are constant** regardless of how the master key is
  protected, so sharing works identically at every security level.

Primitives we expect to use (subject to a security review at design time): Argon2id
for the KDF; XChaCha20-Poly1305 (or AES-256-GCM) for symmetric content/wrapping;
X25519 sealed-box / age-style recipients for asymmetric wrapping to public keys;
Ed25519 for signing. A `packages/crypto` (client-agnostic, portable — beside `core`)
should own these so every client does crypto identically (the same posture as
`schema`/`core`).

## 5. Configurable security — the custody dial

"Configurable security" and "opt out of a password" are the **same dial**: who is
allowed to hold the master key. Recovery convenience and server-readability move
together.

| Tier | Master key custody | Server can read? | Recovery | Enables |
|---|---|---|---|---|
| **3 — No custody** (first run) | **there is no master key** — nothing is encrypted | n/a (cannot sync) | n/a — nothing to recover *from* | zero-setup evaluation of the app (§7.2) |
| **2 — Zero-knowledge** (default once an account exists) | password / recovery / enclave only | **No** | recovery phrase only (lose password **and** phrase → data gone) | strongest privacy |
| **1 — Recoverable** | *also* wrapped under a server-held key | **Yes** | email / password reset | "encrypted SaaS" convenience |
| **0 — Server-readable** | server holds key / no envelope | **Yes** | trivial | server-side compute: search, SSR, Alexa |

Tier 3 is not a weaker *encryption* setting — it is the **absence of custody**, and it
exists only before the user has created an account. Moving 3 → 2 is the one transition
that is not "add another wrapping": it mints the keys and rewrites the database (§8.1).
Every other transition is additive, as below.

Dialing down = **adding another wrapping** of the master key (under a server key).
Dialing up = removing it and rotating. Same mechanism; the per-item content-key
architecture stays constant across all tiers.

> **Staging ([`status.md`](../status.md)).** Only **Tier 2** ships in the Stage-1 core. Tier 1 (server
> escrow) and Tier 0 are **Stage 2+** — each is literally "add one more MK wrapping,"
> so deferring them costs nothing and re-encrypts nothing.

**The honest impossibility result.** If the user holds **no secret at all**, then for
data to be usable on a second device or the web, *someone else must hold the key —
and that someone is the server*. So **"no user secret + multi-device +
zero-knowledge" is a contradiction.** The two genuine ways to keep zero-knowledge
without a *typed password*:

1. **Single-device only** — master key in the secure enclave, no password, no server
   holds it. Breaks the moment you want sync/web without transferring a secret.
2. **Passkeys (WebAuthn PRF)** — a passkey derives a symmetric key with no typed
   password, and the *platform* (iCloud Keychain / Google) syncs it across the user's
   devices E2EE. You get "no password, multi-device, app-server still
   zero-knowledge" by outsourcing the cross-device secret to the platform. Trade:
   you trust Apple/Google's keychain sync, and it doesn't cover platforms lacking
   passkeys (Alexa, headless CLI).

The reframe: **"password" really means "a secret the user holds,"** which can be a
passphrase *or* a passkey.

## 6. Recovery

Recovery is the true cost of zero-knowledge: **if only the user can decrypt, a lost
passphrase = unrecoverable data** — no "forgot password" reset (the Proton /
1Password "we genuinely cannot help you" problem). So recovery must be **designed
deliberately**, not bolted on:

- **Recovery key** (default) — a random high-entropy code (surfaced as a 24-word phrase),
  generated **at account creation — never before** — and shown once, right there, as the
  *forgot-password backstop*. It is another wrapping of the master key, so a lost password
  ≠ lost data *if* the phrase was kept.
  > **This replaces the earlier "mint it at first launch" rule** *(reversed 2026-07-26)*.
  > That rule existed because the recovery key sealed the at-rest sidecar, so a keyless
  > user needed one from the first run. Under §7.2 a keyless user has **no sidecar and no
  > db-key**, so there is nothing to seal and nothing to fall back *from*. Minting a phrase
  > before an account now protects nothing and creates the exact ritual it was meant to
  > justify.
- **Server-escrow recovery** (opt-in, Tier 1) — wrap a copy of the master key under a
  server-held key so email/password reset works. This is the same act as dialing to
  Tier 1; it trades zero-knowledge for recoverability, with informed consent.
- **Social recovery** (future, possible-not-planned) — split the recovery key via
  Shamir's Secret Sharing among trusted contacts; architecturally it is just another
  wrapping, so the model already allows it.

### 6.1 The phrase is shown twice in its life, and replaced rather than revealed *(decided 2026-07-28)*

There is **no way to see the phrase again.** It is displayed at account creation, and at
the **rotation** that replaces it — nowhere else. A standing "reveal" control put a
long-lived secret one tap from an unlocked app and still left a leaked phrase with no
answer; rotation is that answer.

Rotation is **compromise response, not recovery**. It requires the password, so it is
useless to someone who has lost it — the phrase is what covers *that*. Say so wherever it
is offered, or it will be found by exactly the users it cannot help.

One recovery key belongs to the account, and it is fastened in four places: each device's
db-key door, each device's `key_wrap(master, recovery)` row, each device's keychain, and
the relay's escrow (`wrap(MK, RK)`, its inverse, and the verifier hash). A rotation moves
all four, but not all at once:

- **The rotating device moves its own three immediately**, so rotation works with no
  network at all. This is deliberate: a security action must not be gated on connectivity.
- **The relay's escrow follows at the next sync** when the rotation happened offline. In
  that window the *old* phrase is still what recovers the account, so the UI must tell the
  user to keep it until then.
- **Peer devices converge on their own**, at their next launch: the relay already holds
  `wrap(recoveryKey, MK)` and every device holds MK, so a peer can learn the new key
  without the user typing anything. Until a peer converges, the old phrase still opens
  *its* local file.

Two invariants that are easy to get wrong, both learned the hard way:

- **Flush before pulling.** The rotating device runs the peer catch-up too; pulling before
  its own escrow has been flushed fetches the relay's *old* escrow and overwrites the key
  behind a phrase already shown to the user.
- **Rotation wraps the master key from the password door, never the enclave.** A device
  that lost its keychain and came back through a door holds a *fresh* enclave master key
  (the keychain held `device-id`, so a new one mints a new MK). Wrapping the phrase around
  that key publishes an escrow the account has never seen, and no device can recover from
  the phrase again.

## 7. Custody — specified in the code, not here

**Custody moved to [`@leapsake/key-custody`](../../packages/key-custody/README.md) on
2026-08-14.** It is built on both clients, so its specification lives with its implementation:
the two custody states and why the "encrypt always" default was reversed, first launch and the
"Already using Leapsake?" branch, creating an account as the act that turns encryption on, the
two exits from local-only (bind vs. merge), Locked / Sign out / Forget account, forgetting the
last device, and the key lifecycle phase by phase with its per-phase ledger.

Two pieces of the old §7 went elsewhere, each to the package that owns it:

- **One store per account, and the roster** — [`@leapsake/store-layout`](../../packages/store-layout/README.md).
- **The later phases** — creating a share (Phase 3) and granting a constrained principal
  (Phase 4) — are **not built**, so they stay design: §11 and §9.2 below.

The decisions that shaped custody but reach past it stay here, because they constrain sections
that are still unbuilt:

- **Encryption follows custody** *(decided 2026-07-26, reversing "encrypted by default, never
  plaintext")* — the app encrypts once the user holds a secret that opens it, and not before.
  It is the reason §5's tiers are reachable at all, and the reason §12's honest limits read the
  way they do.
- **Single-device is first-class; sync is fully optional** — **first-run onboarding must not
  force account/password setup.** The binding constraint is *at first run*: nothing may stand
  between opening the app and using it. It does **not** forbid inviting an account later.
- **Passphrase is the default** secret for zero-knowledge multi-device — de-facto and
  universally understood. Requiring it for multi-device is **accepted** (impossible otherwise —
  §5).
- **Passkeys are optional, added later** — not the default. The KEK layer (§4) makes adding one
  a non-migrating change: one more wrapping of the master key.
- **Recovery key generated once — at account creation, not at first launch** (§6). Shown exactly
  once, in the signup flow, framed as the forgot-password backstop.
- **SSR web app is in scope and vital** for accessibility; a heavy-JS SPA must **not** be
  required (§10). Server-side decryption for SSR / Alexa / CardDAV is **accepted**, minimizing
  what the server knows (§9).


## 8. Encryption at rest, and the `node:sqlite` tension

> **Stage 2 ([`status.md`](../status.md)) — shipped on both clients.** At-rest was **not**
> in the Stage-1 core (Stage 1 shipped the high-value sync envelope first, §2). **Decided:**
> at-rest was worth a backend swap — the `node:sqlite` preference (chosen to stay
> native-module-free) **yielded** to it: desktop runs
> `better-sqlite3-multiple-ciphers`, mobile runs `expo-sqlite` with `useSQLCipher`. Under
> §7.2 this layer is now **conditional on custody** — it protects an Authenticated store and is
> simply absent from an Unauthenticated one.

The right shape is **whole-database encryption** (SQLCipher-style: the file on disk is
ciphertext, the engine decrypts pages into memory as you query, a key is supplied at
open time). This keeps the file unqueryable-until-unlocked **while preserving
everything already built** — search-folding, kinship, timelines all run on in-memory
plaintext, untouched.

The tension: **`node:sqlite` has no encryption support**, and it was adopted (reboot
plan §3 note) specifically to *delete* the native-module ABI dance. Full-DB
encryption reintroduces a native or WASM dependency on **desktop**:

- **SQLCipher binding** — back to a native module on desktop (the thing we escaped).
- **SQLite WASM "multiple-ciphers"** in Electron — avoids the native ABI problem,
  pure-ish, but a perf/architecture change.
- **OS-level** (encrypted container / keychain-gated file) — weakest match to
  "portable + unqueryable," OS-specific.

Mitigations: the `SqliteDriver` port (`AGENTS.md`, [`packages/data`](../../packages/data/README.md)) was explicitly built so the
backend is "a one-adapter swap" — an encrypted backend is the same kind of swap.
**Mobile** is easier: expo-sqlite has a SQLCipher path (verify current SDK-56 state
before relying on it), plausibly a config + key-supply change rather than a new
engine.

At-rest and per-item keys **compose cleanly and are orthogonal** — they are layers 1 and 3
of §2, and neither is what protects sync (that is layer 2).

### 8.1 Converting an Unauthenticated store to Authenticated — one pattern, both platforms

Account creation (§7.2.1) has to turn a plaintext database into an encrypted one. The two
platforms' *native* shortcuts are mirror images, and **neither works on the other**
(verified 2026-07-26 against the shipped desktop engine):

| | `PRAGMA rekey` from plaintext | `sqlcipher_export()` |
|---|---|---|
| **Desktop** — `better-sqlite3-multiple-ciphers@12` | ✅ works | ❌ function does not exist (nor `sqlite3mc_export`/`sqlite3mc_vacuum`) |
| **Mobile** — `expo-sqlite` + SQLCipher | ❌ SQLCipher refuses to rekey a plaintext DB | ✅ the documented route |

So **use neither.** The portable pattern uses only ordinary SQL and is what
`sqlcipher_export` does internally — verified working end-to-end on desktop (tables, rows,
and indexes preserved; the output genuinely ciphertext on disk):

1. Open the plaintext store.
2. **Pin the cipher first** — `PRAGMA cipher='sqlcipher'` *before* the attach, or the new
   file is written with the library's default cipher and later fails to open with the
   misleading `file is not a database`. This bit is easy to get wrong and hard to diagnose.
3. `ATTACH` a new keyed (encrypted) file.
4. Copy schema then rows across, reading the definitions from `sqlite_master`.
5. Detach, close, move the new file into `stores/<accountId>/`, **delete the plaintext
   original** — including any `.plaintext.bak` (see below).
6. ~~Re-seal the layer-3 fields through the now-existing content cipher.~~ **This step does not
   exist.** `milestone.note` was dropped as a content-key consumer (§2.1) on 2026-07-28,
   *before* this conversion was written — deliberately, so it never grew a re-seal pass it
   would only have to delete. Layer 3 has **no domain consumer**; if one exists when you get
   here, something was built out of order: check `../status.md`.

> **The existing `<db>.plaintext.bak` must not survive this path.** Desktop's legacy
> pre-Stage-2 upgrade (`plaintext-migration.ts`) deliberately keeps that backup as a safety
> net for a one-time migration. On the account-creation path it is a plaintext copy of
> exactly what the user just asked to encrypt, so it is a footgun, not a net.

**Verified on device (2026-07-27, iOS simulator):** expo-sqlite's SQLCipher build (a)
creates *and reopens across connections* a plaintext database when no key is supplied, and
(b) runs the attach-and-copy above — schema, rows and indexes all survive, and the output
refuses a keyless read. Both halves are pinned by the custody suite in
`apps/mobile/test/custody-selftest.ts`, which runs beside the driver contract under
`pnpm test:native`, and each positive is paired with the negative that keeps it
non-vacuous. Confirmed RED by sabotage before being trusted GREEN.

> **One correction to step 2, mobile only:** `PRAGMA cipher='sqlcipher'` is a **no-op on
> mobile** — SQLCipher has exactly one cipher, and the conversion was verified to pass
> without it. The pin is a *desktop* requirement, where
> `better-sqlite3-multiple-ciphers` supports several and silently writes the default one.
> It stays in both platforms' sequence so the conversion reads identically; just don't go
> hunting for a mobile bug it isn't causing.

## 9. Zero-knowledge sync, and safe server-side decryption

### 9.1 Sync — the server becomes a dumb, blind blob store

"Decrypt only client-side, server has zero read access" is the standard **E2EE**
model (1Password / Signal-style). One consequence to accept up front:

> If the server can't read the data, **the server can't merge it.** Conflict
> resolution must happen entirely on the **client**, after decryption.

This *simplifies* the server to an **ordered, encrypted blob store + transport +
auth**. All CRDT / last-write-wins logic (now decided in [`sync.md`](./sync.md) §4) moves
client-side, which the sync-safe model (UUIDs, soft deletes, timestamps,
`deleted_at`-scoped indexes) already supports.

### 9.2 When the server *does* decrypt — minimize four exposures

The user accepts server-side decryption for the **no-JS SSR web app** and for a
possible future **Alexa**. When a server decrypts, minimize: **how long** it holds
keys, **how much** they unlock, **whether** plaintext/keys ever persist, and **who**
(operator) can see them. Two distinct scenarios:

**Scenario 1 — Trusted SSR session** (authenticated user, full account, no JS). The
server needs the user's key for the session; make the holding thin:

- **Split the session key.** At login, generate a random session key; wrap the master
  key under it; store the *wrapped* master key server-side and put the session key in
  an `httpOnly`, `Secure` cookie. Each request, the cookie brings the session key,
  the server unwraps the master key into **request-scoped memory**, renders, then
  discards. A stolen session store is useless without cookies; a stolen cookie is
  useless without the store — the server holds nothing standing-decryptable at rest.
- **Wrap the `authVerifier` under the session key too** *(added 2026-08-12, after
  building it)*. The session store cannot hold only the master key: relay sessions are
  in-memory per relay process, so a relay restart invalidates them and the render host
  must re-authenticate **without the password**. That means it must keep the
  `authVerifier` — which is a standing relay credential. Held in the clear beside the
  wrapped master key it partly defeats the split, because a store thief gets read and
  write access to all of the account's ciphertext without ever touching a cookie.
  Wrapping it under the same session key is one more line and restores the property.
- **Memory-only, request-scoped, zeroized.** Keys/plaintext never touch disk, logs,
  swap, error traces, or APM. Rendered HTML with plaintext is `Cache-Control:
  private, no-store` — never in a shared cache/CDN.
- **The decrypted *store* is request-scoped too — warm the key, not the database**
  *(measured 2026-08-12)*. The tempting optimization is a per-session decrypted SQLite
  kept between requests, and it would quietly break the bullet above: a fully decrypted
  database in server memory, readable without any cookie, for the session's lifetime.
  It is also unnecessary. Argon2id — not the pull — dominates the cold path (~355 ms at
  every store size), so a **warm key with a cold store** is both the private answer and
  a fast one: rebuilding the store per request costs a **6.6 ms p50 at 100 people and
  36.8 ms at 1 000**. Build cold; if a store ever grows large enough to hurt, the answer
  is an incremental sync cursor, not a warm database.
- **Short session TTL + re-auth** for sensitive actions.
- **Ceiling (later, if ever):** run the decrypting renderer inside a
  **confidential-computing enclave** (AWS Nitro / GCP Confidential VM) so the key and
  plaintext live only in attested memory the operator can't read, with remote
  attestation that only audited code touches the key. Named as the ceiling, **not**
  V3 scope.

**Scenario 2 — Constrained server principal** (Alexa, link previews, hosted shares).
Much stronger: **never give this server the master key.** Wrap *only the specific
item content keys it needs* under a **dedicated server keypair**. Blast radius =
exactly those items, forever-scoped, revocable by deleting that wrapped key. It is the
*same primitive* as sharing with a friend — the constrained server is just another
recipient.

### 9.3 Login secret handling (progressive)

- **No-JS login:** browser POSTs the passphrase; server derives the KEK, unwraps,
  **discards the passphrase** (never stored). Server transiently sees the passphrase —
  the accepted trust cost.
- **JS login:** a *tiny* script derives the KEK in-browser and sends only a
  separately-derived **auth verifier**, never the passphrase or encryption KEK — the
  server *cannot* derive the encryption key.

This relies on the standard split: derive **two** values from the passphrase (one to
authenticate, one to encrypt); the server only ever stores the **auth verifier**,
never anything that reveals the encryption KEK.

### 9.4 CardDAV / CalDAV server (longer-term)

A longer-term goal: expose People (and dated milestones) over a **CardDAV/CalDAV**
endpoint so any device's native Contacts/Calendar app can subscribe — the broadest
possible "use your data anywhere" reach, since those protocols are ubiquitous.

This is accurate to suspect it behaves **like the SSR session and the Alexa
integration**: the protocol clients (Apple Contacts, etc.) cannot do Leapsake's
client-side decryption, so a Leapsake-run CardDAV/CalDAV server must hold keys and
**decrypt server-side** to serve vCards/iCalendar. It is therefore **not
zero-knowledge** for the data it exposes — a deliberate, opt-in downgrade, exactly
the configurable-dial pattern (§5).

It sits between the two §9.2 scenarios and leans toward **Scenario 2 (constrained
principal)**: scope it to **only the contact/calendar slice** by wrapping just those
item content keys to a **dedicated CardDAV server keypair** — never the master key —
so enabling it exposes contacts/dates and nothing else, and revoking is deleting that
wrapped-key set. Because the protocol clients authenticate with their own
credentials (and many only support Basic auth over TLS), treat that endpoint as a
standing trusted reader of a narrow slice, hold decrypted data only per-request in
memory (§9.2), and make the whole feature an explicit opt-in with a clear "this lets
our server read your contacts" disclosure.

## 10. The web app: progressive enhancement *of privacy*

"SSR web app" and "PWA" are **not two apps** with two privacy models. They are **one
app**, where JS is a progressive enhancement that upgrades *privacy*, not just
interactivity:

| Mode | Who decrypts | Privacy | Role |
|---|---|---|---|
| **No-JS SSR** | the render server (trusted, transiently — §9.2) | Tier-1-for-the-session | accessibility floor — always works |
| **JS-enhanced / PWA** | the browser, client-side | zero-knowledge | the upgrade you get for free when JS runs |

The app **fully works with no JS** (the accessibility requirement) and
**automatically becomes zero-knowledge when JS is available**. JS just moves the
decryption boundary from server to client.

*The read path is proven, and the gap is named* **(2026-08-12)**. A person's page
server-renders with JavaScript disabled — every mutation on it is already expressed as
navigation to a `/new`, `/edit`, or `/delete` route, so it needed no shared-package
change. Two sections are **not** there yet and are the accessibility floor's actual
backlog: `HolidaysSection`, whose add-field is a Combobox (a `<form>` + `<select>` is a
direct swap, the data being loaded already), and `GiftsSection`, where `GiftCaptureForm`
emits a bare `<form>` with no `method`, no `action`, and no `name` on any field — so a
no-JS submit posts nothing, nowhere. Until those land, "fully works with no JS" is the
requirement, not yet a description. This resolves the latent contradiction in
the V3 web goal ("server-rendered… no client JS required", [`status.md`](../status.md)) vs.
client-side-only decryption: **encrypted content is client-rendered when JS is present and
server-rendered (trusted) when it is not.** *(The V3 web scope in `status.md` states this
explicitly.)*

### 10.1 The web client requires a sync account — durability is not grantable *(owner, 2026-08-15)*

**A browser cannot promise to keep what you store in it, so the web client must never hold
the only copy of anything.** Desktop and mobile write to app-data directories that no eviction
heuristic touches; a browser's storage is evictable by policy, and no API upgrades that into a
guarantee. This is a platform fact, not a preference, and it is the one place where a client
cannot be given the same promise as the others.

Measured on the spike's *installed* PWA (Chrome 151, `localhost`, 2026-08-14):

```
best-effort (evictable) storage — persist() was refused, 8.8 MiB used of 10.0 GiB
 · running as: standalone
```

`standalone` is the install having taken effect, so that is the installed origin's answer, not a
tab's. It **contradicts Chrome's own documented criteria**, which name PWA installation as one of
the things that grants persistence — leaving site engagement (zero on a minute-old install) or a
`localhost` exclusion as the explanations. Not chased further: *no more measurement*
**(owner, 2026-08-14)**.

**Durability is unguaranteed, not absent** — and the distinction is load-bearing, because someone
will eventually observe a granted bucket and should not conclude this rule was wrong. Chrome may
grant on a real HTTPS origin with engagement; WebKit deletes all script-writable storage after
**seven days** without interaction, but **exempts home-screen web apps** from that sweep. Two
vendors, two mechanisms, both heuristic, both changed before. What no vendor offers is a promise
an app can rely on, and even a granted bucket survives neither an uninstall nor a user clearing
site data.

The rule that follows:

| | may hold the only copy | why |
|---|---|---|
| **Desktop / mobile** | **yes** | app-data directories; no eviction heuristic applies |
| **Web / PWA** | **no — sync account required** | storage is evictable by policy, at the browser's discretion |

**The account does not make browser storage durable; it makes durability stop mattering.** With
one, eviction costs a single Argon2id and a full re-pull. Without one, it costs the account. So
the requirement is *an account with sync* — self-hosted or hosted, free or paid, which is a
pricing question that must be free to move without anyone thinking this safety rule lapsed.

**This does not weaken offline.** Offline-capable and sole-copy are different claims: the spike's
installed client resumed in 69.3 ms with 0 bytes on the wire, and that result stands whole. It is
filed under availability and speed rather than durability, and the local store is a **cache that
happens to be fast** rather than a home.

**The residual risk, named because requiring an account does not remove it:** a write made
offline and evicted before it ever reaches the relay is gone, account or no account. Requiring
sync shrinks the blast radius from *everything* to *unsynced writes*; closing the remainder is a
UI obligation — the web client owes an honest indication of what has and has not reached the
relay, and possibly a decision not to offer extended offline *writing* on web at all. Open, and
it belongs to whoever builds Stage 4.

## 11. Sharing

Per-item keys + wrapping give four modes from one mechanism:

| Mode | How |
|---|---|
| **Public link (unauthenticated)** | `https://app/share/<id>#<key>` — the `#fragment` is **never sent to the server**; the server returns ciphertext, client JS reads the key from the fragment and decrypts locally. Zero-knowledge (Mega / Bitwarden Send model). |
| **Authenticated-user-only** | Wrap the content key under the recipient's **public key**; only their private key unwraps it. Needs a per-user public-key directory. |
| **Revocable** | The server gatekeeps *delivery of the ciphertext*. Disable the share record → server stops serving the blob → the link dies (the key alone is useless without the blob). |
| **Time- / visit-limited** | A server-side access policy (`expiresAt`, `maxVisits`, `allowedUserIds`); the server refuses to serve once the policy fails. |

**Two flavors of public link** fall out, and the choice should be explicit:

- **Capability link** — key in `#fragment`, client-rendered, **zero-knowledge**.
  *Default.*
- **Hosted link** — server holds the key (wrapped to its own keypair, §9.2 Scenario
  2), **SSR-able**, supports no-JS viewers / link previews / SEO — but the server can
  read it.

Per the product philosophy: **default to capability links; make "hosted link" an
explicit, clearly-labeled opt-in** the sharer chooses when they specifically want
no-JS/preview behavior.

*Both flavors are built and observed, and one product rule falls out*
**(2026-08-12)**. The spike made and viewed each one: a capability link's key was seen
never to reach the server (the request line arrives with the fragment already stripped)
and the page it serves carries ciphertext and no plaintext; the hosted link renders the
same payload through the *same shared screen*, server-side, with no `<script>` in the
response at all. The mechanism is one code path — seal under a content key — differing
only in whether the server keeps that key. Two things the design should absorb:
**a capability link can never be re-shown** (its key exists only for the duration of the
request that mints it, so "copy it now" is a rule the sharing UI has to state, where a
hosted link can always be looked up again); and **every mode in the table above renders
somebody else's screen**, which the shared screens are not yet shaped for — rendered
unauthenticated, `RelationshipScreen` still offers Edit / Delete / Add-milestone and
leaks the item's internal id. A read-only mode is small, and it is a prerequisite for
sharing rather than a polish item. Evidence:
[`../web-client.md`](../web-client.md) → *Sharing*, and in full at
`git show web-spike-final:apps/web-spike/README.md` → *Increment 4*.

**Photos / large binaries** introduce **blob/object storage** (photos don't belong in
SQLite rows). Same per-item-key model — encrypt each blob with a content key, store
ciphertext in object storage, wrap keys as above. A storage concern, not a
crypto-model change. The file-layer design invariants (separate blob channel, resumable
chunked transfer, client-computed encrypted derivatives, the `BlobStore` port) are pinned
in [`../v0-2.md`](../v0-2.md).

## 12. The honest trust boundary & limits

State these explicitly; they are conscious decisions, not gaps:

- **Content confidentiality is cryptographic / zero-knowledge** — the server cannot
  read content (Tier 2).
- **Access policy (expiry, visit counts, revocation) is server-enforced and therefore
  *trusted*** — it is the server honestly refusing to serve, not math. The server is
  an *honest-but-curious blind blob store*.
- **Revocation cannot recall an already-downloaded copy** — same as Google Drive; it
  stops *future* fetches. True forward-revocation needs re-encryption under a new key.
- **Metadata still leaks** to the server: who shares with whom, when, blob sizes,
  record counts, sync timing. Hiding metadata is a much larger project; **out of
  scope** for V3.
- **Lost password + lost recovery phrase = unrecoverable data** at Tier 2 (§6).
- **Before an account exists, nothing on disk is encrypted** (§7.2). An Unauthenticated store is a
  readable SQLite file, exactly like most local-first apps, and is covered only by the
  platform's own full-disk encryption. This is a deliberate trade against a worse failure
  (§7.2's reasoning), not an oversight.
- **Data written before an account may leave traces after conversion** (§7.2.1). The live
  database is rewritten and the plaintext original deleted, but deleted bytes can linger in
  free space and are not reliably erasable on SSDs.
- **The on-device account roster is unencrypted** (§7.4) — the usernames present on a
  client are readable without any key, because the login picker must render before
  anything is unlocked.

## 13. Clients are "principals you wrap keys to" — the `KeyStore` port

Current clients are desktop + mobile; future considerations: **SSR web, PWA, CLI,
tvOS, Alexa**. (Aware-of, not fully-futureproofed.) Clients differ on two axes — *can
they do client-side crypto* and *where can they store a key safely* — so abstract the
second behind a **`KeyStore` port**, the same move as the `SqliteDriver` port.

| Client | Client-side crypto? | Key storage | Notes |
|---|---|---|---|
| **Desktop / Mobile** | Yes | OS keychain / Secure Enclave (best) | full zero-knowledge; the easy cases |
| **CLI** | Yes | OS keychain or prompted passphrase | power-user friendly |
| **tvOS** | Yes | Secure Enclave | typing a passphrase on a remote is misery → **enroll by QR / device-linking from the phone**, don't prompt |
| **PWA** | Yes (WebCrypto) | IndexedDB + a non-extractable `CryptoKey` satisfies the port today; **passkey PRF** is what it still lacks, and the bucket is **evictable** either way | see below — the floor works, the ceiling and the durability do not |
| **SSR web** | server decrypts | n/a | trusted session / progressive enhancement (§9.2, §10) |
| **Alexa** | **No** — voice→cloud; the "client" is Amazon's server running the skill | server-side | **can't be zero-knowledge**; model as a constrained principal (§9.2 Scenario 2) — wrap only specific item keys to it |
| **CardDAV / CalDAV** | **No** — native Contacts/Calendar apps speak the protocol; a Leapsake server serves vCards/iCalendar | server-side | **can't be zero-knowledge** (§9.4); constrained principal scoped to the contact/calendar slice — wrap only those item keys to a dedicated server keypair |

The payoff: a client that can't do client-side crypto (Alexa) or can't hold keys well
(web without passkeys) is **not a special case** — it is "a principal you wrap
specific item keys to, at the security level the user chose." The mechanism is
uniform; clients differ only in *which keys they may hold and where they store them.*

**The PWA row in three parts, because "weak" hid the fact that something works** *(built and
measured 2026-08-13/14)*:

- **The port is satisfied today.** A non-extractable `AES-GCM` `CryptoKey` per secret in
  IndexedDB implements `getSecret` / `setSecret` / `deleteSecret` **as written** — ~60 lines, no
  widening of the port, and `exportKey` refused on every run. An attacker who reads IndexedDB
  gets a wrap they cannot open anywhere else.
- **Passkey PRF is what it still lacks: user presence.** Non-extractable stops *exfiltration*,
  not *same-origin use* — using the key is the entire point of storing it, so a background XSS
  can still ask for it. PRF adds a per-unlock gesture that XSS cannot supply. So PRF stays the
  designed answer, and the above is the floor rather than the ceiling.
- **Durability is a third axis, and it is not custody's to fix.** `persist()` is
  `[Exposed=Window]`, so the thread that owns the data cannot even ask — the *page* must, which
  is one more thing a real client's startup owes beside the manifest and the service worker. And
  the answer may be no regardless: refused on `localhost`, **and refused on an installed
  origin** (§10.1). The failure mode is mild by construction — eviction costs one Argon2id and a
  re-pull, **not an account** — but only because §10.1 requires the account.

## 14. Decentralization vs. shareable URLs → a hybrid topology

The deepest tension: **a public URL needs a durable, addressable host**; pure P2P has
none. So "decentralized / offline-first / P2P" and "share a link that opens anywhere"
genuinely diverge. Resolution is a **hybrid**:

- **Personal multi-device sync** → P2P or a dumb relay, fully E2EE.
- **Sharing + web** → a **centralized but blind** server: hosts ciphertext at stable
  URLs, enforces access policy, still cannot read anything.

"Centralized vs. decentralized" stops being binary — the server is centralized for
*availability and policy* and decentralized-grade for *confidentiality*. That is the
Google-Drive-convenience-with-zero-knowledge sweet spot.

> **True P2P is a deferred *adapter*, not a closed door.** Because content is encrypted
> *before* it leaves the device, the transport is untrusted and therefore swappable —
> the blind relay is one adapter behind a `SyncTransport` port; a P2P transport is
> another, addable later without reshaping the model. [`sync.md`](./sync.md) owns that
> seam, the merge-model decision it constrains, and exactly what must *not* be assumed
> (a server-authoritative ordering) to keep the P2P door open.

