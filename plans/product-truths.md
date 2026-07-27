# Leapsake — Product truths (the stable "why it must feel this way")

> **This is a stable posture doc, not a status board.** It holds the durable product
> decisions and the mental model Leapsake must embody — the things that shape *how* every
> increment is built. Live status and sequencing live in [`status.md`](./status.md), which
> never restates what's here; it only sequences the work these truths imply. The
> accessibility principle underneath most of this is in
> [`encryption/model.md`](./encryption/model.md) §1.

## Launch posture (decided 2026-07-05)

- **Laypeople first, power users under the hood.** Defaults must work for someone who has
  never heard of a key or a relay; every stronger-or-different choice is a visible-but-
  optional dial, never a prerequisite.
- **v0.1 ships without a hosted relay.** Multi-device sync users self-host `apps/server`
  (single-device use needs no server at all and stays the layperson-complete path). The
  design still optimizes the layperson flow so nothing needs reworking when the hosted
  relay arrives.
- **Storage/hosting strategy is incremental and reversible:** self-hosted relay (v0.1) →
  official paid hosted relay → user-customizable/BYO storage. Mantra: *simplicity and
  security first, followed closely by total customizability.*
- **v0.2 = photo management**, built as the first consumer of the file-type-agnostic
  encrypted-blob design ([`files.md`](./files.md)) so video/documents/audio later reuse the
  same pattern.

## The user / client / account model (stated 2026-07-11)

The north star: **interact like a typical, centralized SaaS app — but with better
protections and considerations under the hood.** The mechanism must serve this layperson
mental model, not leak through it.

- A **user** uses Leapsake on **one-to-many clients**.
- A **client** hosts **one unauthenticated user OR multiple authenticated users** — never
  multiple *unauthenticated* users on one client. **Each authenticated user gets their own
  encrypted database file**; the unauthenticated user gets an unencrypted one
  ([`encryption/model.md`](./encryption/model.md) §7.4).
- A user must be **authenticated to sync** across clients. Single-device / local-only use
  needs **no account to get started**, and stays fully layperson-complete. An account is
  **invited** once there is data worth protecting — never required at first run.
- An authenticated user can **share certain data structures** with another user who **may or
  may not be authenticated** (authenticated recipient = wrap the item key for their public
  key; unauthenticated recipient = capability link with the key in the URL `#fragment`).
- **Shareable data:** People and Pets first; for v0.1 it's acceptable to share at the coarser
  grain that pulls in Milestones, Contact Methods, and Relationships. **Finer per-structure
  granularity is a future iteration.** (Reminders are *not* a share target.)
- **Encryption follows custody** *(decided 2026-07-26)*. Creating an account — username +
  password — is the single act that turns encryption on. Before that the app holds **no
  keys at all** and the local database is plaintext; after it, everything is encrypted and
  the user holds the way in. Rationale and the full state table:
  [`encryption/model.md`](./encryption/model.md) §7.2.
  - The user still **decides**: the account can be created whenever they like, and the
    invitation is a nudge, never a wall.
  - **We do not encrypt under a key the user does not hold.** That is what the old default
    did, and it bought little while risking everything — the failure it created (lose the
    OS keychain, lose the data, with only an unsaved 24-word phrase as the way back) was
    worse than the exposure it prevented.
  - The **recovery phrase is a backstop, not a ritual**: created with the account, shown
    once, in the role every SaaS user already understands — *forgot password*.
- A user should **not have to manage multiple accounts** when using a single device or a
  single relay — **one identity, one credential set**. A credential *set* is a password
  plus its recovery backstop, which is the familiar arrangement (Proton, Bitwarden), not a
  violation of this line; what it forbids is juggling several independent accounts or
  several coequal secrets. (Account identity is currently per-relay; using multiple relays
  may still mean multiple credentials — see cross-relay reconciliation in `status.md` Open
  questions.)
- **The relay is set per authenticated user/account, not per client.**
- **Three distinct exits, never conflated** (`encryption/model.md` §7.3) — one of them
  destroys data, so they must not share a button or a word:
  - **Lock** — close the store; the password reopens it. Nothing is deleted. This is the
    *only* "sign out"-shaped action a **local-only** user gets, because purging their store
    would destroy the only copy in existence.
  - **Make local-only** — leave the relay, keep everything on this device.
  - **Log out** — for a synced user: **removes their data from that client**, because it
    still exists on the relay and their other clients.
- **Logging out of the last device is treated as dangerous**, not routine. The relay is
  designed to be disposable (`encryption/sync.md` §2), so it is not a backup: the client
  detects the last-device case and asks for an export first.

## Deltas vs. the current build (future, none v0.1-blocking)

The model above describes the intended destination. These parts are *not yet* how the code
works, and are called out so they're conscious deferrals, not surprises:

1. **Encryption follows custody.** The code still does the opposite: it mints a master key
   and a db-key at first launch and encrypts immediately, with no account. Closing this is
   **pre-v0.1 and leads the queue** — see [`status.md`](./status.md) → *What's next*. It is
   the one delta here that is launch-blocking, because it changes what real testers'
   devices do with real data.
2. **Multiple authenticated users per client + per-user data isolation.** Today a client is
   implicitly single-user: one SQLite file at a fixed path. Hosting several users needs
   **one store per account** (`encryption/model.md` §7.4) so data can't bleed and can be
   purged independently. Not v0.1, but **the per-account path is**: new work must not assume
   a single fixed database path, because retrofitting that after users have data is exactly
   the expensive class of change worth avoiding.
3. **Log out vs. lock vs. make-local.** Only one of the three exists today
   (`clearLocalAccount` = *make local-only*). **Lock** and a purging **log out** are both
   unbuilt, and lock is the prerequisite for bounded sessions.
4. **User-toggleable encryption beyond custody.** Opting *out* while holding an account —
   trading end-to-end encryption for server-side features like server-side search — is a
   trust-model fork, not a free dial. Distinct from delta 1, which is about the accountless
   state. This argues against per-field content-key encryption on new entities; encryption
   trends toward a user-level **layer** choice.
