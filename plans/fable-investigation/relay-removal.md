# Remove the relay half of account and sync from both clients

**Decision (owner, 2026-09-16):** delete it. This reverses the 2026-08-21 decision to keep the
multi-device code shipped-but-dark behind `multiDevice`. The reasoning then was "unreachable is
the goal, not absent"; the cost since has been ~4,300 lines of client orchestration and UI,
written twice, that no v0.1 user can reach and every refactor has to carry.

**What a v0.1 user keeps, unchanged:** a local-only account (create, password, recovery
phrase, rotate the phrase, sign out, forget, factory reset), encryption at rest, degraded-custody
recovery, and everything else in the app. **The line is the relay, not the login.**

## Step 0: the reference tag

Before the first deletion commit, tag the last commit that has the code:

```sh
git tag relay-clients-final
```

Same pattern as `web-spike-final`. Push the tag with the next push. The v0.2 rebuild reads
that tag for _how the flows worked_, and reads [_The rebuild_](#the-rebuild) below for _how they
should be built next time_. Both clients' full flows, their settings screens, and the relay
integration tests are all at that tag.

## The boundary

"Relay" means anything that needs `account.relayUrl` to be set: registering, joining, merging,
binding, relay-recovering, syncing, re-authenticating against the relay, auto-sync, and the
recovery-key escrow round-trip. "Local account" means everything an account does on one device.

### Delete: desktop

| File                                                      | What goes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | What stays                                                                                                                                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main/index.ts`                          | IPC handlers `sync:lookup`, `sync:enable`, `sync:join`, `sync:merge`, `sync:bindRelay`, `sync:recover`, `sync:now`, `sync:reauthenticate`, `sync:getAutoSync`, `sync:setAutoSync`, the `sync:activity` broadcast, `flags:snapshot`; the `SyncScheduler` and its kick wiring in `setActiveCore`; `catchUpRecoveryKey`, `reconcileAfterAdopt`, `broadcastSyncActivity`, `relayErrorMessage`. **Keep** `withStoreSwap` / `restoreLiveStore` / `reopenActiveStore`: `account:create` converts the store and needs the swap too | `sync:status`, `account:create`, `account:signOut`, `account:forgetInfo`, `account:forget`, `app:factoryReset`, `sync:rotateRecoveryPhrase` (see _Rotation_ below), the boot channels, all `API_CHANNELS` core handlers |
| `apps/desktop/src/main/db/merge-account-flow.ts`          | whole file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |                                                                                                                                                                                                                         |
| `apps/desktop/src/main/db/adopt-account-flow.ts`          | whole file (this is the join)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |                                                                                                                                                                                                                         |
| `apps/desktop/src/preload/index.ts`                       | the sync methods matching the handlers above, and the `onActivity` subscription                                                                                                                                                                                                                                                                                                                                                                                                                                            | `status`, `createAccount`, `signOut`, `forgetInfo`, `forgetAccount`, `factoryReset`, `rotateRecoveryPhrase`                                                                                                             |
| `apps/desktop/src/renderer/src/screens/Settings.tsx`      | `SyncSetup`, `StartSyncing`, `MergeSetup`, `SignupStep`, `LoginStep`, `RecoverStep`, `ReconnectForm`; the relay branch of `AccountEnabled` (the "Sync now" / auto-sync / reconnect side); the `escrowPending` plumbing through `RecoveryKeyReveal` and `RecoveryPhraseSection`                                                                                                                                                                                                                                             | `Settings`, `SignOut`, `ForgetAccount`, `CreateAccount`, `RecoveryKeyReveal`, `RecoveryPhraseWords`, `FactoryReset`, `RecoveryPhraseSection`, the local-only branch of `AccountEnabled`                                 |
| `apps/desktop/src/renderer/src/screens/CustodyBanner.tsx` | the `relayBound` prop and its copy branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | the banner itself (degraded custody is local)                                                                                                                                                                           |
| `apps/desktop/src/renderer/src/main.tsx`, `env.d.ts`      | flag parsing and the snapshot type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |                                                                                                                                                                                                                         |
| `apps/desktop/package.json`                               | the `@leapsake/server` workspace dependency (only `test/support/live-relay.ts` used it) and `@leapsake/flags`                                                                                                                                                                                                                                                                                                                                                                                                              |                                                                                                                                                                                                                         |

### Delete: mobile

| File                                   | What goes                                                                                                                                                                                                                      | What stays                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/mobile/lib/core-context.tsx`     | On `SyncApi`: `lookup`, `enable`, `join`, `merge`, `bindRelay`, `recover`, `syncNow`, `reauthenticate`, `getAutoSync`, `setAutoSync`, `onActivity`; the scheduler; the `convergeRecoveryKey` call at boot; `relayErrorMessage` | `status`, `createAccount`, `signOut`, `forgetInfo`, `forgetAccount`, `factoryReset`, `rotateRecoveryPhrase`; `CoreProvider`, `DegradedFrame`, `CustodyBanner`, `RecoveryGate`, every `use*` hook |
| `apps/mobile/lib/merge-account.ts`     | whole file, **except** `openStoreUnderKey` if `create-account` or `forget-account` still use it (verify)                                                                                                                       |                                                                                                                                                                                                  |
| `apps/mobile/app/settings.tsx`         | `SyncSetup`, `SignupStep`, `LoginStep`, `StartSyncing`, `MergeSetup`, `RecoverStep`; the relay branch of `AccountEnabled`; `escrowPending` plumbing                                                                            | `SettingsScreen`, `SignOutSection`, `RecoveryPhraseSection`, the local-only branch of `AccountEnabled`                                                                                           |
| `apps/mobile/index.ts`                 | `EXPO_PUBLIC_LEAPSAKE_FLAGS` parsing                                                                                                                                                                                           | the `crypto` polyfill                                                                                                                                                                            |
| `apps/mobile/test/custody-selftest.ts` | the relay cases                                                                                                                                                                                                                | the local custody cases                                                                                                                                                                          |
| `apps/mobile/package.json`             | `@leapsake/flags`                                                                                                                                                                                                              |                                                                                                                                                                                                  |

Rename `SyncApi` to `AccountApi` (and `useSync` to `useAccount`) on mobile once the relay
methods are gone; the desktop preload object gets the same name. The word "sync" should not
survive in a client where nothing syncs.

### Delete: shared

| Where                                                              | What goes                                                                                                                                                                                                                                                                                   | Why                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/flags`                                                   | the whole package                                                                                                                                                                                                                                                                           | `multiDevice` was its only flag. Its README says a flag is deleted with its feature; the feature is being deleted instead. Do not keep an empty flag registry "for later". |
| `packages/reminders/src/engine.ts`                                 | the `connect-sync` onboarding step (the "already have Leapsake on another device?" nudge) and the `isSyncConnected` dependency it needed; `flag()` import                                                                                                                                   | The step's `applies` is `flag("multiDevice") && …`, so it is already never true. The reminders engine then needs no flag.                                                  |
| `packages/reminders/test/onboarding.test.ts`, `duplicates.test.ts` | the `withFlags` cases                                                                                                                                                                                                                                                                       |                                                                                                                                                                            |
| `apps/desktop/test/integration/`                                   | `bind-relay`, `account-join`, `account-merge`, `account-merge-live`, `reauthenticate`, `with-sync-kick` (it pins the scheduler kick; keep only if a kick survives), the relay cases in `onboarding-reminders`, `rotate-recovery` (escrow cases only), `clear-account` (re-enable case only) | These test the client flows being deleted, or the flag. `sync.test.ts` stays: it tests `packages/sync` over the syncable repos.                                            |
| `apps/desktop/test/support/fake-relay.ts`, `live-relay.ts`         | both                                                                                                                                                                                                                                                                                        | Only the deleted tests used them.                                                                                                                                          |
| `plans/testing/crucial-flows.md`                                   | Flow 6 (enable sync and pair a second device) and the `sync-status` test id                                                                                                                                                                                                                 | Move nothing; the flow catalog is v0.2's to rewrite.                                                                                                                       |
| `scripts/lib/custody-assertions.mjs`, `mobile-harness.mjs`         | any assertion or harness step that only Flow 6 used (verify by grep for `sync`, `relay`, `join`)                                                                                                                                                                                            |                                                                                                                                                                            |

### Keep, deliberately

These are platform-neutral, independently tested, and are the seed of the v0.2 rebuild.

- **`packages/sync`** in full: engine, scheduler, transport, relay capabilities. Its tests stay.
- **`apps/server`** in full. It is the relay; nothing here changes the protocol.
- **`packages/key-custody`** in full, including `bind-relay.ts` and the escrow half of
  `rotate-recovery.ts`. They are ports-based and have no client code in them.
- **`packages/core/src/sync.ts`**: keep `syncableRepos` (the allowlist core owns),
  `createAccountSyncEngine`, `getSyncStatus`, and `rotateRecoveryPhraseForAccount`. The relay
  orchestration functions (`registerAccountWithRelay`, `joinAccountViaRelay`,
  `recoverAccountViaRelay`, `reauthenticateViaRelay`, `runAccountSync`, `reconcileOnJoin`,
  `lookupAccount*`, `flushPendingRecoveryEscrow`, `convergeRecoveryKey`, `getAutoSync`,
  `setAutoSync`) become client-unreferenced. **Keep them and their two tests in
  `packages/core/test`** so the rebuild starts from tested code, but note in the file's one
  header comment that no client calls them until v0.2. If workstream 2 moves `sync.ts` out of
  core, move these with it.
- **The schema**: `account.relayUrl`, `sync_state`, `key_wraps`, the account tables, and every
  migration. Schema is sync-shaped on purpose (tombstones, deterministic ids) and stays that way.
- **`SyncStatus`** as a type. Clients keep reading `hasAccount`; `relayUrl` is always `null`
  for them now.

### Rotation, specifically

`rotateRecoveryPhraseForAccount` returns `escrowPending: false` whenever `relayUrl` is null,
which is now always. Keep the core function as is; in the clients, drop the `escrowPending`
field from the reveal state and the copy that reads it. Do not change the core signature: the
rebuild wants it back.

## Steps, each a commit

1. Tag `relay-clients-final`.
2. Desktop: delete the relay IPC handlers, scheduler, and the two flow files. Typecheck will
   list every renderer call site that broke; that list is step 3's scope.
3. Desktop: cut `Settings.tsx`, `CustodyBanner.tsx`, and the preload to the local-account
   surface. Rename to `AccountApi`.
4. Mobile: the same two steps for `core-context.tsx`, `merge-account.ts`, `settings.tsx`.
5. Delete `packages/flags`, the flag parsing in both entry points, the `flags:snapshot` IPC,
   and the `connect-sync` reminder step. Update `packages/README.md` (the _deliberately
   unreachable_ section) and `packages/reminders/README.md`.
6. Delete the relay tests and their support files. Drop `@leapsake/server` from desktop's
   dependencies. Run the full suite on a developer machine.
7. Update `plans/status.md` in one line and `plans/v0-2.md` → _sync_ to point at the tag and
   at _The rebuild_ below (move that section there when this doc is deleted).

Expected removal, from the survey's line counts: ~3,000 lines of client orchestration, ~2,000
lines of settings UI, ~300 lines of flags, ~2,500 lines of tests and support.

## The rebuild

Recorded here so the v0.2 agent does not reconstruct the same shape twice. Move this section
to `plans/v0-2.md` when this doc is deleted.

The two clients at `relay-clients-final` implement the same 17-method surface independently.
The platform-specific part is small and already isolated by `key-custody`'s port style: **where
bytes land** (a sidecar file beside the store on desktop, a row in `doors.db` on mobile), **how a
store is copied under a new key** (`convert-store.ts` in each client), and **the keystore**.
Everything else (the state machine of signup → login → recover → merge, the 409 fork in
"start syncing", the store swap during a join, the reconcile-on-join dedup) is identical and
should be written once:

- A package `@leapsake/account-flows` (or a second entry point of `key-custody`) exporting
  `createAccountApi(ports)` where `ports` is `{ driver, keyStore, storeFiles, doorWriters,
scheduler }`. Both clients bind ports and expose the result over IPC / context unchanged.
- The settings steps as headless state hooks in `@leapsake/ui/headless` (see
  [`shared-form-logic.md`](./shared-form-logic.md) for the pattern), with a web and a native
  rendering each.
- Tests against the fake relay live once, in the package, not in `apps/desktop/test`.
