# Holiday wishes stay one reminder per person; grouping is only on screen

Forty people observing Christmas means forty wish reminders, each with its own deterministic id
and its own tick. Before the day, the list folds them into one line ("Wish people a Merry
Christmas"). On the day they're individual rows under Today, and the notification digest names
the occasion, not a count. One aggregate "wish everyone" reminder was rejected because its id
differs from the per-person ones: moving between the two later loses completion state, whereas
changing how individual rows are presented is free.
