# Holiday prompt

A once-a-year question ahead of each relevant holiday ("Halloween is in five weeks: what do you
want to do for it?"), covering your own errands and the people who keep it. It arrives without
any setup, because who observes what is implied from people's affiliations. The
hard-to-reverse decision is in [`adr/`](./adr/).

## Increments, in order

Each one ships on its own.

1. **Grouped display** ([ADR 0002](./adr/0002-wishes-stay-individual-reminders.md)). Before the
   day, an occasion's wishes fold to one line, "Wish people a Merry Christmas". On the day they're
   individual rows under Today. The digest uses the same wording, never a count.

## Open, and deliberately not decided here

- **Islamic holidays** stay a separate decision (`v0-2.md` → *Holidays*). Until then, a Muslim
  affiliation makes nothing relevant.
- **A long observer list** stays inline at first. If the prompt reads as too much, it links out to
  the Holiday screen instead.
- **Why someone is implied.** Observer lists don't yet say that someone is there by affiliation
  rather than by choice (`explicit === null`), or which affiliation it was.
- **Export** carries hidden holidays but not the "Don't ask again" switch (`unasked_holidays`).
