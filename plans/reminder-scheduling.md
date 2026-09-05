# Reminders — the rule cascade, and presets

> **Delete this doc when the work lands.** The durable *why* goes into
> [`@leapsake/reminders`](../packages/reminders/README.md) beside the onboarding-nudge reasoning
> that already lives there, and into the doc-comments on the code each increment touches. This
> file exists only for what is not built yet.

## Next up

⚠️ **Read this first, and move the marker when a slice lands.** Everything below is reasoning;
this is the queue. Each entry names one unit of work and the section that specifies it.

1. **Increment 6 — the cascade, and provenance** ← **the next unit of work.** Four levels,
   resolved per action. ⚠️ Increments 1–5 are **finished and their sections are gone** — their
   reasoning moved next to the code, which is the rule this repo runs on. What is left in this
   file is those two increments, the model they must honour, and *Not in scope*.
2. **Increment 7 — presets**, most of which the shipped prompt already absorbed. Read its warning
   before starting: it may be a second question on the prompt rather than a surface of its own.

**Already landed; do not re-plan it.** Per-action windows, the `plan` prompt, the `verb:qualifier`
identity split, and all of Increment 5 — the derive-at-read seam, no channel offered anywhere, and
the contact affordances with their collect prompt. `git log` is the record of what
was done and the package READMEs hold the reasoning — `@leapsake/reminders` most of all.

## Why this exists

Every "Wish @A a happy birthday" reminder in the next four weeks was on Home, all month, for
everyone. Three causes sat under that, and **all three are now built**: one constant gave every
rule the same run-up (per-action `activeDays`), the engine had to guess what to remind you about
before you had decided anything (the `plan` prompt), and a flat action string could not tell two
errands of a kind apart (`verb:qualifier` identity). Increment 5 closed the last of it — the
acknowledgment now carries the ways to act on it.

The reasoning for all of that has left this file, as it is supposed to: it lives in
[`@leapsake/reminders`](../packages/reminders/README.md) — *Identity*, *Windows*, *Derived copy*,
*The prompt* — and in [`@leapsake/view-models`](../packages/view-models/README.md), with `git log`
carrying the rest. **What is left here is the cascade and presets**, plus the model they have to
honour.

## The model

Nine decisions, settled in design *(owner, 2026-09-02, 2026-09-04 and 2026-09-05)*. They are the
contract the remaining work has to honour, not a task list — **eight of the nine are built**, and
what landed differently from the sketch is noted on each.

The exceptions, and the whole of what is open here:

- **Decision 6, the cascade, is not built at all.** It is Increment 6, and it is the next unit of
  work.
- **Decision 9 is half-built**: an answer persists, but nothing compares a stored offer set against
  today's, so nothing re-asks. See *Not in scope*.
- **One sub-question is deliberately deferred** — whether a kind-level rule seeds the prompt or
  suppresses it — and it is parked in Increment 6, where it lands.
- **One small decision is open and unowned**: whether `first-date` should now prompt. See decision
  7's last bullet.

⚠️ **Decision 3 was half-reversed on 2026-09-05** — a channel is an affordance, not an errand —
which is the largest change any of these has taken — it deleted half of what Increment 5 was
going to be. Decision 8's offer set moved with it. Read both before touching anything that offers
a user a list of actions.

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
   one still renders properly. Built: the reasoning is on `SCHEDULABLE_ACTIONS` /
   `UNOFFERED_ACTIONS` in `@leapsake/schema` and in
   [`@leapsake/reminders`](../packages/reminders/README.md) → *Identity*.
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
   - **Only birthdays, weddings and anniversaries prompt**, because a question with one answer is
     not a question and the rest offer one action each. ⚠️ **`first-date` no longer does**: the
     channel removal left it with two (`send:card` and `wish`), so it is now prompt-*eligible*
     while `met`, `graduation` and `job-start` stay at one. Eligible is not automatic — adding the
     prompt is one `kindDefs` line and **an open decision nobody has taken**, listed here rather
     than in *Not in scope* because it is a two-minute change someone should either make or
     consciously decline.

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

### Where this lands in the code

Verified against the tree as it stands, so nobody has to re-derive it:

| The thing | Where it is now |
|---|---|
| The resolver this increment replaces | `resolveReminderSchedule` in `packages/schema/src/milestone.ts` — all-or-nothing, and it returns a `source` (`stored` \| `kind-default`) that the prompt depends on |
| Its `bearerId: z.uuid()`, and the bearer-type enum to widen | `packages/schema/src/reminder-rule.ts` — `reminderRuleBearerTypeSchema` is `["milestone", "observance"]` and its own comment says adding one is Zod-only |
| Who calls the resolver | eight call sites in four files: `@leapsake/core` ×3 (the engine port, the schedule-editor read, the prompt's offer set) and three milestone form components across the two clients — so a signature change is not a local edit |
| Where the engine reads a schedule | the `resolveSchedule` port on `ReminderEngineDeps` in `@leapsake/reminders`; its doc-comment already says disabled entries are returned and ignored |
| Where a prompt's answer is written | `milestones.create` / `milestones.update` in `@leapsake/core`, both through `reminderRulesRepo.replaceForBearer` — the one write path, and the reason the whole-set duplicate check lives on it |
| The holiday twin, which must not drift | `resolveObservanceReminderSchedule` in `packages/schema/src/holiday.ts` — same "missing rows ⇒ defaults" contract, and it will want the same cascade treatment or an explicit decision that it does not |

⚠️ **The last row is the one most likely to be missed.** Observances resolve through a parallel
function with its own defaults; a cascade built only for milestones leaves two schedule resolvers
with different rules, which is exactly the drift `SCHEDULABLE_ACTIONS` and `renderTitle` were each
centralised to avoid.

**Provenance is product surface, not a debug aid.** The owner wants the winning level visible on
the reminder screen, the person+milestone screen, the person+holiday screen, the milestone screen,
the holiday screen, and probably Settings. So the resolver returns **what every level said**, not
just the winner, letting one shared component render both halves everywhere:

> Wish A a happy birthday — *inherited from A's defaults* · Override for this birthday

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

- **Mailing it:** `get:gift` long out, `send:card` medium out, `wish` day-of.
- **Seeing them:** `get:gift` medium out, `visit` day-of, `wish` day-of.

- ⚠️ **Do not model rule dependencies.** "`get:gift` is due 3–7 days before `send:card`'s due date" is real
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
  there is nothing for a priority to feed. ⚠️ If it ever returns, model it as **one nullable
  pointer on the person**, not a flag on each of the four method tables: a flag is four columns, a
  cross-table write on every change, and an LWW merge that can leave two preferred methods or
  none.
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
  to change. ⚠️ **The shipped contact affordances are not it.** A `wish` row's buttons are derived
  from the contact methods a person has — things to do *now* — which is a different thing from
  letting the user schedule a reminder to post on Instagram, and deliberately so: a contact method
  must never reach identity.
- **Channel-aware reminder copy** — "Text A happy birthday" where a number is the only way to
  reach someone. It would need a `reach` port on the engine, sentence variants beside
  `actionDefs.wish`, and a `@leapsake/contact-links` dependency in `@leapsake/core` to name the
  platforms. Dropped by decision 3: the copy no longer varies, so the engine needs to know nothing
  about contact methods, and the ways to reach someone are buttons rendered from
  `reminders.targets`.
- **Suppressing `wish` when a specific day-of action is enabled.** "Wish them" means *some
  acknowledgment, unspecified*, so it is redundant once a specific one exists — but with the
  channel actions unschedulable, the only day-of action left that could trigger it is `visit`, and
  whether visiting someone should silence the wish is one arguable case rather than a rule worth
  building.

  ⚠️ **Keep this warning with it**, because it is the expensive half and it becomes true again the
  day channel-specific actions return: suppress in the **read**, never by dropping the row from the
  desired set. `reconcile` retires an unwanted row by soft delete and never resurrects a tombstone,
  so a desired-set suppression would kill the wish for the rest of the year the moment a specific
  action was ticked — and unticking it could not bring the row back. That is the same "zero
  birthday reminders" failure a written `enabled: false` would cause, reached by the other road.
- **A single `post` action, if posting is ever offered** *(owner, 2026-09-05)*. One "make a post
  for their birthday", **not** `post:instagram` beside `post:x`; surfacing which platforms the user
  actually posts on is a later move of the same shape as the contact affordances. `post` is a
  declared verb with no `actionDefs` entry and no kind offering it, so this costs nothing until
  someone wants the row — then one registry entry (bare `post`, day-of, "Post about {subject}'s
  {occasion}") and one line in a kind's defaults.
- **Per-action grace periods**, **snooze for user reminders** (the open question flagged in
  `partitionReminders`' doc-comment), and **user-defined milestone kinds**.
