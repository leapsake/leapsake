# @leapsake/key-custody

How a device **obtains, holds, escrows, and relinquishes** the account master key.

**This README is where custody is specified.** It was `plans/encryption/model.md` §7 until
2026-08-14; it moved here because every part of it is built, on both clients, and a
specification that lives away from its implementation drifts from it. The design it sits
inside — the three layers, the envelope, the key hierarchy — is still
[`plans/encryption/model.md`](../../plans/encryption/model.md); what *sharing* and the *web
app* will later do with these keys is still design, and stays there too.

> **The decision, in one sentence:** Leapsake **encrypts once the user holds a secret that
> opens it, and not before.** A fresh install mints no keys and writes a plaintext store;
> creating an account (username + password) is the single act that turns encryption on, and
> joining or recovering one does the same on that device. A lost keychain is answered by the
> password, with the 24-word phrase as the forgot-password fallback.

## Custody states — the two ways a client can exist *(decided 2026-07-26)*

**The reasoning, because it reversed the previous default.** The old design encrypted the
file at first launch under a key held only by the OS keychain. That trade was bad in both
directions: it bought little — it guards a copied file, which platform full-disk encryption
largely covers already — and it cost a lot, because if the keychain was ever lost (OS
reinstall, migration, repair, or the signing-identity change below) the *only* way back was a
24-word phrase the user had never been asked to save. **A key the user does not hold protects
little and can lose everything.** So: no custody, no encryption.

|  | **Unauthenticated** | **Authenticated** |
|---|---|---|
| **Custody** | none | username + password, with a recovery phrase as the backstop |
| **Created** | at first launch, silently | when the user creates their account |
| **Store on disk** | plaintext, queryable | encrypted (layer 1) |
| **Keys in the OS keychain** | **none at all** | db-key, master key, recovery key |
| **Layers active** | none | 1, 3, and 2 once relay-bound |
| **Sync / sharing** | impossible — there is no MK to seal under | available; binding a relay is a further step |
| **OS keychain wiped** | **nothing is lost** — the file just opens | password opens it; phrase is the backstop |

Only two states, and **relay-bound is not a third** — it is an Authenticated account that has
also registered with a relay. This matters: local-only and synced users have *identical*
custody, so "start syncing later" adds a relay binding rather than a new ritual.

> **The state names the account, not the file** *(renamed 2026-07-31)*. Everything below
> *Custody* in that table is a **consequence** of the row above it, not part of the
> definition: an account exists, therefore keys exist, therefore the store is encrypted. Read
> the table downward and it derives; read it as a list and the two get conflated.
>
> Why that separation is worth keeping explicit: [`plans/v0-2.md`](../../plans/v0-2.md)
> anticipates a user **opting out of encryption while holding an account**, which severs
> exactly this implication. When that lands, only the *Store on disk* row changes — the state
> itself still means what it says.

### Three questions, three vocabularies

Three **independent** questions get asked about a running client. They have three separate
vocabularies **on purpose**: an earlier single word ("Open") collided with the verb *open*,
with an open reminder, and with the encryption state — and made a good default sound like a
vulnerability.

| Question | Vocabulary | Answered by | Lives in |
|---|---|---|---|
| Does an account exist on this device? | **Unauthenticated / Authenticated** | the roster on disk | [`@leapsake/store-layout`](../store-layout/README.md) |
| Is the file on disk encrypted? | **plaintext / encrypted** | the roster, today | `resolveActiveStore`'s `custody` discriminant |
| Can this device read its data right now? | **Locked / unlocked** | the OS keychain (is the db-key there?) | this package |

**Do not collapse them**, even though two of them currently always agree:

- **Authenticated ⇒ encrypted is true today, and is a consequence, not a definition** — the
  opt-out above is what severs it. Code asking *"how do I open this file?"* must read the
  file axis, never infer it from the account.
- **Locked is a sub-state of Authenticated, never a peer.** Signing out (`lockThisDevice`)
  deletes exactly two keychain secrets and touches nothing else: the roster entry, the account
  row, the encrypted file and both sidecars all survive. A signed-out device is fully
  Authenticated and merely Locked. The reverse cannot happen — an Unauthenticated device has
  no keys to forget, so it can never be Locked.
- **Degraded** is Authenticated *and* unlocked *and* still broken: the device holds its db-key
  but cannot prove the account's master key. If the axes were one enum it would have nowhere
  to live.

**The ELI5 test** — *can you use the app right now without typing anything?* Unauthenticated:
yes, everything works, there is simply no lock on the door. Locked: no, your data is right
there and sealed.

