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

**Version numbers are never reused, and gaps are harmless.** 26 and 34 are absent: they created
gift tables that were rewritten in place under the pre-v0.1 latitude when the gift model shrank
to two tables. Leaving the numbers unused makes a stale profile fail loudly on a missing table
rather than quietly on a renumbered one; the runner filters and sorts by version. From v0.1 on,
existing migrations are never edited or reordered.

**Some tables are device-local and never replicate:** `content_key`, `key_wrap`, `sync_state`,
`account`, `device` and `device_contact_links`. None is a syncable repo, and none is in the sync
engine's allowlist. The key tables are empty until an account exists, so code reading them
treats "no rows" as normal. A `device_contact_links` row (an address-book contact id means
nothing in another address book) is never tombstoned when its person is deleted or merged: it
still being there is what stops the next sync re-importing them.

The table conventions every migration follows — a `TEXT` `id` primary key, `INTEGER` epoch-ms
`created_at`/`updated_at`/`deleted_at`, `snake_case`, no `CHECK` constraints — are asserted
against the schema the migrations actually produce, in
[`apps/desktop/test/integration/schema-conventions.test.ts`](../../apps/desktop/test/integration/schema-conventions.test.ts).
That test is the specification; its header explains why each rule exists.

## Repositories & services

Each entity has an async repo over the port (`create`, `list`/`listForEntity`, `get`,
`update`, `softDelete`, cascade `removeAllForEntity`/`removeAllForOwner`, and — for
reconciliation — `repointEntity`/`repointOwner`). Cross-repo _services_ (kinship derivation,
search folding/matching, milestone timeline, duplicate detection, whole-entity writes)
compose multiple repos.

### What a person-merge must re-point

`createEntityService(...).mergePeople(survivor, loser)` is the cascade-delete-person
transaction inverted — instead of removing the loser's references, it **re-points** them to
the survivor, then soft-deletes the loser. A Person id is referenced in these places (the full
set, confirmed against the cascade-delete path), each with a `repointEntity`/`repointOwner`
building block on its repo:

| Table / repo              | FK column(s)                  | Note                                                |
| ------------------------- | ----------------------------- | --------------------------------------------------- |
| relationships             | `aId`/`aType`, `bId`/`bType`  | either endpoint; prune self-loops + dup-edges after |
| taggings                  | `entityId`/`entityType`       | drop a tagging the survivor already has             |
| milestones                | `subjectId`/`subjectType`     | subject may also be a _relationship_ — unaffected   |
| emails / phones / postals | `ownerId`/`ownerType`         | three tables, same shape                            |
| dismissals                | `subjectId` **and** `otherId` | directional — both ends; drop now-self rows         |
| not_a_duplicate           | `lowerId` / `higherId`        | re-canonicalize; drop self-pairs                    |

**It syncs for free:** re-points bump `updatedAt` (propagate as normal edits) and the loser's
soft-delete is a tombstone (propagates) — a merge on one device just _happens_ on the other
via the existing engine, no new sync code. The survivor's `updatedAt` is bumped so it wins
LWW against a concurrent edit to the loser elsewhere. Endpoints/owners are already
entity-typed, so a future `mergePets` / generalized `mergeEntities` is a small follow-on.

## The sync substrate (V3)

The engine, transports, and scheduler live in [`@leapsake/sync`](../sync/README.md). What
stays here is the substrate they run on: **`defineSyncable`** — the primitive that makes an
entity syncable in one call, reconciled with `resolveMerge` (whole-row LWW) — and
**`SyncStateRepo`**, the durable watermarks in a device-local `sync_state` table. The
canonical "how to add a synced entity" recipe is the `defineSyncable` module doc comment.

**A row every device must agree on gets a fixed primary key, not a unique column.**
`self_person` is a singleton under a constant id, and `notification_settings` uses the device
id as its `id`. Two devices writing the same primary key resolve by whole-row last-writer-wins,
where a unique index on `people.is_self` would fail the merge outright, and `account.self_id`
could not sync at all (`account` never replicates). The same trick lets both ride
`defineSyncable`, which addresses rows by `id`.
Design and status: [`plans/encryption/`](../../plans/encryption/) and
[`plans/status.md`](../../plans/status.md).

## Deferred

- `WITHOUT ROWID` for the `TEXT`-PK tables — a minor storage/lookup optimization; evaluate
  later.
