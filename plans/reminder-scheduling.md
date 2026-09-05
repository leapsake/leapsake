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

Nine decisions, settled in design *(owner, 2026-09-02, 2026-09-04 and 2026-09-05)*. Everything
below implements them; none of them is open. Exactly one sub-question is deliberately deferred —
how a kind-level rule interacts with the prompt — and it is parked in Increment 6, where it lands.
Decisions 1, 2, 5 and 7 are **built**; what landed differently from the sketch is noted on each.

⚠️ **Decision 3 was half-reversed on 2026-09-05** — a channel is an affordance, not an errand —
which is the largest change any of these has taken and which shrank Increment 5 around it. Read it
before reading that increment. Decision 8's offer set moved with it.

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
3. **Anything you would tick independently is its own reminder** — but a **channel is not one of
   those things** *(owner, 2026-09-05)*. ⚠️ **This half-reverses the decision as it stood.** It
   used to read "text in the morning, call at night, and post on Instagram are three rows and
   three checkboxes, never one row with three buttons", and that example is now exactly backwards:
   how you reach someone is an **affordance on the acknowledgment**, not an errand you schedule.
   One row — *wish them a happy birthday* — with their contact methods on it.

   The principle itself survives untouched, because it was never about channels: getting a gift,
   getting a card and posting the card really are three things you tick on three different days,
   and they stay three rows. What changed is which side of the line a channel falls on.

   **The mechanism stays built and stays unused.** `verb:qualifier`, the registry, and the
   validation are all still there — the reversal is about what the **UI offers**, not about what
   the data can express, so getting specific later costs a registry line rather than a rebuild.
   Concretely: `call` and `message:sms` come out of `SCHEDULABLE_ACTIONS` and out of every kind's
   `defaultReminderSchedule`, and keep their `actionDefs` entries so a row already stored under
   one still renders properly. See *Increment 5*, which owns the change.
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

8. **The shipped birthday default stays `wish`, alone** —
   `kindDefs.birthday.defaultReminderSchedule`, with `get:gift`/`get:card`/`send:card` at
   `enabledByDefault: false`. ⚠️ **This supersedes the 2026-09-02 decision** to ship `get:card`
   and `send:card` enabled, and its standing-load arithmetic with it *(owner, 2026-09-04)*. The
   offer set is two shorter than it was: `call` and `message:sms` left it under decision 3, which
   makes the question a shorter read as well as a truer one.

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

## Increment 5 — one acknowledgment, and the ways to reach them

The reminder learns *how* you could reach someone — and offers it, rather than saying it.

⚠️ **This increment shrank on 2026-09-05**, when decision 3 half-reversed. It was written to make
`wish` adapt its *words* to the channel — "Text A happy birthday" where a number was the only
contact method — and to let the user schedule `call` and `message:sms` as errands of their own.
Both are now out. The copy stays **generic**, always; the channels become **buttons on it**; and
nothing channel-specific is offered anywhere in the UI until there is a reason to get specific
again. What is left is a smaller and better-shaped piece of work than what was planned.

`wish` is **the acknowledgment, unspecified** — never an umbrella over channels, and no longer a
fallback for the case where nothing more specific was chosen, because nothing more specific can be
chosen:

| the person has | copy | affordances |
|---|---|---|
| no contact methods | "Wish A a happy birthday" | *Add a way to reach A* |
| one, or several | "Wish A a happy birthday" | every method they have, bar the postal one |

Two rows where there were four. The copy column no longer varies at all, which is the whole of the
reversal: the words say *what to do*, and the buttons say *how*.

⚠️ **A mailing address is not a way to say happy birthday on the day** *(owner, 2026-09-05)*, so it
is left off the affordances even though it is a contact method. It belongs to `send:card`, which
has its own row and its own clock, a week or more earlier.

⚠️ **The contact method must never touch identity.** This still binds, and binds more cheaply now:
if adding a phone number changed the id from `wish` to `message:sms`, the old row would be
tombstoned (permanently — the resurrection guard), and a birthday the user had already ticked would
come back **unticked** under a new id. Under the reversal there is no path that could: the copy is
constant and the buttons are rendered, so nothing about a contact method reaches a stored row at
all.

- ⚠️ *A nudge, never a wall* — the reminders README's own rule. Completing the birthday must never
  require adding a contact method first.
