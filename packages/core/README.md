# @leapsake/core

The **client-agnostic application surface**. `createCore(driver)` wires every repository and
service over one `SqliteDriver` and returns a **`CoreApi`**: transactional multi-repo writes,
cascade soft-deletes, relationship orientation (resolving raw `a`/`b` endpoints to "the other
end" with a label and role), and read-and-compose view-model builders (`views.ts`). Depends
on `data` + `schema`; free of any transport/UI concern.

## Why `core` exists — it was extracted to make V2 a port

`core` is **not** in the original plan. It was extracted to hold the logic that is neither
pure-domain (`schema`) nor raw persistence (`data`) but must be **identical across clients**.
Both clients consume it the same way:

- **Desktop** builds the core in the Electron main process and forwards each method over typed
  IPC. The preload's `Api` type **is** `CoreApi` (`export type Api = CoreApi`), so the IPC
  bridge can never drift from core.
- **Mobile** builds the core in-process and calls it directly.

This is the seam that made V2 a *UI* port: the entire non-UI surface was already
client-agnostic and tested, so only the UI was new.

## Two kinds of "merge" (sync vs. reconciliation)

Leapsake has two distinct merge problems; conflating them causes bugs.

| | Same-`id` reconciliation | Distinct-`id` reconciliation |
|---|---|---|
| **What** | Two *versions* of the **same row** (same UUID) | Two *different rows* that mean the **same person** |
| **When** | Sync: the same record edited on two devices | A dupe is hand-created, joined, or imported |
| **Who decides** | Nobody — fully automatic | Often a **human** (ambiguous) |
| **Mechanism** | `resolveMerge` (whole-row LWW, in `schema`) | `core.people.merge` + the scorer (here + `schema`) |

Sync's `resolveMerge` only ever merges rows with a **matching id**; two records for the same
person have **different** UUIDs, so LWW never touches them — they coexist as duplicates.
**Reconciliation** (`core.people.merge`, `core.duplicates.*`) fills that gap: it detects
likely dupes (`scoreDuplicate`), remembers rejected pairs (the syncable `not_a_duplicate`
table), and **merges** distinct rows by re-pointing FKs to a survivor.

### What a person-merge must re-point

`core.people.merge(survivor, loser)` is the cascade-delete-person transaction inverted —
instead of removing the loser's references, it **re-points** them to the survivor, then
soft-deletes the loser. A Person id is referenced in these places (the full set, confirmed
against the cascade-delete path), each with a `repointEntity`/`repointOwner` building block on
its repo:

| Table / repo | FK column(s) | Note |
|---|---|---|
| relationships | `aId`/`aType`, `bId`/`bType` | either endpoint; prune self-loops + dup-edges after |
| taggings | `entityId`/`entityType` | drop a tagging the survivor already has |
| milestones | `subjectId`/`subjectType` | subject may also be a *relationship* — unaffected |
| emails / phones / postals | `ownerId`/`ownerType` | three tables, same shape |
| dismissals | `subjectId` **and** `otherId` | directional — both ends; drop now-self rows |
| not_a_duplicate | `lowerId` / `higherId` | re-canonicalize; drop self-pairs |

**It syncs for free:** re-points bump `updatedAt` (propagate as normal edits) and the loser's
soft-delete is a tombstone (propagates) — a merge on one device just *happens* on the other
via the existing engine, no new sync code. The survivor's `updatedAt` is bumped so it wins
LWW against a concurrent edit to the loser elsewhere. Endpoints/owners are already
entity-typed, so a future `mergePets` / generalized `mergeEntities` is a small follow-on.

Remaining reconciliation work (bulk-import dedup, the fuzzy-name tier, E.164 phone matching)
lives in [`plans/status.md`](../../plans/status.md).
