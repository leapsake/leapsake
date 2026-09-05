# Reminders — the rule cascade, and presets

> **Delete this doc when the work lands.** The durable *why* goes into
> [`@leapsake/reminders`](../packages/reminders/README.md) beside the onboarding-nudge reasoning
> that already lives there, and into the doc-comments on the code each increment touches. This
> file exists only for what is not built yet.

## The problem

Every "Wish @A a happy birthday" reminder in the next four weeks was on Home, all month, for
everyone, because one constant gave every rule the same 30-day run-up before its own due date.
**That half is built**, and so is the screen that reads it — per-action `activeDays`, a belated
tail, `LEAD_DAYS` deleted, and Home split into owed / available / coming on both clients. The
reasoning now lives in [`@leapsake/reminders`](../packages/reminders/README.md) and
[`@leapsake/view-models`](../packages/view-models/README.md); what follows is what is still ahead
of it.

There was a second cause underneath that first one, which windows alone do not reach: the engine has
to decide what to remind you about before you have decided anything, so it **guesses**. **That half
is now built too** — an unconfigured occasion mints one `plan` prompt instead of errands, on both
clients, answerable in one tap. The reasoning lives in
[`@leapsake/reminders`](../packages/reminders/README.md) → *The prompt*.

Under both sat a third thing, invisible until you tried to schedule two errands of a kind: the
action string is a reminder's **identity**, and a flat one could not say "get" separately from
"what", so two `get` rules collapsed into one reminder. **That is now built too** — actions are
`verb:qualifier`, the closed half validated and the qualifier half open. The reasoning lives in
[`@leapsake/reminders`](../packages/reminders/README.md) → *Identity*.

## The model

Nine decisions, settled in design *(owner, 2026-09-02 and 2026-09-04)*. Everything below
implements them; none of them is open. Exactly one sub-question is deliberately deferred — how a
kind-level rule interacts with the prompt — and it is parked in Increment 6, where it lands.
Decisions 1, 2, 5 and 7 are **built**, and 3 has its mechanism; what landed differently from the
sketch is noted on each.

1. **Two numbers per rule** *(built)*. `offsetDays` — when it is **due**, measured back from the
   occurrence. `activeDays` — how many days **before that** it goes on display. A
   `wish` is `offset 0, active 0`: it appears on the day. A `get:gift` is `offset 12, active 30`:
   it appears six weeks before the birthday and is due twelve days before it.
2. **Identity is `verb:qualifier`, and it never moves** *(built)*. The reasoning now lives in
   [`@leapsake/reminders`](../packages/reminders/README.md) → *Identity*, and on
   `ReminderAction` / `actionKeyOf` in `@leapsake/schema`. ⚠️ One thing landed that this doc's
   sketch did not have: **`other` keys on its label**. Its action carries no information at all —
   the errand *is* the free text — so two custom rows were the collapse in its most reachable
   form, since the editor visibly invites a second one. The cost is that *renaming* an `other`
   re-keys its reminder; that is the intended reading, and the reason the derived cases (a contact
   method, `isSelf`) must stay out of the key.
3. **Anything you would tick independently is its own reminder.** Text in the morning, call at
   night, and post on Instagram are three rows and three checkboxes, never one row with three
   buttons. **The mechanism is built** — a qualifier makes each its own identity — but only for
   the actions the registry ships. Nothing yet lets a user *choose* a platform qualifier, so
   `post` is a declared verb with no `actionDefs` entry and `message` has only `sms`. See *Not in
   scope*: no increment below owns that picker.
4. **Copy and affordances are derived at render, never stored.** Adding a phone number rewords an
   existing reminder; it must never mint a new one or resurrect a completed one.
5. **The screen is owed / available / coming**, and only *owed* gates "done for the day"
   *(built)*. *Owed* has two missed states, and they are different: **past due** (deadline blown,
   the event is still ahead, still salvageable) and **belated** (the event itself has passed).
   Both now reach the screen, on `ReminderWindowFacts`; the split is `bucketReminders`. ⚠️ Note
   what landed differently from this doc's first sketch: **dateless rows are owed, not available**
   *(owner, 2026-09-04)*, so a standing onboarding nudge keeps the day unfinishable while it
   stands.
