# @leapsake/key-custody

How a device **obtains, holds, escrows, and relinquishes** the account master key.
This is the code counterpart to
[`plans/encryption/model.md`](../../plans/encryption/model.md) §7.5 —
that document specifies the phases, this package implements them.

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

Custody spans this package, two others, and both clients. This is the map for a fresh
reader — the **decision** it implements is
[`plans/encryption/model.md`](../../plans/encryption/model.md) §7, and §8.1 for converting
a store. Those two sections are enough; you should not need another doc.

> **The decision, in one sentence:** Leapsake **encrypts once the user holds a secret that
> opens it, and not before.** A fresh install mints no keys and writes a plaintext store;
> creating an account (username + password) is the single act that turns encryption on, and
> joining or recovering one does the same on that device. A lost keychain is answered by the
> password, with the 24-word phrase as the forgot-password fallback.

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
sabotage before being trusted GREEN). Both files' doc-comments carry the five invariants a
change to either must preserve — **read them before touching the ATTACH.**

> **A dev install predating this work must be recreated.** `resolveActiveStore` is purely
> "does the roster hold an account?", and the only legitimate plaintext→encrypted conversions
> are the three that establish an account on this device. There is no compatibility path, by
> choice — see *Pre-v0.1 latitude* in
> the product model above.

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

The mechanism below exists to hold a specific user-facing shape. Change the mechanism freely;
these are the properties that must survive the change.

- A **user** uses Leapsake on **one-to-many clients**. A **client** hosts **one unauthenticated
  user OR multiple authenticated users** — never multiple *unauthenticated* users. Each
  authenticated user gets their own encrypted database file; the unauthenticated user gets an
  unencrypted one (`plans/encryption/model.md` §7.4, and
  [`@leapsake/store-layout`](../store-layout/README.md) for the paths).
- **Authentication is required to sync, and only to sync.** Local-only use needs no account to
  get started and stays fully layperson-complete.
- **The relay is set per authenticated user/account, not per client.**
- **The user decides when to create an account.** The invitation is a nudge, never a wall.
- **One state and two actions, never conflated** — one of them destroys data, so they must not
  share a word:
  - **Locked** is a *state*, not a button: the store is closed and the password reopens it. The
    app enters it on your behalf when idle; you reach it by signing out.
  - **Sign out** behaves **identically for local-only and synced users**. Both get the same
    promise: *nobody can see my data on this device anymore.*
  - **Forget account** removes this account and its data from this device. Named as removal so
    it can never be mistaken for signing out.
  - *"Make local-only"* — leave the relay, keep the data — was once a third, non-destructive
    action. **Cut 2026-07-28**: its shipped form was incoherent under per-account stores, the
    want is narrow, and repairing it needs relay-side decisions
    (`plans/encryption/model.md` §7.3).
- **Forgetting the last device is treated as deletion unless a server durably holds a copy.**
  The relay is designed to be disposable and **not every relay will offer backup** — someone has
  to host it. So backup is a **relay capability the client asks about**, and **absent an answer,
  assume none**: word it *"Delete all data on this device"* and offer an export first.

## The signing identity owns the enclave key

A fact worth knowing before any change to the app's signing principal, because it is invisible
until it fires for every user at once.

`safe-storage-keystore.ts` stores a macOS keychain item whose ACL is **bound to the app's code
signature**; on iOS, keychain access groups are prefixed with the **Team ID**
(`$(AppIdentifierPrefix)com.leapsake.app`). A new signing principal — an org transfer, a
different Developer ID — is a different owner, and **every existing enclave key becomes
unreadable**.

What that costs depends entirely on the custody model, which is why *encryption follows custody*
(`plans/encryption/model.md` §7.2) matters more than it looks:

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
(`plans/testing/mobile-engine.md`), so its relay flows are exercised on-device by
`apps/mobile/test/custody-selftest.ts` against a stub — and the live equivalent
belongs to the blocked native/E2E tier.