**These are internal names, not user-facing copy.** They are for code and design docs. The UI
says whatever is clearest for a layperson — "Protect your data", "Set up your login", "Sync
across devices". Never surface "Unauthenticated" to a user.

## First launch, and the "Already using Leapsake?" branch

**There is no first-launch prompt.** Every fresh install starts Unauthenticated: straight into
the app, no keys, no encryption, nothing to decide. The "already using Leapsake elsewhere?"
question is a **Home nudge**, ranked first among them
([`@leapsake/reminders`](../reminders/README.md)) — not a gate in front of the app.

That is the layperson principle taken literally: a new user cannot usefully answer a question
about our sync topology before seeing what the app is, and asking costs the zero-setup first
run that the Unauthenticated state exists to provide.

The two answers still differ in **custody**, not only in sync:

| Answer | Means | What happens |
|---|---|---|
| **Yes** | a 2nd+ device | join (or recover) the existing account → **username + password** → this device mints its own db-key, adopts the account master key, and **converts** its store |
| **No** | fresh install | stays Unauthenticated. An account is *invited* later, never demanded |

A password is never required to *start* using Leapsake on one device.

**Every device ends up encrypted at rest.** That is the invariant, and the mechanism is
conversion — not a second store-creation path. `adoptAccountOnThisDevice` (desktop) and
`adoptStoreForAccount` (mobile) run the same **convert → password door → roster entry →
destroy the original** ordering that account creation does, because that ordering is what
makes a crash survivable (`model.md` §8.1).

> **The plaintext window on a joining device holds no user data.** Its store is created
> plaintext at first launch like any other, but the adoption converts it *before* the first
> sync pull — `joinAccountViaRelay` returns a session without fetching rows — so what was
> written in the clear is an empty schema. This is strictly narrower than the honest limit of
> converting late (below), where the user has been typing for days. It is worth keeping true:
> a join path that pulled first and converted after would forfeit it for nothing.

## Creating an account is the act that turns encryption on

**Username + password is required to turn encryption on** *(decided 2026-07-27)*. The
alternative considered and rejected was a phrase-only "accountless encryption": it makes the
recovery phrase the *primary* credential — reviving the exact unfamiliar ritual this decision
exists to demote — leaves one door instead of two, and terminates at a password anyway the
moment the user wants sync, having added a third custody state and a second conversion to the
boot path on the way.

> **The word, not the mechanism, is the thing to soften.** A username and password stored only
> on this device is *accountless* in every sense a user cares about: no email, no server,
> nothing transmitted, nobody to notify. "Account" is our vocabulary. If it reads as too heavy
> for something that never leaves the laptop, change the label — "Protect your data", "Set up
> your login" — not the mechanism. Never surface "Unauthenticated" to a user.

There is **one** operation, reachable from two places — the Home invitation once the user has
data to lose, and a Settings control for anyone who wants it sooner. Both run the same flow,
and it is fully local: no relay, no email, nothing leaves the device.

1. Choose a **username + password**. The username is a login handle, and is what later allows
   several accounts to share one client.
2. Mint db-key, master key, and recovery key; write the password- and recovery-wrapped
   sidecars beside the store.
3. **Convert the Unauthenticated store to Authenticated** (`model.md` §8.1) and destroy the
   plaintext original.
4. Show the **recovery phrase once**, as the forgot-password backstop.

> **The copy must promise access, not safety.** A local account protects against *this device
> losing its security settings*; it does **not** protect against a lost or broken device. Say
> so in the flow, and point at sync or a file backup for that. Getting this wrong borrows the
> user's SaaS instincts and then violates them on the worst day.

**The honest limit of converting late.** Data typed before the account existed was written to
disk in the clear. The conversion writes a *new* encrypted file and deletes the original, so
no plaintext survives inside the live database — but deleted bytes can linger in free space,
and on SSDs cannot be reliably erased. **Accepted** *(owner, 2026-07-26)*: the window is
small, exploiting it requires physical access to the disk, and the alternative is the
data-loss path above. It is stated in `model.md` §12 rather than glossed.

## The two exits from local-only *(built 2026-08-08)*

> **A local store — Unauthenticated *or* Authenticated — must always be mergeable into an
> authenticated synced account.** *(owner, 2026-08-02.)*

A user who takes the wrong branch at the create/sign-in fork loses **time, never work**. That
outranks any UX guard against taking the wrong branch: a guard reduces how often the mistake is
made, this decides what it costs.

