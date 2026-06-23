# @leapsake/data

Persistence: the `SqliteDriver` port, the hand-rolled migration runner, per-entity
repositories, cross-repo services (kinship, search, timeline), and the V3 sync engine.
Depends on `schema`; imports **no concrete DB driver** (the apps supply one).

## The `SqliteDriver` port — the seam that made V2 a port, not a rewrite

`node:sqlite` (desktop) is **synchronous**; expo-sqlite (mobile) is **asynchronous**. To
reconcile them, every repository is written against a small **async `SqliteDriver` port**
(interface in [`AGENTS.md`](../../AGENTS.md)). Desktop wraps its synchronous calls in
resolved promises; mobile supplies an expo-sqlite adapter. Each platform is therefore an
**adapter swap, not a rewrite** — the load-bearing decision of the whole project, and exactly
what made V2's data layer a port. The same seam is where a future encrypted-at-rest backend
(Stage 2) or any other engine plugs in.

## Migrations — hand-rolled, forward-only

SQLite offers nothing for schema evolution and a migration library is avoidable bloat. The
runner (`migrations.ts`) reads `PRAGMA user_version`, applies an ordered, **forward-only**
array of `{ version, up(driver) }` steps — each inside a transaction — and bumps the version.
**Read `migrations.ts` for the current schema shape.** Value constraints (enums, partial-date
rules) live in **Zod, not the DB** (`schema`), so the same portable SQL runs on both drivers.
"One active row per key" uniqueness is a **partial unique index scoped to `deleted_at IS
NULL`**, so soft-deleted history coexists with live data (see the sync-safe conventions in
[`AGENTS.md`](../../AGENTS.md)).

## Repositories & services

Each entity has an async repo over the port (`create`, `list`/`listForEntity`, `get`,
`update`, `softDelete`, cascade `removeAllForEntity`/`removeAllForOwner`, and — for
reconciliation — `repointEntity`/`repointOwner`). Cross-repo _services_ (kinship derivation,
search folding/matching, milestone timeline, duplicate detection) compose multiple repos.

## Sync engine (V3)

A registry-driven `SyncEngine` over a `SyncTransport` port: every entity is **one
`defineSyncable` call** behind an **opt-in allowlist**, reconciled with `resolveMerge`
(whole-row LWW), with durable watermarks in a device-local `sync_state` table. The canonical
"how to add a synced entity" recipe is the `defineSyncable` module doc comment. Design and
status: [`plans/encryption/`](../../plans/encryption/) and
[`plans/status.md`](../../plans/status.md).

## Deferred

- `WITHOUT ROWID` for the `TEXT`-PK tables — a minor storage/lookup optimization; evaluate
  later.
