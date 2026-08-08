# v0.1 · 01 — Merging a local account into a synced one

> **Delete this doc when the work lands.** How the built half works — the converter, the adopt flow, the crash
> ordering, `reconcileOnJoin` — is in the doc-comments on the files named below. This doc holds
> the missing half and is deleted when it empties.

**Why this doc exists:** the same work was described in three places, each partially — the
encryption folder's *username collision* open question, the onboarding plan's merge section, and
the mobile-pipeline gate. It is now the **first thing to build**, so it
gets one home. Those three now point here.

## The invariant this serves

> **A local store — Unauthenticated *or* Authenticated — must always be mergeable into an
> authenticated synced account.** *(owner, 2026-08-02.)*

A user who takes the wrong branch at the create/sign-in fork loses **time, never work**. That
outranks the UX guards in [`02 — the account invitation`](./v0-1_02_account-invitation.md): those reduce how often the
mistake is made, this decides what it costs.

**Sequencing settled** *(owner, 2026-08-07)*: this ships **before**
[`02 — the account invitation`](./v0-1_02_account-invitation.md), not alongside it. That step puts a *create
account* invitation on Home, which mass-produces the population holding a local-only account;
closed testers are the group likeliest to own a second device and therefore to hit it. The exit
gets closed before the trap is advertised. This moves [`04 — the mobile pipeline`](./v0-1_04_mobile-pipeline.md)
and the Play 14-day clock out by the length of this doc — accepted knowingly.

## What is already built — do not re-derive it

| Piece | Where | State |
|---|---|---|
| The row merge | `packages/core/src/sync.ts:625` `reconcileOnJoin` | **Done**, wired on desktop (`main/index.ts:406`) and mobile (`lib/core-context.tsx:980,1060`). Keeps this device's rows and sends overlaps to duplicate review rather than auto-fusing |
| Unauthenticated → synced | `apps/desktop/src/main/db/adopt-account-flow.ts:67` | **Done**: convert → password door → roster entry → destroy original. Called from `main/index.ts:699` (join) and `:767` (recover); integration test at `apps/desktop/test/integration/account-adopt.test.ts` |
| Plaintext → encrypted converter | desktop `main/db/convert-store.ts:46`, mobile `db/convert-store.ts:27` | **Done**, two deliberately parallel implementations — neither engine's native shortcut works on the other (desktop has `PRAGMA rekey` but no `sqlcipher_export`; SQLCipher has the reverse), so both run the same ordinary-SQL `ATTACH` + copy-from-`sqlite_master` |
| Crash ordering | the converter's doc-comment table | **Done**: convert → roster → destroy, with both overwrite guards enforced |
| Encrypted → encrypted copy | desktop `main/db/convert-store.ts` `rekeyStore` | **Done** *(Increment 1, 2026-08-08)*: the encrypted-source door onto the same ATTACH machinery, guards and crash ordering shared with the plaintext one. Tests in `apps/desktop/test/convert-store.test.ts` |
| The desktop merge flow | `main/db/merge-account-flow.ts`, `sync:merge` in `main/index.ts`, `MergeSetup` + `LoginStep merge` in `renderer/src/screens/Settings.tsx` | **Done** *(Increment 2, 2026-08-08)*: copy-first ordering, `roster.replace` as the single point of no return. Eleven cases in `apps/desktop/test/integration/account-merge.test.ts` |
| The mobile merge flow | `lib/merge-account.ts`, `SyncApi.merge` in `lib/core-context.tsx`, `MergeSetup` + `LoginStep merge` in `app/settings.tsx` | **Done** *(Increment 3, 2026-08-08)*: the same ordering and guards over mobile's storage verbs, plus `rekeyStore` and `clearUnclaimedDestination` in `db/convert-store.ts`. Six cases in the custody self-test |
| Relay binding + the collision fork | `packages/key-custody/src/bind-relay.ts`, `isUsernameTakenError` in `packages/core/src/sync.ts`, `sync:bindRelay` / `SyncApi.bindRelay`, `StartSyncing` on both clients | **Done** *(Increment 4, 2026-08-08)*: a local-only account can publish itself to a relay, and a taken username forks to merge-or-rename instead of dead-ending. Ten cases in `apps/desktop/test/integration/bind-relay.test.ts` |

**The hard part — merging people without losing or silently fusing them — already exists.** What
is missing is custody plumbing, and it is bounded.

## Where it is refused today

| Layer | What it does |
|---|---|
| `apps/desktop/src/main/db/adopt-account-flow.ts:95` | throws — *"This device already holds an account. Forget it before joining another."* **Still throws, and should.** Increment 2 did not relax it; it added `mergeAccountOnThisDevice` as a second door with its own guards, leaving join's assertion exactly as it was |
| ~~`convert-store.ts` refuses any non-plaintext source~~ | **Lifted by Increment 1.** `convertStoreToEncrypted` still refuses one, but `rekeyStore` is now the door that accepts it |
| `packages/key-custody/src/session.ts:751`, `:877` | `joinAccount` / `recoverAccount` throw — *"This device is already part of an account."* The merge clears the row **on its copy** to get past the first; nothing gets past the second, which is why merge-by-phrase is unbuilt |