It takes two exits, because *"I have a local-only account and I want sync"* has two meanings —
and a user knows which one they mean before they know any of the mechanics:

| The user means | The act | Where |
|---|---|---|
| *"Publish the account that is already here"* | **bind a relay.** Nothing is minted and nothing is re-encrypted, so the same password and the same recovery phrase keep working. Account creation mints the auth verifier and both master-key wrappings with no relay in sight *precisely* so this adds no new ritual | `bindRelayToAccount` (`src/bind-relay.ts`) |
| *"Move this data into the account I already have elsewhere"* | **merge.** The store is re-homed under the synced account's id, keeps every row, and opens under *that* account's password from the next launch. Overlapping people go to duplicate review rather than being fused (`reconcileOnJoin`) | `main/db/merge-account-flow.ts` (desktop), `lib/merge-account.ts` (mobile) |

Three constraints hold the pair together. Each is enforced and explained where it lives; they
are listed here because they are easy to undo from a distance:

- **The merge's relay half runs against a copy.** Joining refuses while a local account row
  exists, so clearing that row on the *live* store would destroy the user's account identity at
  exactly the moment the login **failed**. Both merge flows carry the crash table in their
  doc-comments.
- **Binding publishes before it persists.** A refused username has to leave a working
  local-only account behind with nothing to roll back.
- **A taken username is a question, not an error.** It hides both readings above — your own
  account, or a stranger's — so the clients fork on it (`isUsernameTakenError`) instead of
  reporting it.

> **The join guard was not relaxed, and must not be.** An in-place adopt branch existed and was
> deliberately removed, because *"silently adopting a second account into a store still homed
> under the first one's id was never a state worth producing"*. What the invariant asks for is
> an **explicit, user-initiated merge** — a different thing from letting a roster inconsistency
> rehome a store by accident. Read the comment on `adopt-account-flow.ts`'s assertion before
> touching it.

**Not built: merge by recovery phrase.** `recoverAccount` carries the same *"already part of an
account"* refusal `joinAccount` does, so it needs the same copy-first treatment and amounts to
a second full flow; the merge UI hides its recovery affordance rather than offering a button
that can only throw. The gap is a user who has the account's **phrase** but not its password —
today they must recover on the other device first. *(Deferred, owner 2026-08-08; see
[`plans/shipping.md`](../../plans/shipping.md) → *Open, and waiting on the owner*.)*

## Locked, Sign out, Forget account *(decided 2026-07-27)*

Three concepts, no overlap. **One state, two actions** — and one of the actions destroys data,
so they must not share a word.

| | What it is |
|---|---|
| **Locked** | a **state** — the store is closed and the password reopens it. Reached automatically (idle / session expiry) or deliberately |
| **Sign out** | a user **action** → the Locked state. *Identical for local-only and synced users* |
| **Forget account** | a user **action** → this account and its data are removed from this device |

The reason this shape is right: **Sign out does not have to behave differently by custody
state.** Both users get the same promise — *nobody can see my data on this device anymore* —
and the only difference (whether the bytes remain, encrypted) is invisible to that intent. One
honest line covers it for a local-only user: *"Your data stays on this device, encrypted.
You'll need your password to get back in."*

Purging lives entirely in **Forget account**, which is named as removal so it can never be
mistaken for signing out.

**Sign out has no confirmation step.** The password reverses it, and a dialog there would teach
users to click through the confirmations that do matter.

**A device offers one exit per custody state.** With an account it offers Forget account; with
none it offers the accountless factory reset. Both land in the same place, a device with no
account and a fresh empty store, so showing both at once would offer one act twice.

**Replacing the recovery phrase is compromise response, not a way back in.** It needs the
password, and the phrase exists for when the password is gone, so the copy has to send a user
who forgot their password to the unlock gate instead.

> **Do not invent a "Lock" button.** Locked is a state, not an affordance. The app enters it on
> your behalf when idle; the user reaches it by signing out.

> **"Make local-only" was cut** *(owner, 2026-07-28)*. There used to be a third,
> non-destructive action — leaving the relay while keeping the data — backed by
> `clearLocalAccount`. The custody rebuild made its shipped form incoherent: it cleared the
> account rows but never the **roster**, and the roster is what decides whether a store is
> encrypted, so a device that used it stayed Authenticated on disk while reporting no account —
> hiding Sign out and Forget account, and offering an account-creation path that then refused,
> since creation requires a plaintext Unauthenticated store.
>
> It was removed rather than repaired. The want is narrow (creating a local account, promoting
> it to a synced one, and starting out synced are all covered above), and repairing it is not a
> local edit: "drop only the relay binding" has to decide what becomes of the account on the
> relay, and whether the username is retained for re-binding. That second half is the sharper
> question now that binding *does* exist, since a released handle is the one thing the relay's
> namespace has no verb for. Cheap to rebuild later if the want turns out to be real.
> `clearLocalAccount` itself survives as what it is actually good at — the rollback when relay
> registration fails mid-creation, before anything on disk has moved.

