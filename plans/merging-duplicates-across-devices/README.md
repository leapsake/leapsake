# Merging duplicates across devices

Make **merging duplicates** come out the same on every device, whatever order devices merge and
sync in, for people and for pets. Vocabulary: [`GLOSSARY.md`](./GLOSSARY.md).

**When:** before sync reaches users, after the auto-sync switch; not before the owner's own use
of the preview. It brings a migration, so it lands on `main` only finished and safe for users.

## What goes wrong today

Merging two people re-points the loser's facts to the survivor, bumps the survivor and
tombstones the loser (`packages/data/README.md` → _What a person-merge must re-point_). Each row
then reconciles alone, by whole-row last-writer-wins. That converges when one device merges, and
fails when two do before they sync:

- **Opposite directions.** One device merges B into A, another A into B. The later device wins
  both person rows, so one survives, and facts only the earlier device re-pointed stay on the
  tombstoned one, unseen. Two merges in the same millisecond can tombstone both people.
- **Chains.** One device merges B into A, another C into B: C's facts end on the tombstoned B.
- **Stale writes.** A device that never saw the merge edits the loser later, and last-writer-wins
  brings the loser back to life.
- **Pets** have no duplicate detection or merge at all, so two devices that each made "Max" keep
  two after a join.

## Decisions so far

- Both gaps, people and pets, are this one plan, with people designed first.
- **The full promise.** However many devices merge, in whatever order, and however late a
  device syncs: every device ends with the same live people, and no fact is left on a loser.
  That covers all three failures above, not just opposite directions.
- **A merge is a merge record**, written once and never edited, so a late write cannot erase
  it. Every device applies each one whenever it arrives.
- **The first merge wins** when devices disagree about one person, with a fixed tiebreak for
  the same instant. Every fact still ends on the one survivor; only whose card stays differs.
- **No undo**, in this plan. _Not a duplicate_ already covers the opposite answer.
- **The tidy-up** runs after every sync and every merge, and moves anything still attached to a
  loser onto its survivor, this device's own unsynced links included. Readers stay unchanged.
- **A late edit to a loser:** facts attached to it move to the survivor; edits to the loser's
  own card are dropped, and it stays merged away.
- **Pets get the same rules** and the same _possible duplicate_ prompt, after people.
- **A merge beats _not a duplicate_** for the same pair, which is retired.
- **A delete of the survivor stands** when it came first, and the merged facts go with it. A
  survivor tombstoned only by an overruled merge comes back.
- **No backfill.** Past merges were single-device and already moved their facts; the migration
  only adds the new table.
- **Proof:** a shuffled test of three devices against a live relay (random merges, edits,
  deletes and syncs, then the promise checked), plus one named test per case above.

The merge record, first-wins and no undo: [`adr/0001-merge-records.md`](./adr/0001-merge-records.md).

## Order

1. **The merge record.** A migration adds the synced table; merging people writes one.
2. **The tidy-up**, in `@leapsake/data`, run after a merge and after every sync pull. It
   applies first-wins, re-tombstones losers, revives a survivor only an overruled merge
   tombstoned, retires _not a duplicate_ for a merged pair, and moves facts and this device's
   links onto survivors.
3. **The proof:** one named test per case, then the shuffled three-device test.
4. **Pets:** merging pets on the same record and tidy-up, then the _possible duplicate_ prompt
   for pets on both clients.
