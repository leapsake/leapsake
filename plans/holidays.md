# Holidays — doors deliberately left open

How the shipped feature works is in [`@leapsake/holidays`](../packages/holidays/README.md), which
also describes the mechanisms each item below would use.

**One calendrical task with a real deadline:** re-derive the eight lunisolar tables before ~2050.
They run to 2056; see `packages/holidays/src/catalog.ts`.

- **Hindu and Buddhist holidays** (Diwali, Holi, Vesak) — blocked on a second independent source
  to cross-check the tables against, as ICU checks the Hebrew and Chinese ones.
- **Holiday reminders with no Person attached** ("get a tree"). The bearer-type enum and disjoint
  id namespaces admit `holiday` later with no schema change.
- **Synchronized load** (everyone's Christmas reminders come due at once, unlike birthdays) — ids
  key on occurrence + action, not surface date, so it can be tuned whenever it starts to hurt.
- **Why someone is implied.** Observer lists don't say that someone is there by affiliation rather
  than by choice (`explicit === null`), or which affiliation it was.
- **Export** carries hidden holidays but not the "Don't ask again" switch (`unasked_holidays`).
- **User-defined holidays authoring UI.** The schema has been capable from day one; expected <1%
  of users.
- **Per-user greeting overlay** — "Happy Christmas" for a British user. An overlay, never an edit
  to a read-only catalog row.
- **@-mentioning holidays.** Not free (the `mentions` table references entity UUIDs; holiday
  identity is slug-based) and not a priority. The better shape for the underlying idea is
  natural-language date detection — "on Christmas" fills the due date.
- **Events** — user-defined, separate-but-related to Milestones and Holidays. Much further out.
  The motivating distinction: _"my family does a thing on August 3rd"_ (an Event) vs. _"my family
  observes an obscure holiday on August 3rd"_ (a user-defined Holiday).
