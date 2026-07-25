# @leapsake/key-custody

How a device **obtains, holds, escrows, and relinquishes** the account master key.
This is the code counterpart to
[`plans/encryption/custody-sequence.md`](../../plans/encryption/custody-sequence.md) —
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