⚠️ **Read the comment at `adopt-account-flow.ts:88-94` before touching that guard.** An in-place
adopt branch **existed and was deliberately removed**, because "silently adopting a second account
into a store still homed under the first one's id was never a state worth producing." That
objection is *not* overturned here. What the invariant asks for is an **explicit, user-initiated
merge**; relaxing the guard in place would rebuild the branch that was cut. Keep the distinction —
it is the difference between rehoming a store on purpose and letting a roster inconsistency do it
by accident.

## The increments

Ordered so the thing most likely to fail comes first.

### ~~Increment 1 — the re-key converter, desktop~~ — **done 2026-08-08**

`rekeyStore` in `apps/desktop/src/main/db/convert-store.ts`: an encrypted source opened under
`fromKey`, `ATTACH`ing a destination under `toKey`, sharing one private body — and therefore one
set of guards and one crash ordering — with `convertStoreToEncrypted`. Twelve cases in
`apps/desktop/test/convert-store.test.ts`.

⚠️ **This doc previously said the destination is "keyed under the account master key". That was
wrong**, and the correction matters for Increment 2. The at-rest `db-key` is minted **per device**,
not per account ([`model.md`](./encryption/model.md) §7.1: a joining device "mints its own db-key,
adopts the account master key"); the MK is the sync envelope *inside* the database, not the file
key. So both of this device's stores are locked with the **same** key, and Increment 2 is a
**re-home** — the file moves to the synced account's folder without changing its lock.
`rekeyStore` still takes two keys, because a device that lost its keychain and returned through a
password door holds a *fresh* one (§6), and that store has to move under it.

**Do not replace the copy with a `rename`.** It is atomic, but it leaves a window where the file
has moved and the roster has not — and a crash there boots into a roster entry naming an empty
folder. Copy → roster → destroy is what makes the sequence survivable, and it is why Increment 1
is a converter rather than a `mv`.

Settled empirically while building, and now in the doc-comment: `PRAGMA cipher` before the
`ATTACH` names the *destination's* cipher and overrides `main`'s. Omitted, the attached file
inherits `main`'s — which is why it is mandatory on the plaintext path (no codec to inherit, so
the file is written with the library default and later fails to open as `sqlcipher`) and
belt-and-braces on the re-key path.

### ~~Increment 2 — the merge flow, desktop~~ — **done 2026-08-08**

`mergeAccountOnThisDevice` in `apps/desktop/src/main/db/merge-account-flow.ts`, reachable from the
local-only branch of Settings. Its doc-comment holds the reasoning and the crash table; three
findings are worth carrying forward:

⚠️ **The relay half runs against a copy, inverting adopt's ordering.** `joinAccount` refuses while
a local account row exists, so the merge must `clearLocalAccount` first — and doing that to the
*live* store would destroy the user's account identity in place whenever the login **failed**,
which is the one time it must not. Copying before mutating means every destructive step lands on a
file no roster entry names, so a failure needs no rollback. **Increment 3 must keep this ordering**;
adopt's is the wrong shape here.

⚠️ **One rollback line survives, and it is not on disk.** `joinAccount` writes `RECOVERY_KEY` into
the *device* keychain (`session.ts:817`), which no copy can contain — and a clean throw after that
point is not merely a crash window, because the caller's re-open re-seals the abandoned store's
`.recovery` from the keychain (`open.ts:191-195`) before the failed call even returns. The flow
restores the prior key in its `catch`; `account-merge.test.ts` pins it.

**Password-only** *(owner, 2026-08-08)*. `recoverAccount` carries the same "already part of an
account" refusal, so merge-by-phrase is a second full flow; `LoginStep` hides its recovery
affordance in the merge variant. Deferred, not forgotten — see *Open questions*.

Two pieces landed outside the flow and are reused by Increment 3: `AccountRoster.replace`
(`packages/store-layout/src/roster.ts`) — one atomic write, because `add` + `remove` leaves a crash
window in which the device boots the *old* account while a roster entry claims the destination —
and `destroyStoreFiles`, the custody-blind rename of `destroyPlaintextStore` on both clients.

### ~~Increment 3 — mobile parity~~ — **done 2026-08-08**

`mergeAccountOnThisDevice` in `apps/mobile/lib/merge-account.ts`, reached from the local-only
branch of `app/settings.tsx` through `SyncApi.merge`. Same order as desktop, same guards, same
`catch`; the storage verbs differ, because a store is a *name* here and doors are rows. The
re-key door (`rekeyStore`) and the pre-copy sweep (`clearUnclaimedDestination`) landed in
`db/convert-store.ts`, which now has the same two-doors-onto-one-body shape desktop's file has.

