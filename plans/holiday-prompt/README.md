# Holiday prompt

A once-a-year question ahead of each relevant holiday ("Halloween is in five weeks: what do you
want to do for it?"), covering your own errands and the people who keep it. It arrives without
any setup, because who observes what is implied from people's affiliations. Terms are in
[`GLOSSARY.md`](./GLOSSARY.md), and the hard-to-reverse decision is in [`adr/`](./adr/).

## Increments, in order

Each one ships on its own.

1. **The holiday prompt.** One per (holiday, occurrence).
   - **Who it asks about:** it asks only for a relevant, not-hidden holiday, and only when it has
     an authored suggestion, a default-on wish, or something already on its schedule.
   - **Your errands:** at most two or three neutral suggestions per holiday, and none when
     unsure. They appear only if you observe the holiday too, and live on your self-observance.
     With no self-person, ticking one first asks which person is you.
   - **Other people:** they appear as one collapsed wish line that expands to per-person ticks
     and an add-observer field. You're never on it.
   - **Timing:** derived from the furthest offer, and a late arrival offers only what still
     fits, as for a hand-entered milestone.
   - **Don't ask again:** a reversible per-holiday switch, distinct from hide.
2. **Grouped display** ([ADR 0002](./adr/0002-wishes-stay-individual-reminders.md)). Before the
   day, an occasion's wishes fold to one line, "Wish people a Merry Christmas". On the day they're
   individual rows under Today. The digest uses the same wording, never a count.

## Open, and deliberately not decided here

- **Islamic holidays** stay a separate decision (`v0-2.md` → *Holidays*). Until then, a Muslim
  affiliation makes nothing relevant.
- **A long observer list** stays inline at first. If the prompt reads as too much, it links out to
  the Holiday screen instead.
- **Why someone is implied.** Observer lists don't yet say that someone is there by affiliation
  rather than by choice (`explicit === null`), or which affiliation it was.