6. **Rules resolve through a four-level cascade**, per action, most specific winning.
7. **The engine never guesses. An unconfigured occasion gets a question, not errands**
   *(owner, 2026-09-04)* — **built**. The reasoning is now in
   [`@leapsake/reminders`](../packages/reminders/README.md) → *The prompt*. ⚠️ Three things
   landed differently from this doc's sketch, all found in the code:

   - **Snooze was not "already available to it".** `snoozePolicyOf` answers `null` for anything
     that is not an onboarding nudge, and without a branch of its own an ignored prompt would sit
     in `owed` for the six weeks between its due date and the birthday — a wall, not a nudge. It
     now takes the nudges' floor of two *not now*s, clamped to its own due date while that is
     still ahead.
   - **Deleting an occasion's rules does not restore the prompt within the same year.** Answering
     tombstones the row and the id is keyed on the occurrence year; undoing that needs a runtime
     hard delete, which no repo has and which a peer's tombstone would re-pull. Not built
     *(owner, 2026-09-04)* — the prompt returns next year.
   - **Only birthdays, weddings and anniversaries prompt.** `first-date` and `met` offer one
     action each, and a question with one answer is not a question. One `kindDefs` line each when
     that changes.

8. **The shipped birthday default stays `wish`, alone** — exactly what ships today
   (`kindDefs.birthday.defaultReminderSchedule`, all of
   `get:gift`/`get:card`/`send:card`/`call`/`message:sms` at `enabledByDefault: false`). ⚠️ **This supersedes the 2026-09-02 decision** to ship `get:card`
   and `send:card` enabled, and its standing-load arithmetic with it *(owner, 2026-09-04)*.

   The tactile-engagement argument that motivated that decision survives, relocated: the card is
   **offered prominently by the prompt** rather than minted for all forty people. That is a
   better home for it. A card row you must ignore forty times a year teaches you to ignore the
   list; a card *offered* at the moment you are thinking about Alice is a nudge you can take. In
   the prompt, `wish` is pre-ticked and everything else is offered unticked — the engine guesses
   nothing, and "unanswered" therefore needs no fallback rule of its own, because it already
   **is** the default schedule.

9. **An answer persists; only a changed offer set re-asks** *(owner, 2026-09-04)*. The persisting
   half is built: an answer writes the full offer set, rows-existing is the "answered" marker, so
   next year the rules simply apply. That stored set is also the record of *what was offered*.
   ⚠️ **The differ that compares it is not built** — see *Not in scope*; nothing re-asks on its
   own.

**Existing data is disposable** *(owner, 2026-09-02)* — pre-release, no real users. Where an
increment changes what the engine wants — a changed reminder identity, but equally a **narrowed
window** — drop `source = 'system'` rows outright rather than reasoning about them.

This matters more than it looks. `reconcile` retires a row it no longer wants by **soft-deleting**
it, and never resurrects a tombstone (`engine.ts`, the resurrection guard); ids are keyed on the
occurrence **year**, so a row pruned by an upgrade stays dead for the rest of the year — costing
the user a birthday on the very morning it mattered. Migrations 34 and 35 are the precedent and the
shape to copy: a plain `DELETE FROM reminders WHERE source = 'system'`, tombstones included, after
which the deterministic ids re-mint everything still wanted. Sweep the table, don't reason about it.

⚠️ **`reminder_rules` is the exception, and migration 35 is the precedent for that too.** Rules are
the user's own configured schedules, and since rows-existing is how the prompt knows an occasion has
been answered, dropping them un-answers every prompt anyone answered. Where a rule's *shape*
changes, rewrite the rows — and it is not optional, since `reminderRuleSchema` parses on every read
and a stale value fails the read outright.

---

## Increment 5 — `wish` adapts, and collects

The reminder learns *how* to reach someone, without ever changing which reminder it is.

`wish` is the **fallback for the unconfigured case**, not an umbrella over channels:

| the person has | copy | affordances |
|---|---|---|
| no contact methods | "Wish A a happy birthday" | *Add a way to reach A* |
| exactly one | "Text A happy birthday" | Text |
| several | "Wish A a happy birthday" | every method they have |
| a **preferred** one | names that one | that one, leading |

The same derivation carries the **belated** wording — "Wish A a happy *belated* birthday" once the
occurrence has passed. It needs no new input: the row already carries `occurrenceDate`, put there
for the screen's belated bucket, so the copy reads the same field the bucketing does and the two
cannot disagree. One more reason the copy must not be stored.

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
- **Notifications must not go stale** *(owner)*. Do the derivation in **one shared place**, which
  is now literally one: the screen and the planner both read `listRemindersInWindow` (the planner
  through the `listNotifiableReminders` wrapper), so copy attached there reaches both and they
  cannot disagree. The planner's `planEach`/`planDigest` render from the row and need no changes.
  Then widen the reconcile-and-replan trigger from milestone writes to include **contact-method
  and rule writes**, so a setting change updates the scheduled notification in the same
  operation.
