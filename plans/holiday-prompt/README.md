# Holiday prompt

A once-a-year question ahead of each relevant holiday ("Halloween is in five weeks: what do you
want to do for it?"), covering your own errands and the people who keep it. It arrives without
any setup, because who observes what is implied from people's affiliations. Terms are in
[`GLOSSARY.md`](./GLOSSARY.md), and the hard-to-reverse decision is in [`adr/`](./adr/).

## Increments, in order

Each one ships on its own.

1. **Partial addresses.** Any one field makes an address, so "France" alone is valid. Anything
   that posts something treats an address as mailable only if it has a street line.
2. **Your country.** A synced setting, seeded once from the first device's region, editable in
   Settings, and overridden by the self-person's own address country. It can't be device-local:
   two devices disagreeing would prune each other's reminders for good.
3. **Affiliations.** *Nationalities* and *Religions* on a person, both stated. Residence is
   derived from address countries, or from your country when no address has one, even alongside
   a stated nationality. Catalog entries carry an affiliation **set** (Christmas: Christian plus
   the countries where it's also secular). Religion is never inferred from country, or the
   reverse. The religion list is complete even where the catalog has no holidays for it.
4. **Implicit observers.** A living person whose affiliations match a holiday observes it
   implicitly. Pets and the dead never do, though either can be added explicitly. An observance
   has three states: *observes*, *doesn't observe*, and *unstated*. Ticking anything for a person
   writes *observes*. Only unticking writes *unstated*, holding the off rule and saying nothing
   about whether they keep the day. *Doesn't observe* is its own action. A per-holiday wish
   default, authored in the shipped catalog (Christmas on, Columbus Day off), applies to every
   observer until a choice is made for them.
5. **The holiday prompt.** One per (holiday, occurrence).
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
6. **Grouped display** ([ADR 0002](./adr/0002-wishes-stay-individual-reminders.md)). Before the
   day, an occasion's wishes fold to one line, "Wish people a Merry Christmas". On the day they're
   individual rows under Today. The digest uses the same wording, never a count.

## Rules this retires, once it lands

In `packages/holidays/README.md`: *observance is explicit-first* becomes "explicit beats
implicit", and *no observance reminder is on by default* gives way to the per-holiday wish
default. Edit each where the increment that breaks it lands.

## Open, and deliberately not decided here

- **Islamic holidays** stay a separate decision (`v0-2.md` → *Holidays*). Until then, a Muslim
  affiliation makes nothing relevant.
- **A long observer list** stays inline at first. If the prompt reads as too much, it links out to
  the Holiday screen instead.
