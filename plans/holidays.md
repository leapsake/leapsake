# Holidays — doors deliberately left open

How the shipped feature works is in [`@leapsake/holidays`](../packages/holidays/README.md), which
also describes the mechanisms each item below would use. The design admits each **additively**,
which is why they were deferred rather than built.

**One calendrical task with a real deadline:** re-derive the eight lunisolar tables before ~2050.
They run to 2056; see `packages/holidays/src/catalog.ts`.

- **Islamic holidays** (Eid al-Fitr, Eid al-Adha, Ramadan) — **consciously skipped, not missed.**
  The dates depend on moon _sighting_ and differ by country and authority, so no computation yields
  one correct date. The three options weighed were: tabulate Umm al-Qura and state that the local
  date may differ by a day; one entry per authority as a `familyId` family; or a "date may shift"
  flag, the only one of the three that is not purely additive. Meanwhile **hide + create** already
  composes an answer for anyone who needs a specific authority.
- **Hindu and Buddhist holidays** (Diwali, Holi, Vesak) — blocked on **sourcing, not effort.**
  There is no second independent implementation to check these against the way ICU checks the
  Hebrew and Chinese tables: ICU's `indian` calendar is the Saka _solar_ calendar, not the
  lunisolar panchanga Diwali needs. The civil date turns on which day the tithi prevails at
  sunrise, with genuine Amanta/Purnimanta regional variation, and published almanac dates do not
  reach the 2056 horizon. **Do not author these from a single computation** — every other table in
  the catalog was gated against exactly that.
- **Holiday reminders with no Person attached** ("get a tree"). The bearer-type enum and disjoint
  id namespaces admit `holiday` later with no schema change.
- **Synchronized load** (everyone's Christmas reminders come due at once, unlike birthdays) — ids
  key on occurrence + action, not surface date, so it can be tuned whenever it starts to hurt.
- **Why someone is implied.** Observer lists don't say that someone is there by affiliation rather
  than by choice (`explicit === null`), or which affiliation it was.
- **A long observer list** stays inline on the holiday prompt. If it reads as too much, the wish
  line links out to the holiday's page instead.
- **Export** carries hidden holidays but not the "Don't ask again" switch (`unasked_holidays`).
- **User-defined holidays authoring UI.** The schema has been capable from day one; expected <1%
  of users.
- **Observed-date shifting** (holiday falls Saturday → observed Friday). Matters for "office
  closed", barely for gifting. **Leaning skip**; noted, not solved.
- **Per-user greeting overlay** — "Happy Christmas" for a British user. An overlay, never an edit
  to a read-only catalog row.
- **@-mentioning holidays.** Not free (the `mentions` table references entity UUIDs; holiday
  identity is slug-based) and not a priority. The better shape for the underlying idea is
  natural-language date detection — "on Christmas" fills the due date.
- **Events** — user-defined, separate-but-related to Milestones and Holidays. Much further out.
  The motivating distinction: _"my family does a thing on August 3rd"_ (an Event) vs. _"my family
  observes an obscure holiday on August 3rd"_ (a user-defined Holiday).