- **`wish` is suppressed whenever any specific day-of action is enabled** — and *only* by a
  day-of one. A `get:card` or `send:card` the user ticked in the prompt has its own due date days
  or weeks earlier; those are not acknowledgments and must **not** suppress the wish.
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

## Increment 6 — the cascade, and provenance

Four levels, most specific winning:

```
person + occasion     "Alice's birthday specifically"   ← what the prompt writes
person                "Alice, always"
occasion kind         "all birthdays"
shipped default       `wish`
```

- **Resolution is per `verb:qualifier`, not per level.** Today it is all-or-nothing —
  `resolveReminderSchedule` uses stored rules *instead of* kind defaults the moment one row
  exists. With four levels that would mean setting a person default silently wipes the birthday
  defaults. Each action must resolve independently up the chain.
- ⚠️ **This changes the prompt's "answered" marker, and the change must be deliberate.** The
  shipped prompt relies on stored rows replacing the kind defaults wholesale. Under per-action resolution a
  partial row set falls *through* to the level above instead — but the prompt always writes the
  **full** offer set, disabled rows included, so both readings agree for anything it touched.
  Keep it that way: whatever answers a prompt must write the whole set, not just the ticks.
- ⚠️ **Open: does a kind-level rule seed the prompt, or suppress it?** *(deferred to this
  increment by the owner, 2026-09-04.)* Seeding — the prompt arrives with the user's own defaults
  pre-ticked, and they still confirm per person — keeps the contextual choice the prompt exists
  for. Suppressing spares the question from users who already answered it globally. The likely
  shape is seed-by-default plus a per-kind "don't ask me per person" switch, but it is not settled
  and nothing shipped depends on it.
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

## Increment 7 — presets

⚠️ **The shipped prompt absorbs most of this, and should be looked at first.** Presets exist
because "nobody should configure a chain by typing offsets" — and the prompt is a better answer to
that same problem, because it asks at the moment the answer is obvious rather than building a mode
to be configured in advance. What survives is the *question*, which is a strong candidate for a
second input on the prompt itself ("posting it" / "seeing them") rather than a separate surface.
The reasoning below stands either way; treat "preset" as "the arithmetic behind a human question",
not necessarily as its own screen.

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
  occasion. Increment 6 gives it that home.

## Not in scope

- **Contact-method priorities and per-occasion preferred methods.** Until they exist, several
  methods means show them all — the no-guess option, and the one that needs no unwinding when
  priorities land. The one-method case is not special-cased; it is the same rule with one button.
- **The cascade's editing UI.** Four levels × N actions × per-person is a large settings surface
  and the owner wants it designed against the stronger onboarding flow, which is later work.
  Nothing above depends on it: increments 5–6 need no *cascade* settings screen, and the shipped
  prompt needs only itself and the existing per-milestone schedule editor.
- **The holiday prompt.** The shipped per-bearer shape is right for milestones and wrong for
  holidays, where one occasion spans everyone: Christmas wants a single prompt listing people, not
  one per observance. It writes the same rules through the same path, so it is a presentation to
  add later, not a mechanism to design now — but ⚠️ **do not ship per-observance prompts in the
  meantime**, because forty Christmas questions in November is worse than the noise this
  workstream started on.
- **Batching prompts.** Three birthdays landing in the same fortnight are three separate `plan`
  rows today. Answering them together is a natural later move, and shares its shape with the
  holiday prompt above — which is a reason to do them together rather than either one twice.
- **The offer-set differ** that re-asks when a new action becomes available (decision 9). The
  answer already records what was offered; nothing yet compares it.
- **A picker for platform-qualified actions** — scheduling `message:discord` or `post:instagram`
  rather than only the shipped set (decision 3). The identity half is built and the qualifier is
  open by design, so this is a UI that reads `@leapsake/contact-links`' registry and writes an
  ordinary rule; nothing about the mechanism has to change. ⚠️ **Increment 5 is not it.** That
  increment derives a `wish` row's *affordances* from the contact methods a person has — buttons
  to act now — which is a different thing from letting the user schedule a reminder to post on
  Instagram, and deliberately so: a contact method must never reach identity.
- **Per-action grace periods**, **snooze for user reminders** (the open question flagged in
  `partitionReminders`' doc-comment), and **user-defined milestone kinds**.
