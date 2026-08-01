# Leapsake — Reconciliation (dedup & merge)

> **Unbuilt work only.** How the built parts work — the two-kinds-of-merge framing and the
> person reference graph — is in [`packages/core/README.md`](../packages/core/README.md); how
> they came to be is in `git log`. This doc is deleted when the list below empties.

**State:** A, B, and C's merge-on-join are built. The review surface is detection-driven rather
than permanently advertised. Quality work — none of it blocks v0.1, and it can land either side
of launch as capacity allows.

## What remains

- **Fuzzy / typo-tolerant name matching** — the scorer's reserved `"low"` tier, via
  `fastest-levenshtein` or `cmpstr`, entirely inside `duplicate-score.ts`'s `sameFoldedName`
  predicate. No caller or API change.
- **`libphonenumber-js` phone normalization** — E.164 canonicalization; its own increment.
- **Pets / generalized `mergeEntities`** — a small follow-on; the reference graph is already
  entity-typed.
- **Bulk-import dedup** — deferred until the importer exists, at which point it is mostly A+B
  reuse, honoring the `not_a_duplicate` memory.

## Open questions

- **Survivorship granularity.** v1 keeps the survivor's scalar fields wholesale; a per-field
  picker is deferred. Revisit if users hit it.
- **Concurrent merges.** Two devices merging overlapping pairs differently is an edge case
  (re-points + tombstones may diverge under LWW). Acceptable to defer — noted, not solved.