- The **collect** prompt is a CTA, and `reminderCtaOf` in `packages/view-models/src/reminders.ts`
  is the existing seam — add a `contact` kind beside `onboarding`/`duplicates`/`gift` and let each
  client map it to its own route, as they already do. Offered only for a **person** bearer with no
  methods: a pet owns no contact methods (`contactOwnerTypeSchema` is person/household), and the
  self branch has its own copy and wants none. It lives on the reminder **detail** screen on
  mobile; desktop has no reminder detail screen, so there it lands on the list row through
  `reminder-row.ts`'s `ctaLinkFor` — an asymmetry the snooze and dismiss affordances already have.

### The slices

- **A ✅ — the derive-at-read seam** *(shipped 2026-09-05)*. The copy source travels on the desired
  row; one `renderTitle` writes the sentence, called by `computeDesired` for the plain form it
  stores and by `listRemindersInWindow` for what is shown. Proved on the **belated** wording, and
  it needed a second phrase (`belatedGreeting` in `kindDefs`) rather than a splice, since "a happy
  birthday" takes *belated* in the middle, "congratulations" at the front, and "Eid Mubarak"
  nowhere at all. Also `getReminderInWindow`, because a detail screen reading the stored row would
  word itself differently from the row that linked to it. The durable reasoning is now in
  [`@leapsake/reminders`](../packages/reminders/README.md) → *Derived copy*.

  ⚠️ **Its second customer went away the day after it landed**, and the doc-comments still promise
  one: the seam was built expecting the channel-aware copy below, which the reversal deleted. It
  keeps its own justification — a stored belated wording would cost an update, and a sync, for
  every dated reminder the morning after its occasion, when `reconcile` is deliberately a no-op in
  steady state — but it now has exactly one customer, and the forward references should be read as
  history rather than as plans.

