# Merging duplicates across devices

The words for combining two records of one person or pet, kept apart from the two other things
this repo also calls a merge.

## Language

**Merging duplicates**:
Combining two people, or two pets, that are the same being into one, keeping every fact either
held.
_Avoid_: merge (alone), dedupe, combine

**Survivor**:
The one of two duplicates that remains after they are merged.
_Avoid_: winner, keeper, target

**Loser**:
The one of two duplicates that is merged away, its facts moving to the survivor.
_Avoid_: duplicate (for this role alone), source, victim

**Merge record**:
The permanent fact that one loser was merged into one survivor. Never edited or undone.
_Avoid_: merge event, redirect, forwarding note

**Overruled merge**:
A merge that lost to an earlier one about the same person, so its choice of survivor is not
kept, though every fact it moved still is.
_Avoid_: conflicting merge, rejected merge

**Tidy-up**:
Moving whatever is still attached to a loser onto its survivor, after a sync or a merge.
_Avoid_: repair, cleanup, migration

**Account merge**:
Moving a device's local-only account, and everything in it, into an account that already syncs.
_Avoid_: merge (alone), joining

**Reconciling**:
What sync does when two devices hold different versions of the same row: keep one of them.
_Avoid_: merge, conflict resolution
