# @leapsake/data

Persistence: the `SqliteDriver` port, the hand-rolled migration runner, per-entity
repositories, and cross-repo services (kinship, search, timeline).
Depends on `schema`; imports **no concrete DB driver** (the apps supply one).

## The `SqliteDriver` port — the seam that made V2 a port, not a rewrite

Desktop's engine is **synchronous**; expo-sqlite (mobile) is **asynchronous**. To reconcile
them, every repository is written against a small **async `SqliteDriver` port**
([`src/driver.ts`](./src/driver.ts)). Each platform is therefore an **adapter swap, not a
rewrite** — the load-bearing decision of the whole project, and exactly what made V2's data
layer a port. The same seam is where the encrypted-at-rest backend plugged in, and where any
future engine would.

Two adapters implement it:

- **desktop** — `better-sqlite3-multiple-ciphers`, wrapping its synchronous calls in
  resolved promises ([`apps/desktop/src/main/db/encrypted-sqlite-driver.ts`](../../apps/desktop/src/main/db/encrypted-sqlite-driver.ts))
- **mobile** — expo-sqlite/SQLCipher ([`apps/mobile/db/expo-sqlite-driver.ts`](../../apps/mobile/db/expo-sqlite-driver.ts))

They are pinned to **identical observable behavior** by one shared contract suite
(`@leapsake/data/testing` → `runDriverContract`): desktop runs it under Vitest, mobile via
the in-app self-test driven by `pnpm test:native`. That equivalence is what lets the shared
repo/service logic be proven once, on desktop, rather than re-run on every engine.

## Migrations — hand-rolled, forward-only

SQLite offers nothing for schema evolution and a migration library is avoidable bloat. The
runner (`migrations.ts`) reads `PRAGMA user_version`, applies an ordered, **forward-only**
array of `{ version, up(driver) }` steps — each inside a transaction — and bumps the version.
**Read `migrations.ts` for the current schema shape.** Value constraints (enums, partial-date
rules) live in **Zod, not the DB** (`schema`), so the same portable SQL runs on both drivers.
"One active row per key" uniqueness is a **partial unique index scoped to `deleted_at IS
NULL`**, so soft-deleted history coexists with live data.

The table conventions every migration follows — a `TEXT` `id` primary key, `INTEGER` epoch-ms
`created_at`/`updated_at`/`deleted_at`, `snake_case`, no `CHECK` constraints — are asserted
against the schema the migrations actually produce, in
[`apps/desktop/test/integration/schema-conventions.test.ts`](../../apps/desktop/test/integration/schema-conventions.test.ts).
That test is the specification; its header explains why each rule exists.

## Repositories & services

Each entity has an async repo over the port (`create`, `list`/`listForEntity`, `get`,
`update`, `softDelete`, cascade `removeAllForEntity`/`removeAllForOwner`, and — for
reconciliation — `repointEntity`/`repointOwner`). Cross-repo _services_ (kinship derivation,
search folding/matching, milestone timeline, duplicate detection) compose multiple repos.

## The sync substrate (V3)

The engine, transports, and scheduler live in [`@leapsake/sync`](../sync/README.md). What
stays here is the substrate they run on: **`defineSyncable`** — the primitive that makes an
entity syncable in one call, reconciled with `resolveMerge` (whole-row LWW) — and
**`SyncStateRepo`**, the durable watermarks in a device-local `sync_state` table. The
canonical "how to add a synced entity" recipe is the `defineSyncable` module doc comment.
Design and status: [`plans/encryption/`](../../plans/encryption/) and
[`plans/status.md`](../../plans/status.md).

## Deferred

- `WITHOUT ROWID` for the `TEXT`-PK tables — a minor storage/lookup optimization; evaluate
  later.
