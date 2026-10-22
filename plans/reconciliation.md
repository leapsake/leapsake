# Reconciliation — dedup and merge quality

How the built parts work is in [`../packages/core/README.md`](../packages/core/README.md).

- **Fuzzy / typo-tolerant name matching** — the scorer's reserved `"low"` tier, via
  `fastest-levenshtein` or `cmpstr`, entirely inside `duplicate-score.ts`'s `sameFoldedName`
  predicate. No caller or API change.
- **Pets / generalized `mergeEntities`** — a small follow-on; the reference graph is already
  entity-typed.
- **Attach in desktop's import review.** Mobile's phone sync attaches a contact to the person it
  already is ([`@leapsake/contact-import`](../packages/contact-import/README.md) → _Attaching a
  contact_); desktop's drag-and-drop review still creates, and wants it as a third choice per row.

_Open:_ **survivorship granularity** (v1 keeps the survivor's scalar fields wholesale; a per-field
picker is deferred — revisit if users hit it) and **concurrent merges** (two devices merging
overlapping pairs differently may diverge under LWW; noted, not solved).