**v0.1 ships the deliberate half only** *(scope decision, owner, 2026-07-27)*. Sign out and
Forget account are cheap — close or delete the store. **Automatic** locking is not: a real
session needs mid-session re-lock in the desktop main process and mobile's bootstrap, and it
must be a genuine re-lock rather than theater, since the keychain still holds the db-key and a
relaunch would otherwise walk straight past it. Deferred to v0.2
([`plans/v0-2.md`](../../plans/v0-2.md)). Nothing about it is a one-way door — the session sits
on top of the same password door either way.

### Forgetting the last device — ask the relay, assume the worst

Forgetting an account on its **last remaining device** is functionally a deletion *unless some
server durably holds a copy*. Two facts make this sharper than it first looks:

- The relay is designed to be **disposable** — devices self-heal it — so a relay is explicitly
  *not* a backup ([`apps/server`](../../apps/server/README.md)).
- **Not every relay will offer backup.** Someone has to host that data; a self-hoster may
  choose to, and many will not. It is a property of *who is hosting*, so it is a **relay
  capability**, not an account setting.

Therefore the client **asks** rather than assumes: the relay advertises whether it retains a
durable copy, and **absent that advertisement, assume it does not.** Defaulting to "no" fails
safely — the worst case is over-warning.

| Durable server copy | What Forget account means here | How to say it |
|---|---|---|
| **No** (default, and today always) | the last copy is destroyed | word it as **"Delete all data on this device"**, and hard-confirm |
| **Yes** (a relay that opts in) | ordinary — sign back in and re-pull | the normal Forget confirmation |

**Offering an export first is unconditional, and deliberately not in that table.** It sits inside
*both* destructive confirmations on mobile's Data screen — Forget account and the accountless
factory reset, and in both branches of the first — because a user is entitled to their own file
whether or not somebody else claims to be holding one, and `durableBackup` is a relay's claim
rather than something this device can verify. Only the **wording** branches on it. The button is
`ExportFirstOffer` in `apps/mobile/app/data.tsx`, over
[`@leapsake/export`](../export/README.md) reached as `core.export.archive()`.

Build this as a *check*, not a hardcoded string: when server-side backup ships, alarming copy
must stop appearing on its own rather than being hunted down. The capability should also be
**visible** — "This server does not keep a backup of your data" is honest for self-hosters and
a real differentiator for the eventual paid relay.

## The key lifecycle, phase by phase

Every key in play, and who makes it:

| Key | Created by | Purpose |
|---|---|---|
| **Master key (MK)** | client, at account creation | the root; wraps everything below. Never derived from the password |
| **Enclave key** | OS keychain / Secure Enclave | a device's local unlock path for MK |
| **db-key** | client, at account creation | the whole-DB at-rest key; read from a sidecar *before* the store opens |
| **Recovery key (RK)** | client, at account creation | out-of-band unlock for MK **and** db-key; the 24 words encode it; user-held, never stored by us |
| **KEK** | `Argon2id(password, salt)` | the password unlock path for MK and db-key |
| **Auth verifier** | separate derivation from the password | what a relay stores to authenticate login — reveals nothing about the KEK |
| **Content key (CK)** | client, per shareable unit | encrypts one item/blob; wrapped for each principal that may read it |
| **Account keypair** | client, Stage 3 | public key published to a directory; private key (MK-wrapped) opens shares sent to you |
| **Principal keypair** | per server integration | a constrained reader (Alexa / CardDAV / hosted link) you wrap *specific* CKs to |
| **Session key** | server, at SSR login | wraps MK for one trusted SSR session |

The **invariant** through every phase: a server never holds an *unwrapped* MK at rest, and
never holds the password, KEK, or RK at all. The three phases after these — creating a share,
and granting a constrained principal — are not built; they are `model.md` §11 and §9.2.

**Phase 0 — First launch, fresh install.** **No keys are created — the OS keychain stays
empty** — and the store is written plaintext. All three encryption layers are inactive; nothing
leaves the machine.
> *Ledger: empty.* Wiping the keychain costs this user nothing, and the file opens anywhere it
> is copied. That is the point.

