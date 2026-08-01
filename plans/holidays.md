# Leapsake — Holidays: the doors left open

> **Unbuilt work only.** How the shipped feature works — the catalog / observance / rule
> layering and the decisions that constrain changing it — is in
> [`@leapsake/holidays`](../packages/holidays/README.md), which also describes the mechanisms
> each item below would use. This doc is deleted when the list empties.

**State:** shipped on both clients — catalog, recurrence engine, synced observances,
per-occurrence reminders. Nothing here blocks anything; the design admits each item
**additively**, which is why they were deferred rather than built.

## One calendrical task with a real deadline

- **Re-derive the two provisional lunisolar tables before ~2050.** They run to 2056; see
  `packages/holidays/src/catalog.ts`.

## Doors deliberately left open

- **Holiday reminders with no Person attached** ("get a tree"). The bearer-type enum and the
  disjoint id namespaces admit `holiday` later with no schema change.
- **Aggregate / grouped reminders** — collapsing "40 Christmas cards" into one row. ⚠️ **The
  one non-reversible item here**: an aggregate is a different deterministic id, so migrating
  later loses completion state.
  - Related: **synchronized load** — everyone's Christmas reminders come due at once, unlike
    birthdays. That half *is* reversible (ids key on occurrence + action, not surface date), so
    it can be tuned whenever it starts to hurt.
- **User-defined holidays authoring UI.** The schema has been capable from day one; expected
  <1% of users.
- **Religions / Nationalities fields** as bulk-assignment accelerators, with the inference
  constraints the package README pins.
- **Observed-date shifting** (holiday falls Saturday → observed Friday). Matters for "office
  closed", barely for gifting. Leaning skip; noted, not solved.
- **Per-user greeting overlay** — "Happy Christmas" for a British user. An overlay, never an
  edit to a read-only catalog row.
- **@-mentioning holidays.** Not free (the `mentions` table references entity UUIDs; holiday
  identity is slug-based) and not a priority. The better shape for the underlying idea is
  natural-language date detection — "on Christmas" fills the due date.
- **Events** — user-defined, separate-but-related to Milestones and Holidays. Much further out.
  The distinction that motivates it: *"my family does a thing on August 3rd"* (an Event) vs.
  *"my family observes an obscure holiday on August 3rd"* (a user-defined Holiday).
