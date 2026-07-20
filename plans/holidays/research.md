# Leapsake Holidays — research & decisions (pre-plan)

> **Research doc, not a plan and not a status board.** It records the architectural
> decisions, rejected alternatives, and known edge cases worked out in design discussion
> **before** implementation. The feature is now **built on desktop** and these decisions held —
> where the build refined one, the section says so inline (see §2.4 on observance ids). Sequencing
> and live status belong in [`status.md`](../status.md); the reminder surface these hang off is
> [`reminders.md`](../reminders.md); the product posture is
> [`product-truths.md`](../product-truths.md).

Holidays extend the automated-reminder engine (`@leapsake/reminders`) to a second family of
recurring, dated facts about people: *30 days before Christmas, "Get @Alice a gift"; on
Easter, "Call @Grandma"*. The groundwork was laid deliberately — `reminderRuleBearerTypeSchema`
(`packages/schema/src/reminder-rule.ts:98`) already documents a second bearer joining without
schema change, and the engine speaks only to injected ports (`packages/reminders/src/engine.ts:78`).

---

## 1. The three layers

The single most important framing: "Holidays" is **three** things, and conflating them is
where the design goes wrong.

| Layer | What it is | Ownership |
|---|---|---|
| **Catalog** | "Christmas, Dec 25, Christian, US-observed" | Public reference data; ships with the app, updated over time |
| **Observance** | "Grandma observes Hanukkah" | User data; syncable, sensitive |
| **Rule** | "gift, 30 days before" | Already exists — `reminder_rules` |