**Phase 0.5 — Create an account.** The pivotal phase, reached from the Home invitation or
Settings. Fully local. Mints **MK, enclave key, db-key, RK, KEK, and the auth verifier** — the
verifier now, though no relay exists, so binding one later adds no new ritual. Persists
`wrap(MK, enclave)`, `wrap(MK, KEK)`, `wrap(MK, RK)` inside the store, and beside it the two
**db-key sidecars**, `seal(db-key, RK)` and `seal(db-key, KEK)`. Sidecars are separate files by
necessity: they are read *before* the database can open. Then converts the store and destroys
the plaintext original.
> *Ledger:* MK and db-key each reachable by enclave, password, or phrase. The user holds two
> secrets — one chosen, one generated — and the keychain is no longer a single point of failure.

**Phase 1 — Bind the account to a relay.** Because 0.5 already minted the password door, the
recovery key, and the verifier, this phase creates **no new key material at all** — it only
publishes what exists. That convergence of local and synced custody is the payoff. The relay
receives the salt (public), the auth verifier, `wrap(MK, KEK)`, and the recovery escrow. It
**cannot** derive the KEK, so it cannot unwrap MK: zero-knowledge holds, and this is where
encryption layer 2 starts working. The relay is authoritative over usernames, so binding must
be able to **rename**.
> *Ledger:* unchanged from 0.5, plus the relay's copy of `wrap(MK, KEK)` + verifier + salt.

**Phase 2 — Add a second device.** Joins the account by username + password; it consumes the
password door and never needs the RK or device 1's enclave key. **Its store is encrypted before
any account data reaches it** — the device starts Unauthenticated like any other, and the join
converts it before the first sync pull, so no row ever lands in a plaintext file. It derives
the verifier → authenticates → receives `wrap(MK, KEK)` → derives the KEK locally → unwraps MK
into memory → mints its *own* enclave key and db-key, adds `wrap(MK, device-2 enclave)`, and
caches the unlock.
> *Ledger:* MK reachable from either device's enclave, the RK, or the KEK. Two devices, one
> account, relay still blind.

**Degraded — a device that holds the account but cannot prove its master key** *(decided
2026-07-29)*. Not a phase but a condition any Authenticated device can land in, and the answer
to the one failure the phases above cannot design away: the db-key opens (so the store opens
and the data is readable) while the enclave holds no MK the account would recognize — a
keychain that was partly lost, or an unlock door whose `key_wrap` row cannot be opened. **The
device opens anyway and syncs nothing.** Three properties define it:

- **No key session.** MK is absent rather than invented, so nothing is pushed under a key no
  peer holds, nothing is pulled that cannot be read, and the recovery-escrow catch-up cannot
  publish a key this device cannot vouch for.
- **Nothing is minted.** Minting MK over an existing account is forbidden, always: a device
  holding a stray key seals records no peer can open and discards theirs, silently, and the
  sync engine advances past both. The refusal is the invariant; Degraded is its consequence.
- **It is visible and has one exit** — the unlock gate. Signing out lands there, where the
  *other* door is one action away (a phrase door is untouched by a broken password door and
  vice versa), and the next open repairs the enclave from it and rewinds both sync watermarks
  so the records lost in each direction are re-offered once. What the notice may *claim* has
  stopped depends on the account: one bound to a relay had sync and no longer has it, while a
  local-only account never had any, and telling that person "sync is paused" invents both a
  feature they do not use and a loss they have not suffered.

> *Ledger:* db-key reachable; MK reachable only from the doors, not from this enclave. Local
> reads and writes are unaffected, and edits made while degraded reach the account after the
> repair, because the rewind re-pushes them.
>
> **Why not refuse to open**, which is the tempting reading of the invariant: nothing at rest is
> sealed under MK, so the app is fully usable without one. Refusing would withhold a person's
> own readable data over a cause they can neither see nor act on, while protecting nothing that
> the missing key session does not already protect.

## Surface, by custody phase

| Phase                   | Exports                                                     |
| ----------------------- | ----------------------------------------------------------- |
| **0** — enclave         | `ensureDeviceMasterKey`, `KeySession`                       |
| **1–2** — password door | `enableSync`, `unlockWithPassword`, `unlockWithRecoveryKey` |
| Adoption & repair       | `joinAccount`, `recoverAccount`, `reauthenticate`           |
| Status & relinquish     | `getSyncStatus`, `clearLocalAccount`, `KEYSTORE_SECRET_IDS` |

