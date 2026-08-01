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
> [`plans/product-truths.md`](../../plans/product-truths.md).

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

## Tests

Coverage lives in `apps/desktop/test/integration/` (`key-session`,
`password-door`, `account-join`, `reauthenticate`, `clear-account`,
`sync-status`). These need a real encrypted SQLite driver and an OS keystore
adapter, so they stay integration tests at the app layer rather than moving here.
They reach these functions through `@leapsake/core`'s re-export.
