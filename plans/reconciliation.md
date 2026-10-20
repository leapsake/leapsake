# Reconciliation — dedup and merge quality

How the built parts work is in [`../packages/core/README.md`](../packages/core/README.md).

- **Fuzzy / typo-tolerant name matching** — the scorer's reserved `"low"` tier, via
  `fastest-levenshtein` or `cmpstr`, entirely inside `duplicate-score.ts`'s `sameFoldedName`
  predicate. No caller or API change.
- **`libphonenumber-js` phone normalization** — E.164 canonicalization; its own increment.
- **Pets / generalized `mergeEntities`** — a small follow-on; the reference graph is already
  entity-typed.
- **Bulk-import dedup.** Today `ingestContacts` creates every accepted contact unconditionally,
  so importing an overlapping list produces duplicates _after the fact_. Mostly A+B reuse: score
  each parsed contact against the existing set before the review screen renders. The seam exists —
  `ImportDecision.action` is an enum with `create` and `skip`, and this adds a third arm pointing
  at an existing person. **Must honor the `not_a_duplicate` memory**, or a pair the user already
  dismissed comes back on every import.
  > ⚠️ **The import nudge shipped first** _(owner, 2026-09-10)_, so this is now the second half of
  > a first run rather than a refinement: the getting-started step sends a brand-new user straight
  > into an import, and every duplicate it creates lands on a Home that has barely anything else
  > on it. Suppressing the duplicates nudge for a window instead is a **trap, not a dial** — its
  > id is content-addressed on the pair set, so reporting no pairs tombstones that exact id and
  > the same set re-deriving later never comes back.

_Open:_ **survivorship granularity** (v1 keeps the survivor's scalar fields wholesale; a per-field
picker is deferred — revisit if users hit it) and **concurrent merges** (two devices merging
overlapping pairs differently may diverge under LWW; noted, not solved).