`ensureDeviceMasterKey` is the first `KeyStore` consumer and runs between
`runMigrations` and `createCore`, which is why it cannot live inside the core it
precedes.

## Where custody lives across the repo

Custody spans this package, two others, and both clients. This is the map for a fresh reader;
the sections above are the decisions it implements.

- **Which store, and is it encrypted** —
  [`@leapsake/store-layout`](../store-layout/README.md): the roster, the per-account paths,
  and the pure `resolveActiveStore` that answers *Unauthenticated or Authenticated* before
  anything is opened.
- **Opening it** — `apps/desktop/src/main/db/open.ts`, and the mirrored branch in
  `apps/mobile/lib/core-context.tsx`, including the two unlock doors.
- **What the boot does about keys once the store is open** — `establishKeySession`
  (`src/boot.ts`): the master-key repair, the resume of a half-done repair, the key session,
  and the *Degraded* verdict when this device cannot prove the account's master key. Both
  clients and the desktop boot harness call this one function.
- **Turning encryption on** — `createLocalAccount`, plus each client's converter and flow:
  `apps/desktop/src/main/db/convert-store.ts` + `create-account-flow.ts`;
  `apps/mobile/db/convert-store.ts`, wired inside `core-context.tsx`'s `createAccountHere`.
  On both clients the relay is **optional** at that call — with it, the act also binds a
  relay; without it, the account is local only.
- **Adopting an account another device created** — the join/recover counterpart, same
  sequence: `apps/desktop/src/main/db/adopt-account-flow.ts`; on mobile, the *same*
  `adoptStoreForAccount` that creation uses (`core-context.tsx`).
- **The doors** — `packages/crypto/src/{recovery,password-sidecar}.ts` for the primitives,
  `sealPasswordDoor` here for the one place a door is sealed, and for where the bytes land:
  desktop's `main/db/sidecars.ts` (files beside the store) and mobile's `db/doors.ts`
  (`stores/<accountId>/doors.db`).
- **Leaving** — `lockThisDevice` (sign out) and `forget-account-flow.ts` on each client.

### Before you change the conversion

**It is gated, not merely verified.** Desktop's lives in
`apps/desktop/src/main/db/convert-store.ts` (8 tests against the real app schema); mobile's in
`apps/mobile/db/convert-store.ts`, exercised **on device** by
`apps/mobile/test/custody-selftest.ts`, which runs beside the driver contract under
`pnpm test:native` (**36 cases**, each positive paired with its negative, confirmed RED by
sabotage before being trusted GREEN). Both run the same ordinary-SQL pattern, `ATTACH` a keyed
file and copy schema then rows out of `sqlite_master`, because neither engine's native shortcut
works on the other: desktop's library has `PRAGMA rekey` but no `sqlcipher_export`, and
SQLCipher has the reverse. **A change to either must preserve:**

- **`PRAGMA cipher='sqlcipher'` before the `ATTACH`.** Without it, desktop's library writes the
  attached file under its default cipher (chacha20), which then fails to open under the pinned
  `sqlcipher` with the misleading `file is not a database`. On mobile it is a no-op, kept so
  both run the identical sequence.
- **`user_version` is carried across.** It is the migration runner's watermark and `ATTACH` does
  not copy it; losing it re-runs every migration against tables that exist.
- **Tables before indexes, views and triggers.** `sqlite_master` order does not guarantee it.
- **Each door refuses the wrong source.** The plaintext converter refuses an encrypted store,
  and desktop's re-key refuses a plaintext one, each naming its own door, so a caller bug is not
  reported as a key failure.
- **The destination must be absent.** A retry into a half-filled store would copy every row
  twice. A leftover from a killed attempt is swept first by `clearUnclaimedDestination`, which
  removes it only when no roster entry names it; a named one is somebody's live account.
- **The result is proved to open before the caller commits to it**, and a failed copy removes
  its half-written destination, best-effort, without replacing the original error.
- **The conversion never deletes the original.** The order is convert, write the password door,
  add the roster entry, then destroy the original. A crash after the convert boots
  Unauthenticated on the intact original; after the roster write, Authenticated on the converted
  store. Deleting inside the conversion opens the one window that loses data.
- **Never through a plaintext intermediate.** `ATTACH` writes the destination's cipher directly,
  so the plaintext only ever exists in memory.

