# Reminders — active windows, buckets, and the rule cascade

> **Delete this doc when the work lands.** The durable *why* goes into
> [`@leapsake/reminders`](../packages/reminders/README.md) beside the onboarding-nudge reasoning
> that already lives there, and into the doc-comments on the code each increment touches. This
> file exists only for what is not built yet.

## The problem

Every "Wish @A a happy birthday" reminder in the next four weeks is on Home, all month, for
everyone. One constant causes it: `LEAD_DAYS = 30` in `packages/reminders/src/engine.ts`, which
gives **every** rule the same 30-day run-up before its own due date. That was right when the
engine only made birthday reminders; per-action `offsetDays` made it wrong and nobody removed it.

The fix is not just a smaller number. A phone call takes minutes and cannot be done early; buying,
wrapping and posting a gift takes weeks and must be started early. **How long something sits on
your list is a property of the action**, and the engine has no word for it.

## The model

Six decisions, settled in design *(owner, 2026-09-02)*. Everything below implements them; none of
them is open.

1. **Two numbers per rule.** `offsetDays` — when it is **due**, measured back from the occurrence
   (already exists). `activeDays` — how many days **before that** it goes on display (new). A
   `wish` is `offset 0, active 0`: it appears on the day. A `get:gift` is `offset 12, active 30`:
   it appears six weeks before the birthday and is due twelve days before it.
2. **Identity is `verb:qualifier`, and it never moves.** The reminder id is
   `milestone:<id>:<year>:<action>`, so the action string is what keeps two reminders for one
   birthday distinct. A closed verb enum, an open qualifier (`get:card`, `message:discord`).
3. **Anything you would tick independently is its own reminder.** Text in the morning, call at
   night, and post on Instagram are three rows and three checkboxes, never one row with three
   buttons.
4. **Copy and affordances are derived at render, never stored.** Adding a phone number rewords an
   existing reminder; it must never mint a new one or resurrect a completed one.
5. **The screen is owed / available / coming**, and only *owed* gates "done for the day".
   *Owed* has two missed states, and they are different: **past due** (deadline blown, the event
   is still ahead, still salvageable) and **belated** (the event itself has passed).
6. **Rules resolve through a four-level cascade**, per action, most specific winning.
7. **The shipped birthday default is `wish` + `get:card` + `send:card`** — three rows, not one.
   Leapsake is meant to encourage tactile engagement with the world *(owner, 2026-09-02)*, so a
   card is on by default and turned **off** by users who don't want it, not on by users who do.

   This is only safe because of decision 5, and the arithmetic is worth keeping. For someone with
   40 birthdays a year, the standing load is `40 × activeDays ÷ 365` per action — about **3.3**
   `get:card`, **1.5** `send:card` and **0.1** `wish` on screen at any moment. Five-ish items,
   and they sit in *Available*, so they never block being done for the day. Under the flat
   30-day window this default would have been the wall this workstream exists to remove; under
   the bucketing it is a quiet standing list. **If the buckets are ever collapsed back into one
   list, this default has to be revisited with them.**

**Existing data is disposable** *(owner, 2026-09-02)* — pre-release, no real users. Where an
increment changes reminder identity, drop `source = 'system'` rows outright rather than migrating.
This matters more than it looks: system reminder ids are keyed on the occurrence **year**, and
`reconcile` never resurrects a tombstone (`engine.ts`, the resurrection guard), so a pruned row
would otherwise stay dead for the rest of the year. Sweep the table, don't reason about it.

---

## Increment 1 — the two numbers, and belated

**This alone fixes the complaint that started the workstream.** No UI work. The list gets shorter
and correct; everything after this is about making it *good*.

- Add `activeDays` to `ReminderActionDef` in `packages/schema/src/reminder-rule.ts`, beside
  `label`/`icon`/`template`. It belongs on the **action**, not on the kind's default schedule,
  because it describes how long the errand takes — a gift is a project whatever the occasion.
  `offsetDays` stays per-kind in `defaultReminderSchedule`, because *when it is due* genuinely
  varies by occasion.
- Rewrite `isWithinWindow` in `packages/reminders/src/engine.ts`. It currently takes a single
  `windowDays` for every rule; it now takes the action's `activeDays` and a grace period:

  ```
  daysUntilDue = daysUntilOccurrence - offsetDays
  alive  =  daysUntilDue <= activeDays  &&  daysUntilOccurrence >= -BELATED_DAYS
  ```

  Those two clauses also separate the two ways a reminder can be missed, at no extra cost — see
  the table below. Nothing needs to store which state a row is in; both are read off the same
  arithmetic the aliveness test already does.

  Note the second clause is the **occurrence**, not the due date. That is deliberate: an unbought
  gift due twelve days before a birthday should stay on your list right up to the birthday, not
  vanish when its own deadline slips. Day-of actions get the same clause and it gives them their
  belated window for free.
