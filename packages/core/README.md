# @leapsake/core

The **client-agnostic application surface**. `createCore(driver)` constructs every repository
over one `SqliteDriver`, hands them to each feature package's `createXApi(deps)`, and returns
the assembled **`CoreApi`**. Free of any transport or UI concern.

## What is actually here

Composition, and three things that are genuinely core's:

| In `src/`    | What                                                                                |
| ------------ | ------------------------------------------------------------------------------------ |
| `index.ts`   | the wiring, plus the thin sections that are one repo call each (tags, search, kinship) |
| `views.ts`   | read-and-compose view-model builders — the one place that reads everything for display |
| `sync.ts`    | `syncableRepos`, the allowlist of what may leave the device                           |

Everything with domain logic of its own lives in its own package and arrives through
`deps`: [`holidays`](../holidays/README.md), [`reminders`](../reminders/README.md),
[`gifts`](../gifts/README.md), [`contact-import`](../contact-import/README.md),
[`export`](../export/README.md), and the cross-repo services in [`data`](../data/README.md)
(entity cascades and merge, relationship writes, kinship, duplicates, search).

`views.ts` stays because it is the exception that proves the rule: every builder is `async`
and reads through repo ports, so it is composition-for-display rather than derivation.
[`@leapsake/view-models`](../view-models/README.md) is the pure, synchronous counterpart both
clients share; nothing in `views.ts` belongs there without being made repo-free first.

## Why `core` exists — it was extracted to make V2 a port

`core` is **not** in the original plan. It was extracted to hold the logic that is neither
pure-domain (`schema`) nor raw persistence (`data`) but must be **identical across clients**.
Both clients consume it the same way:

- **Desktop** builds the core in the Electron main process and forwards each method over typed
  IPC. The preload's `Api` type **is** `CoreApi` (`export type Api = CoreApi`), so the IPC
  bridge can never drift from core.
- **Mobile** builds the core in-process and calls it directly.

This is the seam that made V2 a _UI_ port: the entire non-UI surface was already
client-agnostic and tested, so only the UI was new.

## Two kinds of "merge" (sync vs. reconciliation)

Leapsake has two distinct merge problems; conflating them causes bugs.

|                 | Same-`id` reconciliation                       | Distinct-`id` reconciliation                       |
| --------------- | ---------------------------------------------- | -------------------------------------------------- |
| **What**        | Two _versions_ of the **same row** (same UUID) | Two _different rows_ that mean the **same person** |
| **When**        | Sync: the same record edited on two devices    | A dupe is hand-created, joined, or imported        |
| **Who decides** | Nobody — fully automatic                       | Often a **human** (ambiguous)                      |
| **Mechanism**   | `resolveMerge` (whole-row LWW, in `schema`)    | `core.people.merge` + the scorer (here + `schema`) |

Sync's `resolveMerge` only ever merges rows with a **matching id**; two records for the same
person have **different** UUIDs, so LWW never touches them — they coexist as duplicates.
**Reconciliation** (`core.people.merge`, `core.duplicates.*`) fills that gap: it detects
likely dupes (`scoreDuplicate`), remembers rejected pairs (the syncable `not_a_duplicate`
table), and **merges** distinct rows by re-pointing FKs to a survivor.

The re-pointing itself — which tables a merge must touch, and why it replicates with no
merge-specific sync code — is [`@leapsake/data`](../data/README.md) → _What a person-merge
must re-point_, beside `createEntityService` which performs it. `core.people.merge` adds only
the reminder reconcile that re-titles the loser's birthday reminder onto the survivor.

Remaining reconciliation work (bulk-import dedup, the fuzzy-name tier, E.164 phone matching)
lives in [`plans/status.md`](../../plans/status.md).
