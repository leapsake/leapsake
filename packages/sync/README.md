# @leapsake/sync

The client half of V3 convergence: the `SyncTransport` port and its two adapters, the
registry-driven `SyncEngine`, and the scheduling layer above it. Depends on `data` for
**types only** (`SyncableRepo`, `SyncStateRepo`) plus `crypto` and `schema`.

## Why it is its own package

Sync used to live in two places at once — the engine and transports inside
`@leapsake/data`, the scheduler inside `@leapsake/core` — so "how a row leaves and
re-enters this device" could not be read, or tested, as one thing. Neither half fit its
host: HTTPS transport and debounce policy are not persistence, and scheduling is not
composition.

Pulling them together also made a latent property structural: the blind relay
(`apps/server`) imports the **wire format** from here and no longer depends on
`@leapsake/data` in production at all. The relay cannot see the app's data layer because
it does not link against it.

## The four pieces

| Module              | What it is                                                         |
| ------------------- | ------------------------------------------------------------------ |
| `transport.ts`      | The `SyncTransport` port + `createInMemoryTransport` (tests)       |
| `http-transport.ts` | The authenticated HTTPS blind-relay adapter + the wire codec       |
| `engine.ts`         | Seal → push → pull → decrypt → apply, routed by table to each repo |
| `scheduler.ts`      | Debounced push kick, foreground pull trigger, interval backstop    |

The engine is **registry-driven**: it is handed a list of `SyncableRepo` and routes each
pulled record to the repo whose `table` it carries, so adding an entity to sync is one
more entry in that list — no engine change.

## What deliberately lives elsewhere

- **`defineSyncable` / `SyncableRepo`** stay in `@leapsake/data`. That is the primitive
  every repo is built on, not a sync concern; sync only consumes the type.
- **`SyncStateRepo`** stays in `@leapsake/data`. The watermarks live in an ordinary
  device-local `sync_state` table, and a repo belongs with the repos.
- **`syncableRepos()` and the account join/recover/register orchestration** stay in
  `@leapsake/core`. Deciding _what_ syncs means naming every repo, and the allowlist is
  the security-critical statement of which tables may leave the device — that is
  composition-root work. Importing it here would make this package depend on the entire
  entity surface it exists to stay independent of.

Design and status: [`plans/encryption/`](../../plans/encryption/) and
[`plans/status.md`](../../plans/status.md).
