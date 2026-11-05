# A merge is a permanent record, the first one wins, and none is undone

Sync reconciles each row alone by whole-row last-writer-wins, so a "merged into" column on the
loser would be erased by any later write from a device that never saw the merge. A merge is
therefore its own record, written once and never edited, which every device applies whenever it
arrives. When two records disagree about one person, the earlier wins (a fixed tiebreak for the
same instant), because the first choice was made with the most context and "last wins" would
let a stale device overrule it days later. No merge is undone: an undo would need a second
record and a way to tell which facts came from which card, and _not a duplicate_ already covers
the opposite answer.

## Considered Options

- **A column on the person row.** Erased by stale writes, unless reconciling special-cased it.
- **Last merge wins.** Matches every other row, but lets a long-offline device overrule.
- **A fixed rule, such as the oldest person survives.** Ignores the user's choice.