> **A dev install predating this work must be recreated.** `resolveActiveStore` is purely
> "does the roster hold an account?", and the only legitimate plaintext→encrypted conversions
> are the three that establish an account on this device. There is no compatibility path, by
> choice — see *Pre-v0.1 latitude* in [`AGENTS.md`](../../AGENTS.md).

## Why it is a package, not a `core` module

It is neither a transactional write nor a view-model — the two things
`@leapsake/core` exists to provide. It is an application service over
`@leapsake/crypto` (the primitives) and exactly three `@leapsake/data` repos
(account, device, key-wrap), with no dependency on the entity surface `core`
composes. That boundary already held before the extraction: the module had **zero**
imports from anywhere else in `core`.

Splitting it also shrank `core` by roughly a third, leaving it closer to the
composition root its README describes.

## The relay is a port, not a dependency

`joinAccount` and `recoverAccount` take an `AccountBootstrapChannel` /
`RecoveryChannel` — the narrow slice of bootstrap calls they actually use, which a
real `HttpSyncTransport` satisfies structurally. So this package never imports
`@leapsake/sync`, the two are independently testable, and `core` remains the only
place that knows both a relay and a custody flow exist.

## The product model this serves *(stated 2026-07-11)*

The mechanism above exists to hold a specific user-facing shape. Change the mechanism freely;
these are the properties that must survive the change.

- A **user** uses Leapsake on **one-to-many clients**. A **client** hosts **one unauthenticated
  user OR multiple authenticated users** — never multiple *unauthenticated* users. Each
  authenticated user gets their own encrypted database file; the unauthenticated user gets an
  unencrypted one (see [`@leapsake/store-layout`](../store-layout/README.md) for the paths).
- **Authentication is required to sync, and only to sync.** Local-only use needs no account to
  get started and stays fully layperson-complete.
- **The relay is set per authenticated user/account, not per client.**
- **The user decides when to create an account.** The invitation is a nudge, never a wall.
- **Forgetting the last device is treated as deletion unless a server durably holds a copy** —
  see *Forgetting the last device* above.

## The signing identity owns the enclave key

A fact worth knowing before any change to the app's signing principal, because it is invisible
until it fires for every user at once.

`safe-storage-keystore.ts` stores a macOS keychain item whose ACL is **bound to the app's code
signature**; on iOS, keychain access groups are prefixed with the **Team ID**
(`$(AppIdentifierPrefix)com.leapsake.app`). A new signing principal — an org transfer, a
different Developer ID — is a different owner, and **every existing enclave key becomes
unreadable**.

What that costs depends entirely on the custody model, which is why *encryption follows custody*
matters more than it looks:

| The user is… | What a signing-identity change costs them |
|---|---|
| **Unauthenticated** (no account) | **nothing.** There are no keys to lose; the store is plaintext and simply opens |
| **Authenticated** | one password entry at the recovery gate; the phrase only if they have forgotten that too |

Under the *old* default — encrypt always — the same event dropped every user into a
24-word-phrase gate for a phrase they had never been asked to save. This is the single strongest
practical argument for the current model, and it was found while planning distribution.

The hazard is **not unique to an org transfer**: OS reinstall, machine migration, or any
`safeStorage` failure triggers the same gate. A transfer only makes it fire for everyone at once,
deterministically.

## Invariants a change here must preserve

- **Key-bearing objects never reach a log or a crash reporter.** The master key is a plaintext
  `Uint8Array` for the life of the process and is never zeroized. In a GC'd runtime it cannot
  reliably be, because V8 and Hermes copy and intern buffers, so `.fill(0)` would only look like
  hygiene. At-rest encryption, not wiping, is the device-theft mitigation. The short-lived KEK
  and transient wrap keys *are* wiped after use, since they are derived, used once, and cost
  nothing to clear.
- **The password floor is `MIN_PASSWORD_LENGTH` (12), defined once in `session.ts`.** It is higher
  than a typical login floor because the password derives the KEK that protects both the master
  key and the at-rest db-key, in a zero-knowledge design with no server-side reset: an offline
  guess against a weak password is the whole attack. `session.ts` holds every path that consumes
  a password, and core re-exports the constant so neither client keeps a copy.
- **`KEYSTORE_SECRET_IDS` lists every keychain id the app writes.** A factory reset clears by
  that list, because the mobile `KeyStore` has no bulk clear. A new `setSecret` id that is not
  added there survives the reset.
- **Re-binding the enclave revokes before it adds, in one transaction.** `key_wrap_active` is a
  partial unique index over live rows, so adding first collides; a crash between the two would
  leave the device with no enclave door, openable only by password or phrase.