- **B — narrow what the UI offers.** The mechanical half of decision 3, and the piece with the
  sharp edge on it.

  `call` and `message:sms` come out of `SCHEDULABLE_ACTIONS` (the two schedule-editor pickers,
  `packages/ui/src/web/fields/ReminderScheduleFields.tsx` and its mobile twin, are its only
  readers) and out of every kind's `defaultReminderSchedule`. **Their `actionDefs` entries stay**,
  so a rule already stored under one — an answered prompt, or a peer on an older build — still
  renders proper copy instead of falling through to `actionDefOf`'s dull generic.

  ⚠️ **`call` is load-bearing on six kinds, and removing it naively guts four of them.** It is not
  only birthdays: today `wedding` is `[get:gift, call]`, `anniversary` is `[send:card, call]`,
  `met` and `job-start` are `[call]` **alone**, `first-date` is `[send:card, call]`, and
  `graduation` is `[get:gift, call]`. Strike `call` out and `met` and `job-start` offer *nothing*,
  while `wedding` and `anniversary` — both of which **prompt** — are left with a single option,
  which this doc's own rule says is not a question.

  The fix is the reversal's own logic rather than a special case: on those kinds `call` was
  standing in for *acknowledge them somehow*, and the generic form of that is `wish`. So **replace
  it, don't delete it** — `wedding` → `[get:gift, wish]`, `anniversary` → `[send:card, wish]`,
  `met` → `[wish]`, `first-date` → `[send:card, wish]`, `graduation` → `[get:gift, wish]`,
  `job-start` → `[wish]`. Every greeting already reads correctly under `wish` ("Wish @Alice
  congratulations", "Wish @Alice a happy anniversary"), because the greeting is what varies by kind
  and `wish` is the action written to interpolate it. On `birthday` there is nothing to replace:
  `wish` is already there and already the enabled default, so `call` and `message:sms` simply
  collapse into it.

  Two consequences worth noticing rather than tripping over:

  - **`first-date` becomes prompt-*eligible*** — two actions where it had one, which was the stated
    reason it does not ask. Eligible is not automatic; adding the prompt is one `kindDefs` line and
    a separate decision.
  - **`reminder-rule.test.ts` asserts `SCHEDULABLE_ACTIONS.length === KNOWN_ACTIONS.length - 1`**,
    which is the "everything but `plan`" invariant. That invariant is what this slice breaks on
    purpose, so the assertion becomes an explicit list.

  **No migration, and this is worth checking rather than assuming.** `reminderRuleInputSchema`
  validates the action with `reminderActionSchema` — shape only, plus a refusal of `plan` — and
  *not* against `SCHEDULABLE_ACTIONS`, so narrowing that list cannot fail the read of a stored row.
  Existing `call` rules from an answered prompt keep working and keep minting their reminders,
  which is the right outcome: the user chose them, and the reversal is about what we *offer*.

- **C — the affordances and the collect CTA.** What used to be slice D, and now the only product
  surface in the increment. Buttons come from `resolveActions` in `@leapsake/contact-links`, which
  both clients already render on the person screen, minus the postal one; the empty case gets the
  CTA above.

- **`post`, when it is offered at all: one action, not one per platform** *(owner, 2026-09-05)*.
  A single "make a post for their birthday" rather than `post:instagram` beside `post:x` beside
  `post:facebook`. Surfacing which platforms the user actually posts on is **out of scope** — the
  same shape as the affordances above, and a natural later move. Today `post` is a declared verb
  with no `actionDefs` entry and no kind offering it, so this decision costs nothing until someone
  wants the row; then it is one registry entry (bare `post`, day-of, "Post about {subject}'s
  {occasion}") and one line in a kind's defaults. ⚠️ **Not built, and deliberately not bundled
  here** — the increment is about the acknowledgment that already exists.

### Parked, with the reasoning kept

Three things this section used to own, none of them dead, none of them next.

- **The channel-aware copy** — "Text A happy birthday" where a number is the only contact method.
  It needed a `reach` port on the engine, sentence variants beside `actionDefs.wish`, and a
  `@leapsake/contact-links` dependency in `@leapsake/core` to name the platforms. All of it goes
  away under the reversal: the copy no longer varies, so the engine needs to know nothing about
  contact methods.
- **The `wish` suppression** — "suppressed whenever any specific day-of action is enabled". With
  `call` and `message:sms` unschedulable, **nothing channel-specific can suppress it**, and the one
  day-of action still standing is `visit`, on `moved`. Whether visiting someone should silence the
  wish is a real question and a rare one; it is not worth building the rule for a single arguable
  case. ⚠️ **Keep the warning that came with it**, because it is the expensive half and it will be
  true again the day channels return: suppress in the **read**, never by dropping the row from the
  desired set. `reconcile` retires an unwanted row by soft delete and never resurrects a tombstone,
  so a desired-set suppression would kill the wish for the rest of the year the moment a specific
  action was ticked, and unticking it could not bring the row back.
- **Preferred contact methods** — dropped outright *(owner, 2026-09-05)*, not deferred into this
  increment. Nothing stores the concept, and with the copy no longer naming a channel there is
  nothing for it to feed. It may return with channel-specific actions; if it does, model it as
  **one nullable pointer on the person**, not a flag on each of the four method tables, which is
  four columns, a cross-table write on every change, and an LWW merge that can leave two preferred
  methods or none.

**Done when** a bare person's birthday shows the generic wish and the collect prompt; a person with
a number, an email and a Discord handle shows the same words and three buttons; no picker anywhere
offers a channel; and a completed reminder stays completed throughout.

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

- **Contact-method priorities and per-occasion preferred methods.** Several methods means show
  them all — the no-guess option, and the one that needs no unwinding when priorities land. The
  one-method case is not special-cased; it is the same rule with one button. ⚠️ Under decision 3
  this stopped being a deferral and became a **non-requirement**: the copy names no channel, so
  there is nothing for a priority to feed. See *Increment 5* → *Parked* for the shape to use if it
  ever returns.
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
  rather than only the shipped set. ⚠️ **Not merely unbuilt: not wanted, for now** *(owner,
  2026-09-05, decision 3)*. The UI presents generic actions and offers the channels as buttons, so
  this picker has nothing to be the answer to until that reverses. The identity half stays built
  and the qualifier stays open by design, so when it does, this is a UI that reads
  `@leapsake/contact-links`' registry and writes an ordinary rule; nothing about the mechanism has
  to change. ⚠️ **Increment 5 is not it.** That
  increment derives a `wish` row's *affordances* from the contact methods a person has — buttons
  to act now — which is a different thing from letting the user schedule a reminder to post on
  Instagram, and deliberately so: a contact method must never reach identity.
- **Per-action grace periods**, **snooze for user reminders** (the open question flagged in
  `partitionReminders`' doc-comment), and **user-defined milestone kinds**.
