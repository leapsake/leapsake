# `@leapsake/holidays` — the catalog and the recurrence engine

What this package owns, and — more usefully — **the decisions that constrain anyone changing
it.** The API surface is documented on the exports themselves (`src/index.ts`); this file is the
design behind them. Shipped on both clients 2026-07-20; what remains is sequenced in
[`plans/status.md`](../../plans/status.md).

## Holidays are three things, and conflating them is where the design goes wrong

| Layer          | What it is                                  | Where it lives                                                   |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| **Catalog**    | "Christmas, Dec 25, Christian, US-observed" | public reference data — this package, seeded into a synced table |
| **Observance** | "Grandma observes Hanukkah"                 | user data: syncable, sensitive                                   |
| **Rule**       | "gift, 30 days before"                      | `reminder_rules`, which already existed                          |

**An observance is milestone-shaped**: a milestone is (bearer, kind, date), an observance is
(bearer, holiday, date-derived-from-catalog). Both are "a recurring dated fact about a person
that reminder rules hang off." So a rule's bearer is the **observance**, never the holiday —
which preserves the existing `(bearerType, bearerId)` pair and makes per-person schedules fall
out for free ("gift Violet 30 days before Christmas" but "just call Grandma day-of"). Making the
holiday the bearer would need a third column for _which person_, plus a parallel copy of the
`resolveReminderSchedule` and deterministic-id machinery.

**Rejected: holidays as a `milestone` kind.** Tempting — zero engine work — but milestone kinds
are a closed enum while the catalog is open and growing, and holiday rows would pollute a
person's timeline with facts the user never authored.

## Identity: everything is deterministic except a user's own holiday

The sync substrate requires `id: z.uuid()`, but catalog entries want stable, human-readable
identity. Both, via `deterministicUuid`:

- **Catalog rows** — `id = deterministicUuid(HOLIDAY_NAMESPACE, slug)`, with `slug` its own
  column, so every device derives the same UUID independently and seeded rows converge **even
  without syncing**.
- **Observances and hides** — also deterministic, keyed on `(holiday, bearer)` and `(holiday)`.
  This is not symmetry for its own sake: both tables carry a partial unique index on that key, so
  random ids would let two offline devices assert the same fact as two rows that collide on the
  index the moment they sync. A derived id makes them one row that LWW merges — the same reason
  `mentions` is content-addressed.
- **User-defined holidays** — random UUID; ordinary user data. `origin: "catalog" | "user"`
  drives what is editable.

Observances point at a single `holidayId` with **no polymorphism and no source discriminator**,
which is what makes "no broken observances" hold for user-defined holidays too.

## Catalog rows carry the _authored_ timestamp, not local write time

This is what makes ordinary whole-row LWW correct by construction:

- every device seeding catalog v3 writes byte-identical rows with identical timestamps → merges
  are no-ops;
- a device that OTAs v4 has strictly later timestamps → v4 propagates and wins everywhere;
- a device that seeds v3 _after_ receiving v4 → v3 loses → no regression, no flapping.

Without it, an older device's seed stamps `now`, beats a newer payload, and silently reverts it.

## Catalog rows are read-only; **hide + create** composes to fork

Editing a catalog holiday (name, date, rule, greeting) is prohibited. Users get two independent
primitives — **hide** (suppress a catalog holiday) and **create** (author their own) — which
compose to "customize Mother's Day" with no fork mechanism, no copy-on-write, and no lineage
tracking. Read-only also kills the OTA conflict entirely: a user edit can never lose to, or
permanently block, a catalog update.

Hide is its own thin table (the negative-assertion shape `dismissals` and `not_a_duplicate`
already use) — a column on the holiday row would be an edit to a catalog row and would fight OTA.
Two behaviors that must not regress:

- **Hide suppresses reminders, not just browse surfaces.** Otherwise "I hid Mother's Day" still
  produces "Call @Violet for Mother's Day." Mother's Day is precisely the holiday people hide for
  painful reasons, so getting this wrong is worse than an ordinary bug.
- **Hide is non-destructive.** Suppress, never delete observances; unhiding restores everything.

"Read-only" applies to the _holiday_. Observances and reminder rules hanging off it stay fully
editable — they live on the observance.

## Slugs are fully qualified from day one; there is no `supersededBy`