- **`adoptAccountMasterKey` runs between `runMigrations` and `ensureDeviceMasterKey`,
  synchronously.** Not earlier, because there is no driver until the store opens. Not later or in
  the background, because the launch-time recovery-escrow catch-up publishes
  `wrap(recoveryKey, MK)` to the relay, and a stray key reaching it turns one device's problem
  into the account's. `"adopted"` means the device had drifted, and the caller must also rewind
  its sync watermarks.
- **Every path that puts an account on a device lays the local `password` door.** Creation,
  join and recovery all write `wrap(MK, KEK)` locally. The keychain-loss repair unlocks through
  it, so a path that skips it leaves a device whose password opens the file but not the master
  key. Join once did, and it was found only by driving a joined device through a wiped keychain.
- **Every path that establishes or changes a password reseals the password door** (the
  `seal(db-key, KEK)` sidecar): creation, join and recovery (a second device has its own
  db-key), and re-authentication after a reset elsewhere, whose old sidecar still expects the
  old password and says nothing until the keychain is lost. `sealPasswordDoor` reads the salt
  from the account row, because a password paired with the wrong salt yields a sidecar that looks
  written and never opens; a caller that rotates the salt persists it first.
- **Sign out clears the db-key *and* the recovery key, and never `device-id` or `enclave`.** The
  recovery sidecar sits beside the store in plain view, so keychain plus sidecar would still
  rebuild the db-key with no user secret. `device-id` and `enclave` open nothing once the db-key
  is gone (their wrap row is inside the encrypted store), and clearing them would make the next
  `ensureDeviceMasterKey` mint a new master key. Signing out and back in must change nothing
  above the at-rest layer.
- **Rotating the phrase takes the master key from the password door, never the enclave.** A
  device that came back through a door after a keychain loss may hold a stray enclave key, and
  an escrow wrapped around it would stop the phrase recovering the account anywhere. Rotation is
  local, so it works offline and without a relay; the relay's escrow follows on the next sync
  (`flushPendingRecoveryEscrow` in core), and until then the *old* phrase still recovers the
  account, which the caller must say. Adopting a key writes the db-key door, then the recovery
  key-wrap, then the keychain, so a crash part-way leaves the user's saved phrase working.
- **The boot's repair flag is set before the adopt.** Adopting the key and rewinding the sync
  watermarks are two durable writes; a crash between them would leave the right key with a holed
  history. Only a real repair (`"adopted"`) rewinds, since a plain sign-out answers
  `"unchanged"`; a flag found with no door rewinds anyway, since one redundant full sync
  converges and a missed one does not.
- **Binding a relay publishes, then persists, and never checks first.** If the process dies after
  the register and before the local write, the retry re-registers the same account id, which the
  relay answers `"exists"`, and falls through to the write. A registration check before the act
  would race it.

## Tests

Coverage lives in `apps/desktop/test/integration/` (`key-session`,
`password-door`, `account-join`, `reauthenticate`, `clear-account`,
`sync-status`). These need a real encrypted SQLite driver and an OS keystore
adapter, so they stay integration tests at the app layer rather than moving here.
They reach these functions through `@leapsake/core`'s re-export.

**The relay-facing flows are tested twice, on purpose.** `joinAccount`,
`recoverAccount`, `bindRelayToAccount` and the clients' merge flows each have a
**stub** tier (`apps/desktop/test/support/fake-relay.ts`) and a **live** tier
against a relay running in-process on an ephemeral port
(`apps/desktop/test/support/live-relay.ts`, and the `bind → join → converge`
suite in `apps/server/test/relay.test.ts`). The split is not redundancy:

- The **stub** answers on demand, so it is the only way to test the orderings and
  the guards — *what does this device do when the relay refuses?*
- The **live** relay is the only thing that can answer *does the relay accept what
  we published, and does its refusal arrive in the shape the client forks on?* A
  stub agrees with a bug as readily as with the truth, because it was written from
  the same reading of the protocol as the code under test. The 409 that drives the
  merge-or-rename fork is the case in point: the real transport throws
  `relay register failed: 409` and the desktop stub throws a differently-worded
  string, and only the live tier proves the client's match still fires.

**Not covered by either: mobile.** `apps/mobile/lib/merge-account.ts` imports
`expo-sqlite`, whose native engine cannot load headlessly
(`apps/mobile/README.md` → *Why the driver test needs a device*), so its relay flows are exercised on-device by
`apps/mobile/test/custody-selftest.ts` against a stub — and the live equivalent
belongs to the blocked native/E2E tier.
