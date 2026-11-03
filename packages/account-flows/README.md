# @leapsake/account-flows

**The account flows both clients run, written once.** Creating an account, publishing it to a
relay (`startSyncing`), joining or recovering it on another device, and merging a local-only
account into one that syncs, and reauthenticating after a password change elsewhere
([`plans/accounts-and-sync.md`](../../plans/accounts-and-sync.md) → _Sync and the relay_).

## Why it is its own package

Written per client, these flows differ in only three places: **where a store's bytes and doors live**, **how a store is
copied under a new key**, and **the keystore**. Everything else (the ordering that makes a
crash survivable, the guards, the roster entry) would be the same logic twice, tested twice,
and free to drift. Here it is once, over ports, and tested once against a fake disk and real SQLite
(`node:sqlite`, so no native module).

It sits above [`@leapsake/key-custody`](../key-custody/README.md), which mints and opens the
keys, and [`@leapsake/store-layout`](../store-layout/README.md), which names the stores. It
does not depend on `core`.

## What a client binds

`AccountFlowPorts` (`src/ports.ts`), once per open store: the keystore, the open driver, the
store's custody from `resolveActiveStore`, the roster, and a `StoreFiles`:

| Client  | `StoreFiles`                                       | Doors                     |
| ------- | -------------------------------------------------- | ------------------------- |
| desktop | `desktopStoreFiles` (`src/main/db/create-account-flow.ts`) | sidecar files beside the store |
| mobile  | `mobileStoreFiles` (`db/store-files.ts`)           | rows in `doors.db`        |

A flow closes the open store through `StoreFiles.close` and never re-opens it. **The client
re-opens afterwards, whether the flow succeeded or failed**, because the roster then names
whichever store won.

## Adopting a store

Every flow that makes a device Authenticated ends in `adoptStore`, in this order:

1. **Convert** the plaintext store into the account's slot. The original survives.
2. **Write the password door**, before the roster entry, so an Authenticated device always has
   one.
3. **Add the roster entry.** From here the device is Authenticated.
4. **Remove the original**, best-effort. A throw here would hide the one-time phrase from a
   user whose account already exists, and each client's boot path sweeps a plaintext store
   left beside an account's.

A destination left by a killed attempt is cleared first, unless the roster names it. The
reasoning behind the order is
[`@leapsake/key-custody`](../key-custody/README.md) → _Before you change the conversion_.

## Joining and recovering

`joinAccount` (password) and `recoverAccount` (phrase, plus a new password) make an accountless
device a member of an account on a relay, and both end in `adoptStore`. Two orderings matter:

- **The db-key is minted before the relay call.** The adoption seals this device's password
  door only once a db-key exists, so minting first is what makes the door real. A failure after
  the mint leaves an unused key in the keystore and the device still Unauthenticated, since
  custody is read from the roster.
- **The store converts before the first pull.** Neither flow fetches rows, so the plaintext
  store holds no account data when it is copied. The client pulls once it has re-opened on the
  encrypted store.

## Merging

`mergeIntoAccount` is for a device that already made its own local-only account and now wants
the account the user has elsewhere. The store moves to that account's slot under the same db-key,
since the key belongs to the device, keeps every row, and from then on opens with that
account's password. Overlapping people go to duplicate review rather than being fused.

**The relay half runs against a copy.** Joining refuses a store that still holds an account
row, so the local account has to be cleared first, and clearing it in the live store would
mean a wrong password had already destroyed it. So the store is copied first and only the copy
is changed. Every failure before the roster write is undone by removing the copy, and the live
store is never touched.

**The keychain is the one thing a copy cannot hold.** A join writes the account's recovery key
into the device keychain, and the client re-opening the local store after a failure would then
reseal that store's phrase door under the wrong key. So the flow snapshots every keychain
secret it may change and restores them on any failure.

| Killed after | Roster | Next open | Outcome |
| --- | --- | --- | --- |
| closing, clearing the destination | local | local | nothing happened |
| the copy, the relay half | local | local | the local account intact; a retry clears the copy |
| **the roster `replace`** | **synced** | **synced** | merged: one write, the point of no return |
| removing the local store | synced | synced | finished |

A kill between the relay half and the roster write leaves the local store's phrase door sealed
under the account's recovery key, since the restore never ran: the one lossy edge, and its
password still opens it. **Do not add a sweeper for encrypted stores the roster does not name.**
The roster reads as empty when it is corrupt, so that a corrupt file cannot stop the app
opening, and a sweeper keyed on it would delete every store on the device.

## The sync loop

`createAccountSync` is the scheduler a client builds per open store, from its key session's
master key and core's `syncableRepos`. A run pushes and pulls only for a relay-bound account
with a master key, and skips quietly otherwise, so a client can build it unconditionally. Every
run reports a `SyncActivity`: `synced` with whether the pull changed anything, so focused
screens re-read, or `failed` with a reason. `unauthorized` there means the password was
changed on another device, and the client asks for the new one: `reauthenticate` checks it
against the relay, refuses a relay key that is not this device's account's, and moves the local
credential and this device's password door to it. The master key does not change.

## Relay failures

A flow rethrows a relay failure as a `RelayError` whose `reason` says which one, and leaves any
other failure as it was. The client words the reason. A taken username is not a failure to
`startSyncing`, which returns it, because it may be the user's own account on another device.