Real-world holidays change less than they appear to: Juneteenth becoming federal was an
_addition_; a rule change (Memorial Day → last Monday, 1968) edits a stable slug and a
forward-looking reminders app does not care about historical accuracy; Columbus Day →
Indigenous Peoples' Day is two entries observed differently by different states — a family, not a
succession.

The one real case is **the catalog getting more specific** (ship `easter`, then need Orthodox).
The fix is naming discipline, not machinery: name entries `us-thanksgiving`, `western-easter`,
`us-mothers-day` **while the US is the only country in the catalog**, so expansion is pure
addition. If succession is ever genuinely needed, a read-time alias map is a smaller retrofit
than a schema field.

Two edges between catalog entries, not to be conflated: **family** (`us-mothers-day` and
`uk-mothering-sunday` — a `familyId` slug, for display and picker dedup) and **derivation**
(Good Friday = Easter − 2 — a directed, acyclic computation dependency). Keep one recurrence rule
per entry; variants are separate entries.

Three v1 slugs predate the rule being applied consistently — `christmas`, `hanukkah`,
`lunar-new-year`. **They cannot be renamed**: the slug *is* the identity a row's UUID derives
from, so a rename orphans every observance pointing at it. `orthodox-christmas` therefore sits
beside a bare `christmas`. Leave the asymmetry; it is cheaper than the migration that removes it.

## Classification is bundle-side, and the group key is derived

`region` and `tradition` on a catalog entry exist to **group the browse list**, and they stop at
the bundle — they are not columns on the synced `holidays` row. That cost no migration and adds
nothing to what every device stores and syncs; callers join them back on by slug through
`classificationFor`.

The group key is **derived, not authored**: `tradition === "secular" ? region : tradition`.
National days group as "United States" and "France", religious ones as "Jewish" and "Hindu" —
which is how someone picking holidays *for a particular person* reasons about them, rather than by
the calendar mechanism underneath. Two rules keep it honest:

- **Every religious holiday is `region: "global"`.** A tradition travels with its diaspora, so
  pinning Diwali to India would be wrong for everyone who keeps it elsewhere, and would bury it.
- **`tradition` is provenance, never an assertion about a person.** That Diwali is `hindu` says
  where the holiday comes from; who observes it is what `observances` is for. The inference
  constraints above still hold.

The trade is a narrow skew window: an entry arriving over sync from a **newer** bundle has no
classification on this build and groups under "Other" until the app updates. That is the same
degradation `parseRecurrence` already takes — data syncs, code does not — and it self-heals.
Promoting classification to a column later is strictly additive; nothing here forecloses it.

**Display names must stand alone.** Search returns a bare title and the browse list is flat, so a
name that is only unambiguous inside its group is the wrong name — hence "Canadian Thanksgiving".
A catalog test pins this.

## Recurrence: rules where they are exact, tables where they are not

One interface — `occurrencesFor(holidayId, year) → CivilDate[]` — backed by arithmetic rules for
fixed dates, nth-weekday, computus (Easter), offsets, and every-N-years; and by **precomputed
date tables** for lunar/lunisolar holidays, which no arithmetic rule can carry (Islamic dates
depend on moon _sighting_ and differ by country and authority; Hebrew and Chinese calendars are
algorithmic but heavy). Callers never learn which mechanism answered.

It **degrades honestly**: past the table horizon a holiday stops producing occurrences rather
than producing wrong ones. The **eight** tables — five Hebrew (Hanukkah, Rosh Hashanah, Yom Kippur,
Sukkot, Passover) and three Chinese (Lunar New Year, Dragon Boat, Mid-Autumn) — are each derived
from the source calendars' own rules and cross-checked against a second, independent
implementation; they run to **2056**. Extend them before ~2050 by **re-deriving, never
extrapolating** — see the note in `src/catalog.ts`.

The Hebrew set is *exact* (that calendar is arithmetic), and the implementation behind it
reproduces the originally-authored Hanukkah table entry for entry. The Chinese set rests on Meeus'
new-moon series in UTC+8, gated on reproducing all 30 Lunar New Year dates — including the two
borderline years where ICU alone disagrees, which is precisely why ICU is trusted for leap-month
*structure* and never for a boundary. Neither set rests on a single source, and neither should.