- `BELATED_DAYS = 2` as a module constant. Today the guard is `daysUntilOccurrence >= 0`, so a
  missed birthday **disappears the next morning** — you never learn you missed it. One dial for
  now; per-action belated windows are a plausible later refinement and explicitly not this
  increment.
- **Two missed states, and they are not the same thing** *(owner, 2026-09-02)*:

  | state | test | means | example |
  |---|---|---|---|
  | **past due** | `daysUntilDue < 0`, occurrence still ahead | deadline blown, **still salvageable** | the card missed its post date, but the birthday is Tuesday — pay for express |
  | **belated** | `daysUntilOccurrence < 0` | the event has passed; only acknowledgment is left | you missed the birthday yesterday |

  It falls out per action with no configuration. `wish` is `offset 0`, so its due date *is* the
  occurrence — it can never be past due and goes straight to belated. `send:card` at `offset 7`
  is past due for up to a week first. **`BELATED_DAYS` bounds only the belated tail**; past due
  needs no dial because the occurrence bounds it.
- Delete `LEAD_DAYS`. Two call sites follow it: `regenerateSystemReminders` and
  `listSystemReminderTargets` pass it as the window, and `packages/core/src/holidays.ts` derives
  `const horizon = LEAD_DAYS + maxOffset` for candidate generation. That horizon becomes
  `maxActiveDays + maxOffset` — same reasoning, and it must stay an over-estimate.
- `NOTIFICATION_WINDOW_DAYS = 365` is **untouched**. It answers a different question and the
  engine's doc-comment says why. Do not conflate them.

Starting defaults, from the owner's own estimates — expect to correct them against real use, the
way the onboarding snooze dials already say they expect to be corrected:

| action | `offsetDays` | `activeDays` |
|---|---|---|
| `get:card`, `get:gift` | 12 | 30 |
| `send:card`, `send:gift` | 7 | 14 |
| `visit` | 0 | 7 |
| `wish`, `call:*`, `message:*`, `post:*` | 0 | 0 |
| `remember` | 0 | 0 |

**Enabled by default for a birthday: `wish`, `get:card`, `send:card`.** Everything else is
opt-in. See decision 7 — the card is deliberate, not an oversight.

**Done when** a birthday a fortnight out puts nothing new on Home, a birthday today puts its wish
row there, yesterday's birthday still shows as belated, a card whose post date slipped still shows
as past due, and a birthday six weeks out surfaces its `get:card`.

## Increment 2 — owed / available / coming

The screen. Both clients.

The split is by **due date**, with activity deciding only whether something is on the main screen
at all:

- **Past due** — deadline missed, occurrence still ahead. Still salvageable, so acting now has the
  most value of anything on the screen; that is the argument for putting it first.
- **Belated** — the occurrence has passed. Prominent, but below past due, because nothing can be
  recovered here — only acknowledged. (Order is a design call at build time; this is the
  reasoning, not a mandate.)
- **Today** — `daysUntilDue === 0`.
- **Available** — active and on display, but due later. A month-long gift lives here the whole
  time. It is *visible*, it is *tickable*, and it does **not** count against being done today.
- **Coming** — not yet active. Behind an expander, grouped by when it will land.

⚠️ **Past due + Belated + Today is what "done for the day" measures.** This is the whole point of separating
them: a gift project that sits on screen for a month must never make the day unfinishable. The
user should be able to clear the top of the screen and feel finished while the gift sits below as
an opportunity rather than an accusation.

Expose the counts so the UI can say what kind of done was reached — *everything due today* (past
due + belated + today clear) and *everything I could possibly do* (those plus Available clear). The
owner wants both readings available; which one the UI celebrates is a design call at build time.

- The split belongs in `packages/view-models/src/reminders.ts` beside `partitionReminders`, which
  already owns exactly this kind of decision and documents *why* display-level is the only place
  a temporary hide can live. Extend or replace it; do not put the logic in either client.
- **Coming** needs rows that do not exist yet. Do not write a second walk — `listNotifiableReminders`
  in the engine already synthesizes future rows over an arbitrary window, respects tombstones, and
  returns the real row when there is one. Call it with a small window instead of 365. The engine's
  own comment explains why a parallel implementation would silently drift.
- It must return each row's **activation date** (`activeFrom`, epoch ms) alongside the row, since
  the client buckets *coming* items by when they will land and cannot derive that from a bare
  `Reminder` — the action is not a column.
- **Do not gate the checkbox on activity.** Everything can be done early; the active window exists
  only to decide when the app *prompts* you. Ticking a not-yet-materialized row has to create the
  real row at that moment.
- Horizon: 30 days for now, but read it from one constant. The owner expects to expand it, and
  possibly to grade it (this week → this month → beyond).