Three findings are worth carrying forward:

⚠️ **Mobile's "re-open" is not awaitable, so the post-swap reconcile is the caller's own open.**
Desktop's `withStoreSwap` re-opens the store and then runs `reconcileAfterAdopt` on it; mobile's
equivalent is a `setResetVersion` bump, which React schedules and no caller can await. So
`SyncApi.merge` opens the merged store once itself (`openStoreUnderKey`), reconciles, closes it,
and only then bumps. The alternative — reconciling against the copy before the swap — was
rejected: it puts a network pull inside the window before the point of no return, and
`reconcileOnJoin`'s own contract is that it runs after.

⚠️ **The `closed` flag is mobile's `storeSwapping`, and it is not tidying.** A guard that refuses
before anything moves leaves a live driver and a running scheduler; re-running the bootstrap over
that would tear the user's screen down to report a validation error. Only a failure past
`closeStore` re-boots.

**The self-test is mobile's integration tier for this**, since expo-sqlite has no Node build. The
relay half is already an injected callback, so the two flow cases drive the real function with a
stub in that seat — including the failing one, which is the only place the copy-first ordering is
observable at all.

**Still to do, as on desktop: verify by hand against a real relay.** The stub proves the ordering;
it does not prove that `joinAccountViaRelay` behaves on a copy's driver the way this assumes.

### ~~Increment 4 — the username collision~~ — **done 2026-08-08**

A locally-chosen username may already exist on the relay, which answers `409`. **Two cases hide
behind that one error** and want opposite UX:

| The user means | The answer | Built as |
|---|---|---|
| *"This is me — I made a second account by accident"* | join it and review the duplicates | the `merge` of Increments 1–3, reached straight from the fork — a `409` already proves the account exists, so there is no second lookup |
| *"Different person, I just need a different handle"* | rename | calling `bindRelayToAccount` again under another name. **There is no rename primitive**, because nothing was ever published: the retry *is* the rename |

⚠️ **The collision was not reachable, and making it reachable was most of this increment**
*(owner, 2026-08-08)*. `enableSync` refuses a store that already holds an account and both
clients' creation flows require a *plaintext* store, so a local-only account's only route to a
relay was `joinAccount` — somebody else's account, never your own. `model.md` §7.2's *"start
syncing later adds a relay binding rather than a new ritual"* was therefore aspiration.
`bindRelayToAccount` (`packages/key-custody/src/bind-relay.ts`) is that binding, and the `409` is
the first thing it can hit.

**It mints nothing.** Every field the relay needs already exists — `enableSync` writes the KDF
salt, the auth verifier and both master-key wrappings *"even though no relay exists, so that
binding one later adds no new ritual"*, and this is the cash-in on that decision. Consequences
worth keeping: binding asks for **no password** (it publishes the stored `wrap(MK, KEK)` rather
than re-deriving a KEK), and the user's existing recovery phrase keeps working.

⚠️ **Publish before persisting, and let the 409 through raw.** The relay call comes first, so a
refused username leaves a working local-only account with nothing to roll back; the local
`bindRelay` write is the last line. And `isUsernameTakenError` must be checked *before*
`relayErrorMessage` wraps anything — friendly prose loses the status code, and a client that
flattens it first can never fork on it. `sync:bindRelay` therefore **returns** `username-taken`
rather than throwing: it is a question, not a failure.

The reverse crash gap needs no code: the relay is idempotent on the account id (`"exists"`), so a
retry after a successful register that failed to persist locally converges.

**Still to do, as with the merge: verify by hand against a real relay.** Ten cases in
`apps/desktop/test/integration/bind-relay.test.ts` cover the primitive with a stubbed relay.

## Open questions

- **Merge by recovery phrase.** Deferred at Increment 2 (owner, 2026-08-08) and unbuilt on both
  clients: `recoverAccount` refuses a device that already holds an account, exactly as
  `joinAccount` does, so it needs the same copy-first treatment. The gap it leaves is a user who
  has the account's *phrase* but not its password — today they must recover on the other device
  first. Decide before v0.1 whether that is acceptable to ship.
- **Layer 3 blocks a future merge.** `packages/data/src/content-cipher.ts` wraps content keys
  under the master key, and the merge **swaps** the master key without re-wrapping. Safe only
  because nothing writes those rows since migration 27; `account-merge.test.ts` asserts it. The
  first repo to encrypt a field again must add the re-wrap loop in the same change.
- **Does the retired local account leave a tombstone?** Retiring it in the roster is enough for
  the device, but nothing yet decides whether the relay should learn that a local account id was
  folded into a synced one. Nothing depends on it today; it would matter for device management
  ([`v0-2.md`](./v0-2.md) → *Post-launch*).
- **Concurrent merges** — the same edge case [`v0-2.md`](./v0-2.md)
  already notes for merges generally: two devices merging overlapping pairs differently may
  diverge under LWW. Not made worse by this work, and not solved by it.
