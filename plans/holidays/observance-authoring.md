# Holidays — observance authoring (design, not yet built)

> **Design doc, not a status board.** It records what the observance-authoring
> surfaces should become and why, plus the context an implementer needs to start
> cold. Live status belongs in [`status.md`](../status.md); the architecture these
> surfaces sit on is [`research.md`](./research.md); the reminder surface they
> feed is [`reminders.md`](../reminders.md).
>
> **Nothing in this doc is built.** The rest of Holidays *is* — see
> [`status.md`](../status.md) for what shipped.

---

## 1. What changes, and why

The shipped observer picker is a **select-all checklist over the entire address
book**: `/holidays/:id/observers` lists every person and pet with a toggle, plus
a "Select all" header, and saves the lot.

**Decided 2026-07-20: replace it with an autocomplete.** A checklist over
hundreds of contacts is cumbersome to scan, scroll, and re-scan — the cost falls
on *every* use, including the common one of adding a single person. Instead:

- **On a Holiday screen** — an autocomplete search field that finds a person and
  adds them as an observer.
- **On a Person screen** (the mirror, and new) — an autocomplete that finds a
  holiday and marks that the person observes it.

This also matches the repo's own documented control-choice rule
(`AGENTS.md` → *Form input controls*): a short, fully-known enum gets a
`SelectField`; a **long or possibly-unfamiliar list** — Country (183),
relationship Role (~40) — gets a typeahead. An address book is squarely the
second case, and so is a growing holiday catalog.

### 1.1 The tension this creates — read before implementing

`research.md` §2.12 is explicit that **bulk assignment is mandatory in the first
increment, not a follow-up**:

> With no implicit source, every observance starts explicit. "Christmas — who do
> you celebrate with?" with select-all has to ship, or the feature has no on-ramp
> and dies of data entry.

That reasoning has **not** been refuted — it has been outweighed for the common
case. An autocomplete costs one interaction per person, which is exactly the data
entry §2.12 warned about, and Christmas genuinely is a forty-person holiday for
some users.

**So do not simply ship a single-select field and call it done.** The
recommended shape keeps the on-ramp viable:

- The field **stays open and keeps accepting selections** after each pick
  (type → Enter → type → Enter), so adding ten people is ten keystrokes-plus-Enter
  rather than ten round trips through a modal. This is the standard token/chip
  input pattern.
- Already-added observers render as a **removable list directly beneath** the
  field, so add and remove live on one surface.
- Selected people are **excluded from subsequent suggestions**, so the list
  shrinks as you go and you can't double-add.

If bulk assignment still proves painful after this ships, the answer is an
*additional* bulk affordance (e.g. "add everyone with tag #family"), **not** a
return to the checklist. Record that outcome here if it happens.

---

## 2. The two surfaces

### 2.1 Holiday screen → add People

Replaces the `/holidays/:id/observers` checklist. Recommended placement is
**inline on the holiday detail screen**, under the existing "Observed by"
heading, so the separate `observers` route can be retired entirely:

```
Christmas
  Upcoming
    Fri, Dec 25, 2026
  Observed by
    [ Add someone…                    ]   ← autocomplete
    Alice Chen        Reminders ›  Remove
    Rose Fitz         Reminders ›  Remove
```

Each existing observer keeps its link to that observance's reminder schedule
(already built — see §3.2), because the reminder rule bears on the *observance*,
not the holiday.

### 2.2 Person screen → add Holidays

New, and the mirror of the above. A `HolidaysSection` on the Person (and Pet)
screen, alongside the existing Milestones / Tags / Relationships sections:

```
Holidays
  [ Add a holiday…                    ]   ← autocomplete over the catalog
  Christmas         Reminders ›  Remove
  Hanukkah          Reminders ›  Remove
```

Suggestions come from the holiday catalog. **Hidden holidays should be excluded
from suggestions** here (unlike the browse list, which shows them so they can be
unhidden) — offering a holiday that is suppressed from reminders would be
offering a no-op.

---

## 3. What already exists (start here)

### 3.1 Core API — no new writes needed

`packages/core/src/holidays.ts`, exposed on `CoreApi.holidays` and over IPC via
`apps/desktop/src/shared/api-channels.ts`:

| Method | Use |
|---|---|
| `list()` | The browse list (`HolidayListItem[]`) |
| `get(id)` | Detail (`HolidayDetail`, incl. `upcoming: string[]`) |
| `listObservers(holidayId)` | **Every** person and pet with `explicit` / `observes` flags |
| `setObservers(holidayId, decisions)` | Write observance answers |
| `setHidden(holidayId, hidden)` | Suppress / restore |
| `getObservanceSchedule(holidayId, bearerType, bearerId)` | That observance's rules |
| `setObservanceSchedule(holidayId, bearerType, bearerId, rules)` | Replace them |

**`setObservers` already supports incremental add/remove.** It iterates only the
decisions it is handed, so a single-element array is a perfectly good "add one"
or "remove one":

```ts
// add
await core.holidays.setObservers(holidayId, [
  { bearerType: "person", bearerId, observes: true },
]);
// remove
await core.holidays.setObservers(holidayId, [
  { bearerType: "person", bearerId, observes: false },
]);
```

No new write API is required. (`setObservers` writes a row only where the answer
*diverges* from the implicit one — research §2.2 — and every holidays write
reconciles the reminder engine immediately.)

### 3.2 What is missing

Two reads:

1. **`listObservers` returns the whole address book.** That is right for a
   checklist and wrong for an autocomplete, which wants to *query*. Either filter
   client-side (fine at current scale — it is one in-memory pass) or add a
   narrower core read. Prefer filtering first; only add API surface if a real
   list proves slow.
2. **There is no person-side read.** `ObservancesRepo.listForBearer(bearerType,
   bearerId)` exists in `packages/data/src/holidays-repo.ts` but nothing in core
   exposes it. §2.2's surface needs something like
   `core.holidays.listForBearer(bearerType, bearerId)` returning the holidays a
   person observes (with each holiday's name, next occurrence, and observance
   state) — plus a channel entry in `api-channels.ts`.

### 3.3 Autocomplete prior art to reuse

**Desktop** — there is no shared autocomplete component, and two different
existing approaches:

- `<datalist>`-backed inputs — `RelationshipForm.tsx`, `RelationshipFields.tsx`,
  `ContactMethodForm.tsx`. Cheapest, native, but styling and keyboard behaviour
  are browser-controlled and it cannot render rich rows.
- A hand-rolled **combobox + listbox** with full keyboard support and ARIA —
  `SearchBar.tsx` (`role="combobox"`, `aria-activedescendant`, ↑/↓/Enter/Escape)
  and `MentionTextField.tsx` (the `@`-mention picker). **Model the new field on
  these**, and consider extracting the shared combobox out of them rather than
  writing a third copy — that extraction is the main reason this is more than a
  trivial change on desktop.

**Mobile** — `apps/mobile/components/Typeahead.tsx` is exactly this control,
generic over the option type (`getKey`/`getLabel`/`renderOption`), with a
`minChars` floor of 2. It is currently single-select (`value: T | null`), so it
needs either a multi-select mode or a "pick one, append to a list, reset" wrapper.
`CountryField.tsx` and `RelationshipForm.tsx` are the existing callers to copy.

### 3.4 Files this touches

Replaced / retired:
- `apps/desktop/src/renderer/src/screens/HolidayObservers.tsx`
- `apps/mobile/app/holidays/[id]/observers/index.tsx`
- the `holidays/:id/observers` routes in
  `apps/desktop/src/renderer/src/router.tsx`

Modified:
- `apps/desktop/src/renderer/src/screens/HolidayView.tsx` (inline the field)
- `apps/mobile/app/holidays/[id]/index.tsx` (same)
- `apps/desktop/src/renderer/src/screens/PersonView.tsx` + a new
  `HolidaysSection.tsx` (mirroring `MilestonesSection.tsx`)
- `apps/mobile/app/people/[id]/index.tsx` + a mobile `HolidaysSection.tsx`
- `packages/core/src/holidays.ts` + `apps/desktop/src/shared/api-channels.ts`
  (the person-side read)

Kept as-is — the per-observance schedule editor is already built and unaffected:
- `apps/desktop/src/renderer/src/screens/HolidayObservanceSchedule.tsx`
- `apps/mobile/app/holidays/[id]/observers/[bearerType]/[bearerId].tsx`

Note the mobile schedule editor's route lives *under* `observers/`, so retiring
the mobile picker means deleting `observers/index.tsx` only, not the directory.