**An observance is milestone-shaped.** A milestone is (bearer, kind, date); an observance is
(bearer, holiday, date-derived-from-catalog). Both are "a recurring dated fact about a person
that reminder rules hang off." So the reminder rule's bearer is the **observance**, not the
holiday — which preserves the existing `(bearerType, bearerId)` pair and makes per-person
schedules fall out for free ("gift Alice 30 days before Christmas" but "just call Grandma
day-of").

Making the rule's bearer the *holiday* would need a third column for "which person," and a
parallel copy of the `resolveReminderSchedule` / deterministic-id machinery.

**Rejected: holidays as a `milestone` kind.** Tempting (zero engine work), but milestone kinds
are a closed enum while the catalog is open and growing, and holiday rows would pollute a
person's timeline with facts the user never authored. An observance is a sibling entity feeding
the same engine port — consistent with the "new domain logic → its own narrow package" direction.

---

## 2. Decisions (pinned)

### 2.1 Observance is first-class, with implicit/explicit resolution

Follows the **Relationships** precedent (`packages/schema/src/relationship.ts:616`): derived
edges have no stored row and are computed live; explicit edges are stored.

Divergence from that precedent: relationships need **two** tables (`relationships` +
`dismissals`) because the payloads are asymmetric — an explicit edge carries roles and notes, a
dismissal is about (pair, role). An observance is thin and symmetric, so it is **one table with
a polarity flag**:

- no row → the implicit answer stands (computed live from person attributes × catalog)
- `observes: true` → explicit assertion
- `observes: false` → explicit override of an implicit yes

One repo, one sync entity, one migration, and no possibility of contradictory rows across two
tables.

### 2.2 Never materialize a row that agrees with the implicit answer

If Grandma already implicitly observes Hanukkah and the user toggles it on, that is a **no-op**
— no row is written. Same principle as `resolveReminderSchedule`
(`packages/schema/src/milestone.ts:212`): a milestone with no stored rules rides its kind
defaults, and rows appear only on divergence. Keeps untouched data free of sync churn.

This also settles the inference-changed case: if the user later corrects Grandma's religion, an
explicit `true` row survives and keeps the observance — correct, because the user said so
directly. A redundant row would have made that indistinguishable from "the inference happened
to agree once."

### 2.3 Holidays are a **synced** table holding catalog and user rows

Reversed from an initial "local-only catalog" position. The reasoning that moved it:

- **User-defined holidays are user data** and must sync, so "the sync substrate holds only user
  data" is not a line that survives the requirement anyway.
- The LWW objection to syncing catalog rows **dissolves** under §2.5.
- Syncing gets the offline case properly: **only one device ever needs internet.** A laptop
  OTAs at a coffee shop, comes home, and an internet-less LAN relay carries the catalog to every
  other device. Stronger offline-first than per-device OTA.

Sync is opt-in per table (`packages/data/src/syncable.ts:179` — "a conscious 'yes, this table
may leave the device' step"), so this is a deliberate registration, not a default.

### 2.4 Catalog ids are deterministic UUIDs derived from stable slugs

The substrate requires `id: z.uuid()`, but catalog entries want stable human-readable identity.
Both, via a primitive already in use:

- **Catalog rows** — `id = deterministicUuid(HOLIDAY_NAMESPACE, slug)`, with `slug` its own
  column. Every device derives the same UUID from the same slug independently, so seeded rows
  converge *even without syncing*.
- **User rows** — random UUID, ordinary user data. **Refined in the build:** this holds for a
  user-defined *holiday*, but **observances and hides are deterministic too**, keyed on
  `(holiday, bearer)` and `(holiday)`. Both tables carry a partial unique index on that key, so
  random ids would let two offline devices assert the same fact as two rows that then collide on
  the index the moment they sync. Deriving the id from the key makes them one row that LWW
  merges — the same reason `mentions` is content-addressed.
- `origin: "catalog" | "user"` drives what is editable.

Observances then point at a single `holidayId` with **no polymorphism and no source
discriminator** — which is what makes "no broken observances" hold for user-defined holidays too.
Same convention as `SYSTEM_REMINDER_NAMESPACE` (`packages/reminders/src/engine.ts:37`).

### 2.5 Catalog rows carry the catalog release's **authored** timestamp

Not local write time. This makes ordinary whole-row LWW correct by construction:

- every device seeding catalog v3 writes byte-identical rows with identical timestamps → merges
  are no-ops
- a device that OTAs v4 has strictly later timestamps → v4 propagates and wins everywhere
- a device that seeds v3 *after* receiving v4 → v3 loses → no regression, no flapping

Without this, an older device's seed stamps `now`, beats a newer OTA payload, and silently
reverts it. With it, no bespoke merge path is needed.

### 2.6 Catalog rows are read-only; **hide + create** composes to fork

Editing a catalog holiday (name, date, rule, greeting) is **prohibited**. Users get two
independent primitives instead:

- **hide** — suppress a catalog holiday entirely
- **create** — author their own

Composed, they give "customize Mother's Day" with **no fork mechanism, no copy-on-write, no
lineage tracking**. Read-only also kills the OTA conflict entirely: a user edit can never lose
to, or permanently block, a catalog update.

Hide wants its own thin table (same negative-assertion shape as `dismissals` and
`not_a_duplicate`) — a column on the holiday row would be an edit to a catalog row and would
fight OTA. Two behaviors:

- **Hide suppresses reminders, not just browse surfaces.** Otherwise "I hid Mother's Day" still
  produces "Call @Alice for Mother's Day." Cleanest as a final filter after observance
  resolution. Mother's Day is precisely the holiday people hide for painful reasons, so this is
  worse than a normal bug when wrong.
- **Hide is non-destructive.** Suppress, never delete observances; unhiding restores everything.

Scope note: "read-only" applies to the *holiday*. The observances and reminder rules hanging off
it stay fully editable — they live on the observance, not the holiday.

### 2.7 Fully-qualified slugs from day one — no `supersededBy`

Real-world holidays change less than they appear to. Juneteenth becoming federal was an
*addition*. Rule changes (Memorial Day → last Monday, 1968) edit a stable slug, and a
forward-looking reminders app does not care about historical accuracy. Columbus Day →
Indigenous Peoples' Day is two entries observed differently by different states — a family, not
a succession.

The one likely case is **the catalog getting more specific**: shipping `easter`, then needing
Orthodox; shipping `thanksgiving`, then adding Canada. The fix is a naming discipline, not a
mechanism — name entries `us-thanksgiving`, `western-easter`, `us-mothers-day` **while the US is
the only country in the catalog**. Expansion is then pure addition. If succession is ever
genuinely needed, a read-time alias map (old slug → new slug) is a smaller retrofit than a
schema field.

### 2.8 Recurrence: hybrid rules + precomputed tables, behind one interface

`nextOccurrence` (`packages/schema/src/reminder-schedule.ts:155`) today handles only fixed
(month, day) annual and one-time. Holidays need:

| Shape | Example | Computable? |
|---|---|---|
| Fixed date | Dec 25 | trivially |
| Nth weekday of month | 4th Thu of Nov; last Mon of May | trivially |
| Computed | Easter (computus) | exactly |
| Offset from another holiday | Good Friday = Easter − 2 | exactly; needs a dependency edge |
| Every-N-years | Leap Day | trivially |
| **Lunar / lunisolar** | Ramadan, Diwali, Lunar New Year, Yom Kippur | **not by arithmetic rule** |

Islamic dates depend on moon *sighting* and legitimately differ by country and authority; Hebrew
and Chinese calendars are algorithmic but heavy.

**Decision:** one interface — `occurrencesFor(holidayId, year) → CivilDate[]` — backed by rules
where rules are exact and by a **precomputed date table** (~30-year horizon) where they are not.
Cheap, auditable, no calendar library in the bundle, and it degrades honestly: past the horizon a
holiday stops producing occurrences rather than producing wrong ones. Callers never know which
mechanism answered.

### 2.9 The escape hatch cannot cover the hard gaps — catalog breadth is load-bearing

User-defined holidays are expected to matter for **<1% of users**; the goal is inclusivity for
niche observances, not a substitute for coverage. Critically, a user-defined holiday can
realistically only express **simple recurrence** (fixed date, maybe nth-weekday). Nobody will
hand-author Diwali, Eid, or Lunar New Year — those need lunar tables they cannot compute or
maintain forward.

So the escape hatch covers exactly the holidays that are easy to add to the catalog, and is
structurally incapable of covering the hard ones. Starting US-centric is fine; **deferring the
lunar/lunisolar work on the theory that users will fill gaps themselves is not.** Get at least
one lunar holiday into the catalog early so the precomputed-occurrence path is proven end-to-end
and the recurrence engine does not ossify around arithmetic rules.

### 2.10 OTA fetches the whole catalog, unconditionally

A network request from a local-first, zero-knowledge app needs a rule: **fetch the entire
catalog; never a query.** No locale parameter, no "which holidays do I need." The request then
reveals only "a Leapsake install checked in," and nothing about who the user knows or what they
observe. A later performance optimization into a filtered request would turn it into a
disclosure — hence writing it down as a constraint rather than an implementation detail.

Bundled-first remains the floor: a strong default catalog ships in-app and works with no network
ever. OTA is an enhancement, and new app releases are the minimum viable update channel.

### 2.11 The dismissal ladder is already closed

Three levels, no new machinery, each mapping to a UI location the user would naturally go to:

| Intent | Mechanism | Scope |
|---|---|---|
| "Not this year" | dismiss the reminder (tombstone) | one action, one occurrence |
| "Never gift Alice at Christmas, but still call" | reminder rule `enabled: false` | one action, forever |
| "Alice doesn't do Christmas" | observance `observes: false` | all actions, forever |

Dismissing on the Reminders screen must **not** suppress future years — and does not, because
the occurrence is part of the deterministic id. Editing or removing an observance from a Person
or Holiday screen persists for all future occurrences.

### 2.12 Explicit-first; religion/nationality are accelerators, not foundations

**Observance is the more honest primitive.** Religion is a lossy proxy — converts,
cultural-but-not-practicing, mixed families, people who do Christmas with in-laws and Hanukkah at
home. That "Religions" wants to be plural is the symptom: the field is standing in for something
more granular, and that something is the observance.

So religion is a **bulk-assignment accelerator** layered on top, not a foundation underneath —
purely additive when it arrives, and not a prerequisite. Same for Nationalities (explicitly set,
or implicitly derived from mailing addresses), plus a Settings **default country** for people
with no address.

Note that no reliable implicit source exists today: religion is not recorded, and country lives
on *contact methods* (`packages/schema/src/countries.ts`), not on the Person. So v1 ships the
resolver seam with the implicit side returning `[]` — uniform, not conditional on a feature that
does not exist.

Two constraints on inference:
- **Never infer religion from country, or country from religion.** Frequently wrong, and badly
  wrong when it is.
- A catalog flag (`impliedByLocale`, per (holiday, country)) marks the holidays it is safe to
  imply from locale — Thanksgiving, Mother's Day, Valentine's, New Year's, and Christmas-as-
  secular-gift-occasion in the US — versus those requiring an explicit signal. This gives a
  *safe* implicit source from the **user's own** locale without asserting anything about a third
  party's religion.
- When derived-nationality feeds derived-observance, keep it a **single flattening pass**, not
  inference feeding inference. The UI must be able to answer "why does Leapsake think Grandma
  observes this?"

**The cost of explicit-first:** with no implicit source, **bulk assignment is mandatory in the
first increment**, not a follow-up. "Christmas — who do you celebrate with?" with select-all has
to ship, or the feature has no on-ramp and dies of data entry.

> **Amended 2026-07-20.** The *concern* stands; the *control* does not. Select-all shipped and was
> then judged too cumbersome to scan and scroll. It was replaced by an autocomplete that stays
> open across repeated picks — cheaper for the common one-person case, and still workable in
> bulk. If data entry does prove to be the thing that kills adoption, the fix is an additional
> bulk affordance (e.g. "add everyone tagged #family"), not a return to the checklist.

### 2.13 Relating catalog entries — three distinct edges

Do not conflate:

1. **Family** — `us-mothers-day` and `uk-mothering-sunday` are the same idea, different rules.
   A `familyId` slug, for display and picker dedup. *Grouping.*
2. **Derivation** — Good Friday = Easter − 2. A computation dependency; directed, must be
   acyclic. *Graph.*
3. ~~Succession~~ — dropped, see §2.7.

Separate catalog entries per variant (not region-variant rules inside one entry) keeps each
entry's recurrence rule single-valued.

### 2.14 Reminder copy carries the occasion

`actionDefs.wish` is currently `` (name) => `Wish ${name} a happy birthday` ``
(`packages/schema/src/reminder-rule.ts:52`) — the occasion is baked into the template, already a
latent hack. Holidays break it: "Merry Christmas," "Happy Hanukkah," "Eid Mubarak" are not
interpolations of one pattern.

Put a `greeting` string on the catalog entry and generalize the template signature to take the
occasion alongside the subject. Small, but it touches the registry milestones share, so it should
be deliberate. Residual cost of read-only catalog rows: a British user wanting "Happy Christmas"
has no override short of hide-and-recreate; if that ever matters, a per-user greeting **overlay**
is the additive fix — an overlay, never an edit.

---

## 3. Invariants & edge cases

- **Unresolvable holiday → keep the row, generate nothing.** Never throw, never prune. Reachable
  even with a synced catalog: `pull` applies records one at a time across cursor-paginated
  batches with no cross-table transaction (`packages/data/src/sync-engine.ts:99`), so observances
  and holidays arrive interleaved. Also reachable via **rule-type skew** — a device whose *code*
  predates a recurrence type in its *data*. Data syncs; code does not. Ten lines; permanent value
  once there are real users.
- **Catalog removals need explicit tombstones in the OTA payload.** Absence cannot communicate
  removal — a device seeded at v3 keeps the row forever with nothing to tell it otherwise.
- **Seed by stored `catalogVersion`, not by row inspection.** Checking "do rows exist" makes a
  device that received the catalog via sync re-seed from a stale bundle, and resurrects holidays
  the user deleted.
- **Do not key occurrence identity on the year.** `occurrenceName`
  (`packages/reminders/src/engine.ts:142`) uses `occ.year` — safe for birthdays, wrong for lunar
  holidays. Ramadan occurred **twice** in Gregorian 1997. Key on the occurrence date
  (`YYYY-MM-DD`); strictly more robust, costs nothing.
- **Leap Day breaks the existing clamp.** `nextOccurrence` clamps Feb-29 → Feb-28 in non-leap
  years — correct for a birthday (you still want to be wished), wrong for a holiday that only
  exists every four years (it should skip). Clamp-vs-skip belongs on the recurrence rule, not as
  a global convention.
- **Multi-day holidays** (Hanukkah 8 days, Ramadan a month) anchor to the **start** date, with an
  optional `durationDays` for display. "Remind during" is a different feature.
- **Keep id namespaces disjoint** — `observance:<id>:<date>:<action>` vs
  `holiday:<slug>:<date>:<action>`. Already the convention separating onboarding from milestone
  reminders (`packages/reminders/src/engine.ts:210`). Costs nothing now, and keeps both the
  person-less-holiday-reminder door and the aggregate-reminder door open through one seam.
- **Watch the N+1.** The engine already resolves occurrences and filters by window *before*
  hydrating labels (`packages/reminders/src/engine.ts:301`). Holidays multiply the candidate set
  (people × holidays), so that ordering must hold.

---

## 4. Open questions

> **Four of these were settled when the feature was built (2026-07-20)** — marked **SETTLED**
> below, with what was chosen. The rest stand. Status and remaining work live in
> [`status.md`](../status.md), not here.

- **Synchronized load — punted, and safe to punt.** Birthdays spread across the year; holidays
  do not. Everyone's Christmas gift reminders come due at once, and with `LEAD_DAYS = 30` on top
  of a 30-day gift offset they would all surface in late October. Reversible: ids key on
  (occurrence, action), not surface date, so changing `isWithinWindow` later re-keys nothing and
  invalidates no tombstones. **The non-reversible variant is aggregate reminders** — collapsing
  "40 Christmas cards" into one row is a different id, and migrating later loses completion
  state. Hence the disjoint-namespace hedge above. Christmas cards are the known worst case.
- **SETTLED — Does an observance need payload beyond yes/no?** **No.** The thin single-table
  shape in §2.1 shipped: `(holidayId, bearerType, bearerId, observes)`. A note or per-person
  offset is a nullable column away if it ever proves necessary, and adding one later breaks
  neither LWW nor sync. One refinement the build forced: observance ids are **deterministic**
  (derived from the key), not random as §2.4 implies for user rows — the partial unique index
  means two offline devices asserting the same observance would otherwise mint two rows and
  collide on sync apply. Original question: A per-person note ("Alice does gifts on
  Christmas Eve"), or a date offset. If yes, that argues back toward the richer
  relationship-style shape and away from the thin single-table decision in §2.1 — so it should be
  settled before the schema hardens.
- **SETTLED — Awareness vs. action.** **Deferred.** v1 stays scoped to per-person reminders;
  `/holidays` gives a place to see the catalog without generating work. A Home-screen strip
  remains additive (§5 keeps the door open). Original question: It would
  fill the empty Home a new user sees (the gap [`reminders.md`](../reminders.md) calls out)
  without generating per-person work — but v1 is otherwise scoped to per-person reminders.
- **SETTLED — The on-ramp shape.** **Holiday-centric**, and it shipped that way. But the
  *control* was then reversed: the select-all checklist over the whole address book was judged too
  cumbersome, and was replaced by an **autocomplete** on the Holiday screen, with a mirrored one
  on the Person screen (decided 2026-07-20) — a field that stays open across repeated picks and
  excludes those already added. §2.12's warning that bulk assignment is mandatory is not refuted
  by that reversal, only outweighed for the common case; see the amendment there for what to do if
  data entry does prove to kill adoption. Original question: Is the
  primary flow holiday-centric ("Christmas — who do you celebrate with?"), person-centric, or a
  first-run pass over existing contacts?
- **SETTLED — v1 catalog breadth.** **15 entries covering every recurrence shape**: six fixed,
  five nth-weekday, Western Easter (computus), Good Friday (offset), and Hanukkah + Lunar New Year
  from precomputed tables — so no path in the §2.8 matrix is unexercised, and §2.9's insistence on
  an early lunisolar entry is honoured. ⚠️ Those two tables were authored from memory and are
  flagged provisional in `packages/holidays/src/catalog.ts`; they need sourcing and extending to
  the ~30-year horizon before ship. Original question: and it
  determines how much of the recurrence matrix must exist immediately (see §2.9 — at least one
  lunar entry).
- **Observed-date shifting** (holiday falls Saturday → observed Friday). Matters for "office
  closed," barely for gifting. Leaning skip; noted, not solved.

---

## 5. Deferred — doors deliberately left open

- **Holiday reminders with no Person attached** ("get a tree"). Per-person is v1; the bearer-type
  enum and disjoint id namespaces admit `holiday` later with no schema change.
- **User-defined holidays authoring UI.** The schema is capable from day one (§2.4); the surface
  can wait. Expected <1% of users.
- **Events** — user-defined, separate-but-related to Milestones and Holidays. Much further out.
  Note the distinction that motivates it: *"my family does a thing on August 3rd"* (an Event) vs.
  *"my family observes an obscure holiday on August 3rd"* (a user-defined Holiday).
- **Religions / Nationalities fields** — accelerators for bulk observance assignment (§2.12).
- **@-mentioning holidays.** Not a priority. The `mentions` table references entity UUIDs and
  holiday identity is slug-based, so it is not free. The better shape for the underlying idea is
  natural-language date detection ("on Christmas" → fill the due date) — an authoring shortcut,
  not an entity reference.
- **Per-user greeting overlay** (§2.14).
- **Aggregate / grouped reminders** (§4).

---

*Built in three stages (package → observance storage + authoring UI → engine wiring), all shipped
2026-07-20. Remaining work is sequenced in [`status.md`](../status.md).*
