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

The suite is framework-agnostic (it receives `describe`/`it`/`expect` as a parameter) and
schema-independent (each case makes its own table and driver), which is what lets the mobile
self-test run it unchanged on a device. Two things keep it from going stale: desktop gates the
driver file at 100% coverage, so a new desktop code path fails until a case exercises it, and the
self-test reads a zero-case run as a failure. Where native libraries most plausibly diverge next:
type and affinity coercion, large BLOBs, constraint-error shape, nested transactions, collation,
and any new `SqliteDriver` method.

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
treats "no rows" as normal.

⚠️ **`createContentCipher` has no caller, and reviving one has a hard dependency.** The account
merge swaps a store's master key for another account's and re-wraps nothing. That is safe only
while no live `content_key`/`key_wrap(content)` rows exist, which `account-merge.test.ts`
asserts. The first repo to call `sealField` again must, in the same change, teach the merge to
unwrap each live content key under the old master key and re-wrap it under the adopted one, or a
merge silently strands every encrypted field on the device. A `device_contact_links` row (an address-book contact id means
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

**Every re-point writes `updated_at = MAX(now, updated_at + 1)`**, so the rewrite is strictly
newer than the row it replaces and wins LWW on every device, even when the merge lands in the
row's creation millisecond. Each repo's `repointEntity`/`repointOwner` does this, and every
tombstone goes through `softDeleteWhere`/`softDeleteRow` in `entity-repo.ts` for the same reason:
a delete that ties on `updated_at` can be resurrected by LWW's tiebreak.

**It syncs for free:** re-points bump `updatedAt` (propagate as normal edits) and the loser's
soft-delete is a tombstone (propagates) — a merge on one device just _happens_ on the other
via the existing engine, no new sync code. The survivor's `updatedAt` is bumped so it wins
LWW against a concurrent edit to the loser elsewhere. Endpoints/owners are already
entity-typed, so a future `mergePets` / generalized `mergeEntities` is a small follow-on.

### Unpublished entities

An unpublished person or pet exists only as a fact about one published entity: a coworker's wife
recorded as a name on his relationship. It holds exactly one explicit relationship, to that
entity, and the rules that keep it on that one page are spread across the services:

- **Creation** has one route, `createWithNewOther`: a name typed into the relationship form that
  matches nobody creates the entity, unpublished, and its one edge in the same transaction. The
  name is taken verbatim for a pet and split on the first space for a person.
- **Duplicate detection** leaves it out of the pool: two "Ruth"s on two coworkers are two people.
  It runs at promotion instead, when they first become someone the user can pick.

- **Kinship** leaves it out of inference entirely: never a subject, a route or a destination. The
  composition table maps `(parent, sibling)` to pibling, so an unpublished sibling of a parent
  would otherwise surface as a derived aunt on a second page. It also keeps a future
  `(parent, spouse) → parent` rule from leaking one.
- **Search** finds it only as a facet of its anchor, whose page is the only place it is read.
- **Promotion**: the moment it gains a fact of its own (a birthday, a gender, a contact method, a
  tag, a second relationship), `publishIfUnpublished` publishes it, inside the same transaction
  as the write. The one-edge invariant is kept by promoting, never by refusing. A name edit does not promote, since a name is the one thing it may have; a patch
  that sets `standing` explicitly is never overridden.
- **Deletion** cascades to it with its anchor, one level deep, because the one-edge rule means
  there is never a second rung. `attachedUnpublished` must read before the relationships go: the
  edge is the only thing that ties it to its anchor.

## The sync substrate (V3)

The engine, transports, and scheduler live in [`@leapsake/sync`](../sync/README.md). What
stays here is the substrate they run on: **`defineSyncable`** — the primitive that makes an
entity syncable in one call, reconciled with `resolveMerge` (whole-row LWW) — and
**`SyncStateRepo`**, the device-local `sync_state` key/value table. A missing row reads as `0`,
the floor for both watermarks (`push(0)` collects every row, `pull(0)` the whole log). Beside the
watermarks it holds per-install facts that must not replicate: `auto_sync_disabled` (inverted,
so no row means on), the seeded holiday-catalog version (an integer, so not semver; seeding by
checking for rows would re-seed stale bundles and resurrect deleted holidays), the pending
recovery escrow after an offline rotation, the master-key repair flag, and whether this device
keeps People in step with its address book (opt-in, so a factory reset does not refill a store
the user just emptied). The
canonical "how to add a synced entity" recipe is below.

### How to make an entity sync-eligible

Sync is **opt-in**: a table replicates only once its repo is registered. The device-local tables
listed under *Migrations* must never leave the device, so sync-by-default is exactly the wrong
default. The `repos` array passed to `createSyncEngine` is the allowlist, and a guard test pins it.

1. **Migration.** The table carries the sync substrate: a UUID `id`, and epoch-ms `created_at`,
   `updated_at` and nullable `deleted_at`.
2. **Schema.** A `z.object({...})` row schema in `packages/schema` whose camelCase fields are the
   snake_case columns. It validates a peer's payload and supplies the column list, so it is the
   only place the fields are spelled out.
3. **Repo.** Spread `defineSyncable<Place>({ driver, table: "places", schema: placeSchema })`
   beside the repo's own CRUD. That supplies `table`, `decode`, `listChangedSince`, `listActive`
   and `upsertFromRemote` with no per-entity SQL. The options cover what the default cannot
   infer: `booleans` (stored as 0/1; forgetting one fails loudly on the first synced read),
   `json` (stored as TEXT; NULL decodes to `undefined`, so a new column needs no backfill),
   `codec` (only when the on-wire and on-disk shapes differ; nothing needs one today), and
   `hasHistory` (below).
4. **Register.** Add the repo to the `repos` array and to the allowlist guard test: the
   conscious "this table may leave the device" step.

Steps 1 and 2 are work any entity needs; 3 and 4 are the whole sync cost. The shared harness in
`test/sync.test.ts` covers the round-trip.

**`hasHistory` should stay rare.** It narrows the merge so an untouched row never beats one a
user acted on, whatever `updated_at` says. It can only matter where two devices mint the *same*
id independently, a deterministic-id family, and today only `reminders` has a per-row decision
worth protecting (`packages/reminders/README.md` → *Merge safety*). The holiday catalog depends
on plain LWW over authored timestamps. It is also the seam a field-level merge would grow from.

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
