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
> **Companion docs:** [`schema.md`](./schema.md) (the key tables — §7.5's ledger as SQL),
> [`sync.md`](./sync.md) (the transport seam + merge model + the P2P decision),
> [`security-review.md`](./security-review.md) + [`security-findings.md`](./security-findings.md)
> (the audits). Start at [`README.md`](./README.md) if you're new to this folder.

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
> layer 2 — [`../files.md`](../files.md) invariant #2 is built on it. It is also the only
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
| **0 — Open** | server holds key / no envelope | **Yes** | trivial | server-side compute: search, SSR, Alexa |

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

## 7. Decisions locked in discussion

Each line is a settled decision; the section it points to has the reasoning.

- **Encryption follows custody** *(decided 2026-07-26, reversing "encrypted by default,
  never plaintext")* — the app encrypts once the user holds a secret that opens it, and
  not before. First run mints **no keys and encrypts nothing**; creating an account turns
  on all three layers of §2 at once. Reasoning and the full state table: §7.2.
- **Single-device is first-class; sync is fully optional** — **first-run onboarding must
  not force account/password setup.** The binding constraint is *at first run*: nothing
  may stand between opening the app and using it. It does **not** forbid inviting an
  account later, once the user has data to protect — that invitation is exactly how
  encryption gets turned on (§7.2). A password is required for sync / a 2nd device.
  Flow in §7.1.
- **Passphrase is the default** secret for zero-knowledge multi-device — de-facto and
  universally understood. Requiring it for multi-device is **accepted** (impossible
  otherwise — §5).
- **Passkeys are optional, added later** — not the default. The KEK layer (§4) makes
  adding one a non-migrating change (one more wrapping of the master key).
- **Recovery key generated once — at account creation, not at first launch** (§6). It is
  shown exactly once, in the signup flow, framed as the forgot-password backstop. The
  enclave caches the unlock so a password isn't re-typed **every** launch; a bounded
  session lifetime over that cache is compatible with this and is the mechanism behind
  **Lock** (§7.3).
- **SSR web app is in scope and vital** for accessibility; a heavy-JS SPA must **not**
  be required (§10). Server-side decryption for SSR / Alexa / CardDAV is **accepted**,
  minimizing what the server knows (§9).

### 7.1 First-launch onboarding — the "Already using Leapsake?" branch

One prompt on first launch decides the path. The two branches now differ in **custody**,
not only in sync:

| Answer | Means | What happens |
|---|---|---|
| **Yes** | a 2nd+ device | log in to the existing account → prompt for **username + password** → the store is created **encrypted from byte one**; nothing is ever written plaintext |
| **No** | fresh install | straight into the app with **no keys and no encryption** (Tier 3, §5). An account is *invited* later (§7.2), never demanded |

A password is never required to *start* using Leapsake on one device. The "No" branch is
the only path that ever writes a plaintext store, and it stops being plaintext the moment
the user creates an account.

### 7.2 Custody states — the two ways a client can exist *(decided 2026-07-26)*

**The reasoning.** The old default encrypted the file at first launch under a key held
only by the OS keychain. That trade was bad in both directions: it bought little (it
guards a copied file, which platform full-disk encryption largely covers already) and it
cost a lot (if the keychain is ever lost — OS reinstall, migration, repair, or the Team-ID
change in [`../launch.md`](../launch.md) §2 — the *only* way back was a 24-word phrase the
user had never been asked to save). A key the user does not hold protects little and can
lose everything. So: **no custody, no encryption.**

| | **Open** | **Protected** |
|---|---|---|
| **Custody** | none | username + password, with a recovery phrase as the backstop |
| **Created** | at first launch, silently | when the user creates their account (§7.2.1) |
| **Store on disk** | plaintext, queryable | encrypted (layer 1) |
| **Keys in the OS keychain** | **none at all** | db-key, master key, recovery key |
| **Layers active (§2)** | none | 1, 3, and 2 once relay-bound |
| **Sync / sharing** | impossible — there is no MK to seal under | available; binding a relay is a further step |
| **OS keychain wiped** | **nothing is lost** — the file just opens | password opens it; phrase is the backstop |
| **Tier (§5)** | 3 | 2 |

Only two states, and **relay-bound is not a third** — it is a Protected account that has
also registered with a relay. This matters: local-only and synced users have *identical*
custody, so "start syncing later" adds a relay binding rather than a new ritual.

#### 7.2.1 Creating an account is the act that turns encryption on

**Username + password is required to turn encryption on** *(decided 2026-07-27)*. The
alternative considered and rejected was a phrase-only "accountless encryption": it makes the
recovery phrase the *primary* credential — reviving the exact unfamiliar ritual this decision
exists to demote — leaves one door instead of two, and terminates at a password anyway the
moment the user wants sync, having added a third custody state and a second conversion to
the boot path on the way.

> **The word, not the mechanism, is the thing to soften.** A username and password stored
> only on this device is *accountless* in every sense a user cares about: no email, no
> server, nothing transmitted, nobody to notify. "Account" is our vocabulary. If it reads as
> too heavy for something that never leaves the laptop, change the label — "Protect your
> data", "Set up your login" — not the mechanism.

There is **one** operation, reachable from two places — the Home invitation once the user
has data to lose, and a Settings control for anyone who wants it sooner. Both run the same
flow, and it is fully local: no relay, no email, nothing leaves the device.

1. Choose a **username + password**. The username is a login handle, and is what later
   allows several accounts to share one client (§7.4).
2. Mint db-key, master key, and recovery key; write the password- and recovery-wrapped
   sidecars beside the store.
3. **Convert the Open store to Protected** (§8.1) and destroy the plaintext original.
4. Show the **recovery phrase once**, as the forgot-password backstop.

> **The copy must promise access, not safety.** A local account protects against *this
> device losing its security settings*; it does **not** protect against a lost or broken
> device. Say so in the flow, and point at sync or a file backup for that. Getting this
> wrong borrows the user's SaaS instincts and then violates them on the worst day.

**The honest limit of converting late.** Data typed before the account existed was written
to disk in the clear. The conversion writes a *new* encrypted file and deletes the
original, so no plaintext survives inside the live database — but deleted bytes can linger
in free space, and on SSDs cannot be reliably erased. **Accepted** (owner, 2026-07-26): the
window is small, it requires physical access to the disk to exploit, and the alternative is
the data-loss path above. It is stated in §12 rather than glossed.

### 7.3 Locked, Sign out, Forget account *(decided 2026-07-27)*

Three concepts, no overlap. **One state, two actions.**

| | What it is |
|---|---|
| **Locked** | a **state** — the store is closed and the password reopens it. Reached automatically (idle / session expiry) or deliberately |
| **Sign out** | a user **action** → the Locked state. *Identical for local-only and synced users* |
| **Forget account** | a user **action** → this account and its data are removed from this device |

The reason this shape is right: **Sign out does not have to behave differently by custody
state.** Both users get the same promise — *nobody can see my data on this device anymore* —
and the only difference (whether the bytes remain, encrypted) is invisible to that intent.
One honest line covers it for a local-only user: *"Your data stays on this device,
encrypted. You'll need your password to get back in."*

Purging lives entirely in **Forget account**, which is named as removal so it can never be
mistaken for signing out.

> **"Make local-only" was cut** *(owner, 2026-07-28)*. This section used to name a third,
> non-destructive action — leaving the relay while keeping the data — backed by
> `clearLocalAccount`. The custody rebuild made its shipped form incoherent: it cleared the
> account rows but never the **roster**, and the roster is what decides whether a store is
> encrypted (§7.4), so a device that used it stayed Protected on disk while reporting no
> account — hiding Sign out and Forget account, and offering an account-creation path that
> then refused, since creation requires a plaintext Open store.
>
> It was removed rather than repaired. The want is narrow (creating a local account,
> promoting it to a synced one, and starting out synced are all covered), and repairing it
> is not a local edit: "drop only the relay binding" has to decide what becomes of the
> account on the relay, whether the username is retained for re-binding, and how that
> interacts with the username-collision question that is still open. Cheap to rebuild later
> if the want turns out to be real. `clearLocalAccount` itself survives as what it is
> actually good at — the rollback when relay registration fails mid-creation, before
> anything on disk has moved.

> **Do not invent a "Lock" button.** Locked is a state, not an affordance. The app enters it
> on your behalf when idle; the user reaches it by signing out.

**v0.1 ships the deliberate half only** *(scope decision, owner, 2026-07-27)*. Sign out and
Forget account are cheap — close or delete the store. **Automatic** locking is not: a real
session needs mid-session re-lock in the desktop main process and mobile's bootstrap, and it
must be a genuine re-lock rather than theater, since the keychain still holds the db-key and
a relaunch would otherwise walk straight past it. That is deferred to v0.2. Nothing about it
is a one-way door — the session sits on top of the same password door either way.

#### 7.3.1 Forgetting the last device — ask the relay, assume the worst

Forgetting an account on its **last remaining device** is functionally a deletion *unless
some server durably holds a copy*. Two facts make this sharper than it first looks:

- [`sync.md`](./sync.md) §2 designs the relay to be **disposable** — devices self-heal it —
  so a relay is explicitly *not* a backup.
- **Not every relay will offer backup.** Someone has to host that data; a self-hoster may
  choose to, and many will not. It is a property of *who is hosting*, so it is a **relay
  capability**, not an account setting.

Therefore the client **asks** rather than assumes: the relay advertises whether it retains a
durable copy, and **absent that advertisement, assume it does not.** Defaulting to "no"
fails safely — the worst case is over-warning.

| Durable server copy | What Forget account means here | How to say it |
|---|---|---|
| **No** (default, and today always) | the last copy is destroyed | word it as **"Delete all data on this device"**, hard-confirm, and offer an export first |
| **Yes** (a relay that opts in) | ordinary — sign back in and re-pull | the normal Forget confirmation |

Build this as a *check*, not a hardcoded string: when server-side backup ships, alarming copy
must stop appearing on its own rather than being hunted down. The capability should also be
**visible** — "This server does not keep a backup of your data" is honest for self-hosters
and a real differentiator for the eventual paid relay.

### 7.4 One store per user, not one store per client *(direction, 2026-07-26)*

A client holds **one Open store or many Protected ones** — the same shape
[`../product-truths.md`](../product-truths.md) already states for users ("one
unauthenticated user OR multiple authenticated users"). Each account gets its **own
encrypted database file**, which is what makes both delta #1 (per-user isolation) and
**Forget account** (§7.3) clean rather than surgical:

```
<userData>/stores/
  local/leapsake.db                  ← the Open store (plaintext), before any account
  <accountId>/leapsake.db            ← one encrypted store per account on this client
  <accountId>/leapsake.db.recovery   ← its sidecars (recovery + password doors)
<userData>/accounts.json             ← the roster: which accounts exist on this client
```

- **Creating an account** writes `stores/<accountId>/` and removes `stores/local/`.
- **Logging out** deletes `stores/<accountId>/` and its roster entry. Nothing to sift.
- **The roster must be readable before any store opens** (you cannot enumerate accounts
  from inside files you cannot decrypt), so it is **unencrypted** and leaks the usernames
  present on the device. Accepted and unavoidable — a login picker has to render.

The per-account path is the load-bearing part. It is cheap now and expensive once real
users have data, so **new work must not assume a single fixed database path**, even while
only one store exists.

### 7.5 The key lifecycle, phase by phase

*(Absorbed from the former `custody-sequence.md`, 2026-07-27 — it had become the same story
told twice. The per-phase **key ledger** is the part worth keeping: it makes the schema
readable straight off the sequence.)*

Every key in play, and who makes it:

| Key | Created by | Purpose |
|---|---|---|
| **Master key (MK)** | client, at account creation | the root; wraps everything below. Never derived from the password (§4) |
| **Enclave key** | OS keychain / Secure Enclave | a device's local unlock path for MK |
| **db-key** | client, at account creation | the whole-DB at-rest key (§8); read from a sidecar *before* the store opens |
| **Recovery key (RK)** | client, at account creation | out-of-band unlock for MK **and** db-key; the 24 words encode it; user-held, never stored by us |
| **KEK** | `Argon2id(password, salt)` | the password unlock path for MK and db-key |
| **Auth verifier** | separate derivation from the password | what a relay stores to authenticate login — reveals nothing about the KEK (§9.3) |
| **Content key (CK)** | client, per shareable unit | encrypts one item/blob; wrapped for each principal that may read it (§3) |
| **Account keypair** | client, Stage 3 | public key published to a directory; private key (MK-wrapped) opens shares sent to you |
| **Principal keypair** | per server integration | a constrained reader (Alexa / CardDAV / hosted link) you wrap *specific* CKs to (§9.2) |
| **Session key** | server, at SSR login | wraps MK for one trusted SSR session (§9.2 Scenario 1) |

The **invariant** through every phase: a server never holds an *unwrapped* MK at rest, and
never holds the password, KEK, or RK at all.

**Phase 0 — First launch, fresh install.** No prompt beyond "Already using Leapsake?" → No.
**No keys are created — the OS keychain stays empty** — and the store is written plaintext.
All three layers of §2 are inactive; nothing leaves the machine.
> *Ledger: empty.* Wiping the keychain costs this user nothing, and the file opens anywhere
> it is copied. That is the point (§7.2).

**Phase 0.5 — Create an account.** The pivotal phase (§7.2.1), reached from the Home
invitation or Settings. Fully local. Mints **MK, enclave key, db-key, RK, KEK, and the auth
verifier** — the verifier now, though no relay exists, so binding one later adds no new
ritual. Persists `wrap(MK, enclave)`, `wrap(MK, KEK)`, `wrap(MK, RK)` inside the store, and
beside it the two **db-key sidecars**, `seal(db-key, RK)` and `seal(db-key, KEK)`. Sidecars
are separate files by necessity: they are read *before* the database can open. Then converts
the store (§8.1) and destroys the plaintext original.
> *Ledger:* MK and db-key each reachable by enclave, password, or phrase. The user holds two
> secrets — one chosen, one generated — and the keychain is no longer a single point of
> failure.

**Phase 1 — Bind the account to a relay.** Because 0.5 already minted the password door, the
recovery key, and the verifier, this phase creates **no new key material at all** — it only
publishes what exists. That convergence of local and synced custody is the payoff. The relay
receives the salt (public), the auth verifier, `wrap(MK, KEK)`, and the recovery escrow. It
**cannot** derive the KEK, so it cannot unwrap MK: zero-knowledge holds, and this is where
encryption layer 2 starts working. The relay is authoritative over usernames, so binding must
be able to **rename** (see `status.md` → Open questions).
> *Ledger:* unchanged from 0.5, plus the relay's copy of `wrap(MK, KEK)` + verifier + salt.

**Phase 2 — Add a second device.** Joins the account by username + password; it consumes the
password door and never needs the RK or device 1's enclave key. **Its store is created
encrypted from byte one** — a joining device knows the account exists before it writes a row,
so it never passes through the Open state (§7.1). It derives the verifier → authenticates →
receives `wrap(MK, KEK)` → derives the KEK locally → unwraps MK into memory → mints its *own*
enclave key and db-key, adds `wrap(MK, device-2 enclave)`, and caches the unlock.
> *Ledger:* MK reachable from either device's enclave, the RK, or the KEK. Two devices, one
> account, relay still blind.

**Phase 3 — Create a share** *(Stage 1 for capability links; Stage 3 for authenticated)*.
Every shareable unit owns a CK; sharing is *wrapping that CK for a new reader*. **Capability
link** (default): the CK rides the URL `#fragment`, which is never sent to the server, so
there is deliberately **no** stored wrap — that absence is what makes it zero-knowledge.
**Authenticated share:** fetch the recipient's public key from the directory and store
`wrap(CK, recipient_public)`. Revocation is the server refusing to serve the blob (§12), not
math.

**Phase 4 — Grant a constrained principal** *(Stage 3–4)*. For clients that cannot do
client-side crypto. **Preferred (4a):** wrap *only the specific CKs* a principal needs under
its dedicated keypair — never MK — so the blast radius is exactly those items and revoking is
deleting that wrapped-key set. **Heavier (4b):** the trusted SSR session, where the server
transiently unwraps MK per request (§9.2 Scenario 1), reserved for the no-JS floor.

What falls out for the schema — see [`schema.md`](./schema.md), which turns this ledger into
tables: a wrapped-key store (`key_wrap`, one row per unlock path or grant), an
account/identity table, a device registration table, a per-item content-key registry, and a
share/access-policy table. Plus one thing that is deliberately **not** a table: the
**on-device account roster** (§7.4), which lives outside every store, unencrypted, because it
must be readable before any store can be opened.

## 8. Encryption at rest, and the `node:sqlite` tension

> **Stage 2 ([`status.md`](../status.md)) — shipped on both clients.** At-rest was **not**
> in the Stage-1 core (Stage 1 shipped the high-value sync envelope first, §2). **Decided:**
> at-rest was worth a backend swap — the `node:sqlite` preference (chosen to stay
> native-module-free) **yielded** to it: desktop runs
> `better-sqlite3-multiple-ciphers`, mobile runs `expo-sqlite` with `useSQLCipher`. Under
> §7.2 this layer is now **conditional on custody** — it protects a Protected store and is
> simply absent from an Open one.

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

### 8.1 Converting an Open store to Protected — one pattern, both platforms

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
- **Memory-only, request-scoped, zeroized.** Keys/plaintext never touch disk, logs,
  swap, error traces, or APM. Rendered HTML with plaintext is `Cache-Control:
  private, no-store` — never in a shared cache/CDN.
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
decryption boundary from server to client. This resolves the latent contradiction in
the V3 web goal ("server-rendered… no client JS required", [`status.md`](../status.md)) vs.
client-side-only decryption: **encrypted content is client-rendered when JS is present and
server-rendered (trusted) when it is not.** *(The V3 web scope in `status.md` states this
explicitly.)*

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

**Photos / large binaries** introduce **blob/object storage** (photos don't belong in
SQLite rows). Same per-item-key model — encrypt each blob with a content key, store
ciphertext in object storage, wrap keys as above. A storage concern, not a
crypto-model change. The file-layer design invariants (separate blob channel, resumable
chunked transfer, client-computed encrypted derivatives, the `BlobStore` port) are pinned
in [`../files.md`](../files.md).

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
- **Before an account exists, nothing on disk is encrypted** (§7.2). An Open store is a
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
| **PWA** | Yes (WebCrypto) | weak — IndexedDB, no enclave → **passkey PRF** is the right custody answer | key custody is the whole problem on web |
| **SSR web** | server decrypts | n/a | trusted session / progressive enhancement (§9.2, §10) |
| **Alexa** | **No** — voice→cloud; the "client" is Amazon's server running the skill | server-side | **can't be zero-knowledge**; model as a constrained principal (§9.2 Scenario 2) — wrap only specific item keys to it |
| **CardDAV / CalDAV** | **No** — native Contacts/Calendar apps speak the protocol; a Leapsake server serves vCards/iCalendar | server-side | **can't be zero-knowledge** (§9.4); constrained principal scoped to the contact/calendar slice — wrap only those item keys to a dedicated server keypair |

The payoff: a client that can't do client-side crypto (Alexa) or can't hold keys well
(web without passkeys) is **not a special case** — it is "a principal you wrap
specific item keys to, at the security level the user chose." The mechanism is
uniform; clients differ only in *which keys they may hold and where they store them.*

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