Desktop already has the `<details>` idiom for Completed in `ReminderList.tsx`; mobile's Home
(`apps/mobile/app/(tabs)/index.tsx`) is a single `FlatList` and needs section headers with
tap-to-expand. Keep the mobile row a single large tap target — the file's doc-comment explains why
the row is one link and not several small ones, and that reasoning still holds.

**Done when** a user with a month of birthdays sees a short Today, can clear it, and can expand to
find what is coming without any of it having nagged them.

## Increment 3 — `verb:qualifier` identity

Mostly invisible, and everything after it depends on it.

⚠️ **There is a live bug here today.** The desired set is keyed by derived id
(`engine.ts`, "keyed by (deterministic) id so duplicate identities collapse"), and the id is keyed
on `action` — so **two rules with the same action silently collapse into one reminder**. Nothing
prevents creating them: there is no unique constraint on `reminder_rules` and
`resolveReminderSchedule` passes rules straight through. Two `get` rules at different offsets is
exactly what the gift-then-post chain needs, so this must be fixed before that can exist.

- Split the flat `reminderActionSchema` into a **verb** (small, closed, Zod-validated) and an
  open **qualifier**. Verbs: `get`, `send`, `visit`, `call`, `message`, `post`, `wish`,
  `remember`, `other`. Qualifiers are `card`/`gift`, or a platform id from
  `packages/contact-links`' registry, or absent.
- The stored action string is `verb:qualifier` (or bare `verb`). The DB column is already free
  text — the `reminderActionSchema` comment says adding an action is "one enum line plus an
  `actionDefs` entry, never a migration" — so this needs no schema migration.
- Safe on ids: nothing ever **parses** a reminder id. `onboardingStepOf` and
  `duplicatesReminderId` recompute and compare. An extra colon-delimited segment costs nothing.
- `actionDefs` becomes keyed by verb, with the qualifier feeding the copy template. Templates
  already take a `ReminderCopyContext` (`{ subject, greeting }`); widen it rather than adding a
  parallel mechanism, and keep the `greeting` doc-comment's warning about positional arguments in
  mind.
- Reject duplicate `verb:qualifier` rules on the same bearer at the input schema, so the collapse
  cannot recur by a different route.

**Done when** `get:card` and `get:gift` on one birthday produce two independent reminders at two
different due dates.

## Increment 4 — `wish` adapts, and collects

The reminder learns *how* to reach someone, without ever changing which reminder it is.

`wish` is the **fallback for the unconfigured case**, not an umbrella over channels:

| the person has | copy | affordances |
|---|---|---|
| no contact methods | "Wish A a happy birthday" | *Add a way to reach A* |
| exactly one | "Text A happy birthday" | Text |
| several | "Wish A a happy birthday" | every method they have |
| a **preferred** one | names that one | that one, leading |

The same derivation carries the **belated** wording — "Wish A a happy *belated* birthday" once the
occurrence has passed. It is keyed on the row's own dates, so it needs no new input, and it is one
more reason the copy must not be stored.

⚠️ **The contact method must never touch identity.** If adding a phone number changed the id from
`wish` to `message:sms`, the old row would be tombstoned (permanently — the resurrection guard),
and a birthday the user had already ticked would come back **unticked** under a new id. Copy is
derived; the row is `wish` throughout. There is precedent in the engine: `isSelf` already flips
"Wish @You a happy birthday" to "It's your birthday!" — same reminder, different words, keyed on a
fact about the bearer.

- **Derive at read, do not store.** Storing the channel in the title makes every contact-method
  edit rewrite reminder rows and bump `updated_at`; `reconcile` is deliberately a no-op in steady
  state and should stay one. Follow the pattern `ReminderWithTags` already uses, where tags and
  mentions are resolved on read.
- **Notifications must not go stale** *(owner)*. Do the derivation in **one shared place** and
  have `listNotifiableReminders` return rows already carrying the derived copy — the planner's
  `planEach`/`planDigest` render from the row, so they then need no changes and cannot disagree
  with the screen. Then widen the reconcile-and-replan trigger from milestone writes to include
  **contact-method and rule writes**, so a setting change updates the scheduled notification in
  the same operation.
- **`wish` is suppressed whenever any specific day-of action is enabled** — and *only* by a
  day-of one. `get:card` and `send:card` are shipped defaults (decision 7) with their own due
  dates days or weeks earlier; they are not acknowledgments and must **not** suppress the wish.
  Read the rule as "a specific way of saying happy birthday on the day", not "any other enabled
  action". Suppression is derived, never written as `wish: enabled=false`. It means "some acknowledgment, unspecified", so it is definitionally
  redundant once a specific one exists. Deriving the suppression cannot drift; a written disable
  can, and its failure mode is leaving the user with **zero** birthday reminders after they turn
  their chosen channels back off.