> **Why catalog breadth is load-bearing, and the escape hatch is not a substitute.** A
> user-defined holiday can realistically only express simple recurrence. Nobody will hand-author
> Diwali, Eid, or Lunar New Year — those need tables they cannot compute or maintain. So the
> escape hatch covers exactly the holidays that are easy to add to the catalog and is
> structurally incapable of covering the hard ones. Starting US-centric is fine; deferring the
> lunisolar work on the theory that users will fill the gaps is not.

## OTA: fetch the whole catalog, never a query

A network request from a local-first, zero-knowledge app needs a rule. **No locale parameter, no
"which holidays do I need."** The request then reveals only "a Leapsake install checked in," and
nothing about who the user knows or what they observe — a later "optimization" into a filtered
request would turn it into a disclosure, which is why this is written as a constraint rather than
an implementation detail. Bundled-first is the floor: a strong default catalog ships in-app and
works with no network ever; new app releases are the minimum viable update channel.

**Catalog removals need explicit tombstones in the payload.** Absence cannot communicate removal
— a device seeded at v3 keeps the row forever with nothing to tell it otherwise.

The table is **synced** (a deliberate registration, per `packages/data/src/syncable.ts`), which
also gets the offline case right: only one device ever needs internet. A laptop OTAs at a coffee
shop, comes home, and an internet-less LAN relay carries the catalog to every other device.

## Observance is explicit-first; religion and nationality are accelerators

Religion is a lossy proxy — converts, cultural-but-not-practicing, mixed families, people who do
Christmas with in-laws and Hanukkah at home. That "Religions" wants to be plural is the symptom:
the field is standing in for something more granular, and that something is the observance. So
religion is a **bulk-assignment accelerator** layered on top, never a foundation underneath.
Constraints for whenever that lands:

- **Never infer religion from country, or country from religion.** Frequently wrong, and badly
  wrong when it is.
- A catalog flag (`impliedByLocale`, per holiday × country) marks what is safe to imply from the
  **user's own** locale without asserting anything about a third party's religion.
- Keep derived-nationality → derived-observance a **single flattening pass**, not inference
  feeding inference: the UI must be able to answer "why does Leapsake think Grandma observes
  this?"

The cost of explicit-first is that **bulk assignment cannot be a follow-up** — without an
implicit source, a feature with no on-ramp dies of data entry. v1 shipped a select-all checklist,
judged it too cumbersome to scan and scroll, and replaced it with an autocomplete that stays open
across repeated picks. If data entry does prove to be what kills adoption, the fix is an
additional bulk affordance ("add everyone tagged #family"), not a return to the checklist.

## Invariants a change here must preserve

- **An unresolvable holiday keeps its row and generates nothing.** Never throw, never prune. It
  is reachable in normal operation: `pull` applies records one at a time across paginated batches
  with no cross-table transaction, so observances and holidays arrive interleaved — and by
  **rule-type skew**, a device whose _code_ predates a recurrence type in its _data_. Data syncs;
  code does not.
- **Seed by the stored catalog version, not by row inspection.** "Do rows exist" makes a device
  that received the catalog via sync re-seed from a stale bundle, and resurrects holidays the
  user deleted.
- **Do not key occurrence identity on the year.** Safe for birthdays, wrong for lunar holidays —
  Ramadan occurred **twice** in Gregorian 1997. Key on the occurrence date.
- **Leap Day is clamp-vs-skip, and it belongs on the rule.** `nextOccurrence` clamps Feb-29 →
  Feb-28, which is right for a birthday (you still want to be wished) and wrong for a holiday
  that only exists every four years.
- **Multi-day holidays anchor to the start date** (Hanukkah's 8 days, Ramadan's month), with an
  optional duration for display. "Remind during" is a different feature.
- **Keep id namespaces disjoint** — `observance:<id>:<date>:<action>` vs
  `holiday:<slug>:<date>:<action>`. Costs nothing now and keeps two doors open: person-less
  holiday reminders, and aggregate reminders.
- **Watch the N+1.** The engine resolves occurrences and filters by window _before_ hydrating
  labels; holidays multiply the candidate set (people × holidays), so that ordering must hold.
- **The dismissal ladder is closed, and each rung means something different**: dismissing a
  reminder is "not this year" (one occurrence, because the occurrence is part of the
  deterministic id); a disabled reminder rule is "never gift Violet at Christmas, but still call";
  `observes: false` is "Violet doesn't do Christmas".