### 3.5 Tests to update

- `apps/desktop/test/integration/observances.test.ts` — exercises
  `setObservers` with whole-address-book decision arrays. The core semantics
  don't change, but add coverage for single-decision add/remove.
- No test currently covers the picker *UI* (there is no desktop component-test
  tier yet), so the integration tests are the safety net. Keep them at the core
  level rather than reaching for a UI harness that doesn't exist.

---

## 4. Other work already identified

Carried here so a fresh implementer has the whole picture. Sequencing lives in
[`status.md`](../status.md).

### 4.1 ⚠️ The lunisolar date tables are provisional — highest risk

`packages/holidays/src/catalog.ts` ships **Hanukkah** and **Lunar New Year** as
precomputed date tables that were **authored from memory by an LLM and are not
verified**. There is a warning comment in the module. Before this feature is
trusted by a real user:

- Verify every date against an authoritative source — Hebcal for Hanukkah, a
  published Chinese calendar (e.g. the Hong Kong Observatory) for Lunar New Year.
- Extend both from ~10 years to the **~30-year horizon** research §2.8 specifies.
- Bump `CATALOG_VERSION` (an integer — `sync_state` holds integers) or no device
  re-seeds, and update the hash in
  `packages/holidays/test/catalog.test.ts` → *"pins the exact bytes of the whole
  catalog"*.

A wrong date here is worse than a missing one: it produces a confidently-wrong
reminder on a day that matters to someone.

### 4.2 The mobile screens have never run on a device

The Holidays tab, detail, picker, and schedule editor are written, typechecked
and linted, but `pnpm test` does not exercise mobile UI and `pnpm test:native`
reports ⏳ BLOCKED without a booted emulator/simulator. Before trusting them:
`pnpm --filter @leapsake/mobile ios` (or `android`), then walk
Holidays → a holiday → observers → save → a schedule → save.

Since §2 replaces the picker anyway, doing that verification *after* the
autocomplete lands avoids verifying a screen twice.

### 4.3 Still-open questions from `research.md` §4

- **Synchronized load.** Birthdays spread across the year; holidays do not, so
  everyone's Christmas reminders come due at once. Mitigated for now by shipping
  observance reminder defaults **all off** (`observanceDefaultReminderSchedule`
  in `packages/schema/src/holiday.ts`), so volume is opt-in. Reversible: reminder
  ids key on (occurrence, action), not the surface date. The non-reversible
  variant is **aggregate reminders** — collapsing "40 Christmas cards" into one
  row is a different id, and migrating later loses completion state.
- **Observed-date shifting** (holiday falls Saturday → observed Friday). Noted,
  not solved; leaning skip.

### 4.4 Doors deliberately left open (`research.md` §5)

Unchanged and still deferred: holiday reminders with no person attached, a
user-defined-holiday authoring UI, Events, Religions/Nationalities as
bulk-assignment accelerators, `@`-mentioning holidays, a per-user greeting
overlay, and aggregate/grouped reminders.

The **implicit-observance resolver seam already exists** and returns `[]`
unconditionally — `implicitObservers()` in `packages/core/src/holidays.ts`. The
accelerator layer (§4.4) fills it in; two constraints bind whatever does: never
infer religion from country or country from religion, and keep
derived-nationality feeding derived-observance a *single flattening pass*, so the
UI can always answer "why does Leapsake think Grandma observes this?".

---

## 5. Invariants to preserve

Whatever the authoring UI becomes, these must hold — each is load-bearing and
each already has a test:

- **A row is written only where the answer diverges from the implicit one**
  (research §2.2). Adding an observer whose implicit answer is already "yes" is a
  no-op, not a redundant row.
- **Observance ids are deterministic**, derived from `(holidayId, bearerType,
  bearerId)`. Two offline devices asserting the same observance must converge on
  one row rather than colliding on the partial unique index.
- **An explicit `false` is an override, not an absence** — it means "does not
  observe" and must not be counted as an observer or generate reminders.
- **Hiding suppresses reminders, not just browse surfaces**, and never deletes
  observances.
- **Every holidays write reconciles the reminder engine** (`regenerateSystem()`
  in `packages/core/src/index.ts`), or a change appears to do nothing until the
  app restarts.