- The **collect** prompt is a CTA, and `reminderCtaOf` in `packages/view-models/src/reminders.ts`
  is the existing seam — add a `contact` kind beside `onboarding`/`duplicates`/`gift` and let each
  client map it to its own route, as they already do. It lives on the reminder **detail** screen,
  not the list row.
- ⚠️ *A nudge, never a wall* — the reminders README's own rule. Completing the birthday must never
  require adding a contact method first.
- **Preferred** is a property of the contact method, not of a reminder rule. Keeping it there is
  what stops "preferred" having to be restated at every cascade level.

**Done when** the owner's walkthrough passes end to end: a bare person shows the generic wish and
the collect prompt; adding a number rewords the *same* row; marking a Discord handle preferred
rewords it again and repoints the buttons; and a completed reminder stays completed throughout.

## Increment 5 — the cascade, and provenance

Four levels, most specific winning:

```
person + occasion     "Alice's birthday specifically"
person                "Alice, always"
occasion kind         "all birthdays"
shipped default       `wish` + `get:card` + `send:card`
```

- **Resolution is per `verb:qualifier`, not per level.** Today it is all-or-nothing —
  `resolveReminderSchedule` uses stored rules *instead of* kind defaults the moment one row
  exists. With four levels that would mean setting a person default silently wipes the birthday
  defaults. Each action must resolve independently up the chain.
- **`enabled: false` is how a specific level says "not this one."** The mechanism already exists:
  the engine mints only enabled rules and `resolveSchedule`'s doc-comment says disabled entries
  are returned but ignored. No new concept needed.
- Adding `person` (and `pet`) to `reminderRuleBearerTypeSchema` is a Zod-only change — the type's
  own comment says so.
- ⚠️ **The kind level does not fit the existing shape, and this is the one place it doesn't.**
  `bearerId` is `z.uuid()`, and "birthday" is not a UUID — it is a code constant, not a row.
  Three of the four levels are fine (a person, a milestone and a holiday are all real rows with
  real ids); only milestone *kinds* are not. **Decision: relax `bearerId` to accept a short
  keyword** *(owner, 2026-09-02)* — `bearer_type: "kind"`, `bearer_id: "birthday"`. The DB column
  is already free text, so it is a validation change only. No collision risk: a UUID's shape
  cannot be imitated by a keyword. Rejected: promoting kinds to rows (a migration, and it drags in
  "can users invent kinds?", which is out of scope), and a separate settings store (splits one
  concept across two shapes and makes the resolver read both).

**Provenance is product surface, not a debug aid.** The owner wants the winning level visible on
the reminder screen, the person+milestone screen, the person+holiday screen, the milestone screen,
the holiday screen, and probably Settings. So the resolver returns **what every level said**, not
just the winner, letting one shared component render both halves everywhere:

> Message A happy birthday — *inherited from A's defaults* · Override for this birthday

Build this into the return shape from the start. Retrofitting provenance means threading it
through everything afterwards, and with four levels "why am I getting this reminder?" is a
question that will certainly be asked.

## Increment 6 — presets

Nobody should configure a chain by typing offsets. One human question — **am I going to see
them?** — picks a rule set:

- **Mailing it:** `get` long out, `send` medium out, `wish` day-of.
- **Seeing them:** `get` medium out, `visit` day-of, `wish` day-of.

- ⚠️ **Do not model rule dependencies.** "`get` is due 3–7 days before `send`'s due date" is real
  when you *choose* the numbers and must not survive into the data — literal dependencies need
  ordering, cycle detection, and an answer for what happens when the depended-on rule is disabled,
  all to express something set once. Do the arithmetic in the preset and store plain offsets.
  "Where in the world is it going" is a preset *input*, not a runtime lookup.
- A preset is a starting point that writes ordinary rules, exactly as kind defaults are today. It
  is not a stored mode, and there is no "which preset is this" column to drift from the rules.
- Mailed-vs-in-person is naturally a **person-level** default — someone who lives far away gets
  posted gifts at Christmas as well as their birthday — inherited down and overridable per
  occasion. Increment 5 gives it that home.

## Not in scope

- **Contact-method priorities and per-occasion preferred methods.** Until they exist, several
  methods means show them all — the no-guess option, and the one that needs no unwinding when
  priorities land. The one-method case is not special-cased; it is the same rule with one button.
- **The cascade's editing UI.** Four levels × N actions × per-person is a large settings surface
  and the owner wants it designed against the stronger onboarding flow, which is later work.
  Nothing above depends on it: increments 1–4 need no new settings screen at all.
- **Per-action grace periods**, **snooze for user reminders** (the open question flagged in
  `partitionReminders`' doc-comment), and **user-defined milestone kinds**.
