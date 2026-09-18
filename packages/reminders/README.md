# `@leapsake/reminders`

The engine that mints, refreshes, and retires **`system` reminders** — rows the app owns rather
than the user. Four families feed one reconcile: milestone reminders (birthdays and the like),
holiday-observance reminders, the dateless **onboarding nudges**, and the duplicate-pairs nudge.

It has no `@leapsake/core` dependency, and the engine has no `@leapsake/data` one either:
everything it needs arrives through small injected ports (`ReminderEngineDeps`), so it stays
independently testable and narrowly scoped.

## Two entry points, and why the split is load-bearing

| Import                     | File        | What it is                                                                        |
| -------------------------- | ----------- | --------------------------------------------------------------------------------- |
| `@leapsake/reminders`      | `engine.ts` | the pure half — the desired-set walk, the display window, the copy. No I/O.       |
| `@leapsake/reminders/api`  | `api.ts`    | `createRemindersApi(deps)` — the client-facing surface, over repos. Needs `data`. |

**The root barrel deliberately does not re-export `api.ts`.** `@leapsake/view-models` depends
on this package and `@leapsake/ui` depends on that, so a single barrel carrying the repo-backed
half would pull `data` — and through it `crypto` — into the type graph of a package that only
renders components. `packages/ui` sets `"types": []`, so that lands as a typecheck failure
rather than as a slow drift.

`api.ts` takes two things as ports rather than importing them: **`hasAccount`**, because the
answer lives in `@leapsake/key-custody` and reminders has no business depending on custody to
ask one question, and **`listHolidayCandidates`**, because `@leapsake/holidays` already depends
on this package and importing it back would be a cycle.

## Where to look

| You want                                                              | Read                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| How reconcile decides what to insert, refresh, or tombstone           | `computeDesired` + `reconcile` in `src/engine.ts`                                       |
| What makes two reminders for one occasion different reminders         | `ReminderAction` and `actionKeyOf` in `@leapsake/schema`, and _Identity_ below          |
| When a reminder goes on display, and when it stops                    | `isWithinWindow` in `src/engine.ts`                                                     |
| How long a given errand sits on the list                              | `activeDays` on `actionDefs`, in `@leapsake/schema`                                     |
| How far ahead the _list_ looks, versus the _notification schedule_    | `DISPLAY_WINDOW_DAYS` and `NOTIFICATION_WINDOW_DAYS` in `src/engine.ts`                 |
| What a row can say about its own timing once it leaves the engine     | `ReminderWindowFacts` in `src/engine.ts`                                                |
| Why a row can display copy it does not store                          | `renderTitle` / `derivedTitle` in `src/engine.ts`, and _Derived copy_ below             |
| What a detail screen should read instead of the stored row            | `getReminderInWindow` in `src/engine.ts`                                                |
| Why a not-yet-active reminder can still be ticked                     | `materializeReminder` in `src/engine.ts`                                                |
| The onboarding nudge definitions and their copy                       | `ONBOARDING_STEPS` in `src/engine.ts`                                                   |
| Which rows may be put off, and how far                                | `snoozeTargetOf` in `src/engine.ts`, and _Putting a step off never retires it_ below    |
| Why an unconfigured occasion gets a question instead of errands       | the `plan` synthesis in `computeDesired`, and _The prompt_ below                        |
| When that question is asked                                           | `promptOffsetDays` in `@leapsake/schema`, derived from what it offers                   |
| What a question can still offer, and when a late one is due           | `planOffers` and `planTiming` in `@leapsake/schema`, and _You can't be late…_ below     |
| Why `first-date` and `wedding` ask only about your own                | `prompt.onlyOwnPartnership` in `kindDefs`, and _Who gets asked_ below                   |
| Why a reminder asks for a date instead of giving one                  | the `partnerships` port in `ReminderEngineDeps`, and _Collecting what is missing_ below |
| Why a second desired-row family is a parallel port, not a widened one | the `holidays` port doc-comment in `ReminderEngineDeps`                                 |
| Why a schedule has two levels and not four                            | `resolveReminderSchedule` in `@leapsake/schema`, and _Schedules_ below                  |

## Identity — what makes two reminders different reminders

A `system` reminder has no random id. It is content-addressed:
`milestone:<id>:<year>:<action>`, hashed, so two devices minting "the same" reminder derive the
**same** id and the existing whole-row merge dedups them instead of showing it twice. The action
string is therefore the whole of what keeps two reminders for one birthday apart — and it is also
the whole of what can accidentally merge them.

### A flat action could not say what the errand was

Buying a card and posting it are two errands on two clocks. So are buying a gift and buying a
card. A flat action had one name for each — `gift`, `card` — and no way to say "get" separately
from "what", so the moment two rules wanted the same verb they collapsed: the desired set is keyed
by derived id, and the later of the two silently won. Nothing prevented writing them, either.

Hence `verb:qualifier`. The **verb is closed** and Zod-validated, because it is what the code
branches on; the **qualifier is open**, because it is `gift`/`card` today and could be a platform
id from `@leapsake/contact-links` later, and `@leapsake/schema` neither has nor wants that
dependency. It is validated by shape, not by membership in a list. The action stays one free-text
column and one segment of a hashed name, so this needed no schema change — and nothing anywhere
_parses_ a reminder id, so an action carrying a colon of its own costs nothing.

⚠️ **A channel qualifier is not what that openness is for, and is not coming soon** _(owner,
2026-09-05)_. `call` and `message:sms` were offered as errands of their own until then, and are
not any more: how you reach someone is an **affordance on the acknowledgment** — a button on
"wish them a happy birthday", rendered from their contact methods when the reminder fires — not a
row you schedule weeks ahead. The read behind those buttons is `reminders.targets` in
`@leapsake/core`, which also answers the case where there are none: a wish for someone unreachable
offers to collect a way in. ⚠️ _A nudge, never a wall_ binds there — the reminder stays completable
by someone who never adds one. They keep their `actionDefs`
entries so a rule stored under one still renders its real copy, and they are excluded from
`SCHEDULABLE_ACTIONS`, which is the list every picker reads. The distinction that matters here is
that this is a decision about **what the UI offers**, not about what an action can express: the
identity split below is untouched, and getting specific again is an edit to one filter.

Two things fall out of that which look like deferrals and are not. **Contact-method priorities**
have nothing left to feed — the copy names no channel, so there is no preferred method for it to
pick. ⚠️ If they ever return, model them as **one nullable pointer on the person**: a flag on each
of the four method tables is four columns, a cross-table write on every change, and an LWW merge
that can leave two preferred methods or none. And **a picker for platform-qualified actions** —
scheduling `post:instagram` rather than the shipped set — is not merely unbuilt but not wanted,
since the UI offers generic actions and renders channels as buttons instead. ⚠️ The shipped contact
affordances are _not_ that picker: a `wish` row's buttons come from the methods a person **has**,
things to do now, which is a different thing from scheduling an errand — and deliberately so, since
a contact method must never reach identity.

Two rules that fall out of it, both easy to break:

- **A verb-keyed registry cannot hold this.** `actionDefs` is keyed by the whole action, because
  everything on it varies by qualifier: `get:gift` and `get:card` are both 30-day projects,
  `send:card` is a fortnight. Every lookup goes through `actionDefOf`, never an index — the type
  is open, so an index is a possible `undefined`, and the one that matters is inside reconcile,
  where a throw aborts the transaction and leaves the whole list unreconciled. An action from a
  later version renders dull copy instead.
- **`other` keys on its label** (`actionKeyOf`), because its action carries no information at all
  — the errand _is_ the free text. Two custom rows were the most reachable form of the collapse,
  since the editor visibly invites a second one.

### Nothing merely _true about_ a reminder may reach its identity

Copy is derived at render; identity is not. If adding a phone number moved a row from `wish` to
`message:sms`, the old id would be tombstoned — permanently, since reconcile never resurrects one
— and a birthday the user had already ticked would come back **unticked** under a new id. Same
reminder, different words, is already the pattern: `isSelf` flips "Wish @You a happy birthday" to
"It's your birthday!" without touching the row's identity.

The one place editing a rule _does_ re-key it is renaming an `other` — deliberate, since the label
is that reminder's entire content, and the reason the derived cases must stay out of the key.

### A duplicate has to be caught as a set

A per-row schema cannot see one, and there is no unique constraint on `reminder_rules`. So
`reminderScheduleInputSchema` validates the whole set, on the one write path everything goes
through — `reminderRulesRepo.replaceForBearer`, which both schedule editors and the prompt's
answer reach.

## Windows — the product design behind them

The mechanics are on `isWithinWindow`. This is the reasoning behind the two numbers it reads.

### How long something sits on your list is a property of the action

The engine shipped with one constant, `LEAD_DAYS = 30`: every rule got the same month-long run-up
before its own due date. That was right while the engine only made birthday reminders. Once rules
carried a per-action `offsetDays` it was wrong, and the symptom was the obvious one — **every
birthday in the next four weeks sat on Home, all month, for everyone**.

A smaller constant would not have fixed it, because the actions are not alike. A phone call takes
minutes and cannot be done early; buying, wrapping and posting a gift takes weeks and must be
started early. So the run-up moved onto the action itself, as `activeDays` in the schema's
`actionDefs`, beside the label and the copy template. `offsetDays` — when a thing comes **due** —
stayed per-kind, because that genuinely does vary by occasion: a card for a wedding is not on the
same clock as a card for a birthday.

Two numbers, and each lives where its variation is. A `wish` is `offset 0, active 0` and arrives on
the morning it is owed. A `get:gift` is `active 30` whatever the occasion, because a gift is a project.

**The numbers themselves are data, not architecture.** They are one owner's estimates and expect to
be corrected against real use; changing one is editing a literal in `actionDefs`, never touching logic. If the eight-week
prompt in a later increment feels too early, the dial to turn is `get:gift`'s `activeDays`, because
that is where the pressure actually comes from.

### Two ways to miss something, and they are not the same

The old window closed at `daysUntilOccurrence >= 0`, so a missed birthday **disappeared the next
morning**: the app noticed and said nothing. A list that cannot tell you when you dropped something
is a list you stop trusting.

The new window closes on the **occurrence** rather than on the rule's own due date, plus a short
grace tail (`BELATED_DAYS`). That single change names both failure modes, with nothing stored and
nothing extra computed — both fall out of the arithmetic the aliveness test already does:

| state        | test                                       | means                                                                                                                              |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **past due** | `daysUntilDue < 0`, occurrence still ahead | the deadline blew but it is **still salvageable** — the card missed its post date, but the birthday is Tuesday, so pay for express |
| **belated**  | `daysUntilOccurrence < 0`                  | the occasion has passed; only acknowledgment is left                                                                               |

It falls out per action with no configuration. A day-of action's due date _is_ the occurrence, so it
can never be past due and goes straight to belated; a `send:card` at `offset 7` is past due for up to a
week first. `BELATED_DAYS` bounds **only** the belated tail — past due needs no dial of its own,
because the occurrence bounds it.

**Both show under one heading, _Belated_** _(owner, 2026-09-11)_. Two sections asked the reader to
learn a distinction before reading a row that already states it — "due 3 days ago" against
"birthday was yesterday". `bucketReminders` keeps the distinction only to put what can still be
saved first.

Holding the window open to the occurrence is also what keeps a long errand honest: an unbought gift
due twelve days before a birthday stays on your list right up to the birthday, rather than vanishing
on the day its own deadline slipped.

Reaching the belated state needed one thing the date math could not do. A recurring occurrence rolls
to _next year_ the morning after it passes, so nothing looking forward can ever report "yesterday" —
hence `recentOccurrence` in `@leapsake/schema`, walked alongside `nextOccurrence`. It answers
strictly _before_ today, so the two are disjoint and no occurrence is ever considered twice. The
holiday resolver takes the same short look back, so the two dated families agree about what
"missed" means.

### The two states are only useful if the screen can name them

Everything above happens inside `isWithinWindow`, which computes both missed states and
then throws the distinction away — it answers a boolean. The screen needs the distinction,
and cannot recover it: `reminders` has no action column, so `dueDate + offsetDays` is not
derivable from a row, and neither is the day the row went on display.

So the walk reports them. `ReminderWindowFacts` carries **`activeFrom`** (when it surfaces)
and **`occurrenceDate`** (what it counts down to) alongside every row `listRemindersInWindow`
returns, and `bucketReminders` in `@leapsake/view-models` does the splitting. Both are
**derived, never stored**: persisting them would make every edit to a number in `actionDefs`
a data migration, which is exactly the property that made those numbers data in the first
place.

Two rules the derivation depends on, both easy to break by accident:

- **`activeFrom` is always the action's own `activeDays`**, never the window the walk was
  called with. The window parameter decides whether a row is in the set at all; substituting
  it would make every previewed row claim to be already active.
- **A row with no occurrence is never belated.** An overdue user reminder is still
  salvageable — nothing has _passed_ — so it reads as past due. Belated needs a known
  occasion that has gone.

### Derived copy — what a row shows is not always what it stores

A reminder's title is stored, and it has to be: `reminders` is one flat table a client can read
without the engine. But some of what a title should _say_ is not knowable when the row is minted.
Whether the occasion has since **passed** is the first case, and it is the pattern for the rest.

So the row stores the **plain** wording and the belated wording is put on at the read.
`ReminderCopySource` travels on the desired row — the action, the mention-wrapped subject, the
greeting and its belated variant — and one `renderTitle` writes the sentence from it, called twice:
by `computeDesired` for what is stored, and by `listRemindersInWindow` for what is shown. Two
callers, one function, so the two forms cannot drift into two different sentences.

Deriving it is not a nicety. `reconcile` refreshes a row whose title has drifted, so a stored
belated wording would cost an update — and a sync — for **every** dated reminder the morning after
its occasion. `reconcile` is deliberately a no-op in steady state, and a title that expires
overnight would end that. The same argument is what keeps the _next_ thing off the stored row: how
the user can actually reach someone changes with every contact-method edit, and none of those edits
should touch a reminder.

Three rules the derivation depends on, all easy to break by accident:

- **It goes on the shared walk, not on a screen.** `listRemindersInWindow` is what both the
  reminder list and the notification planner read (the planner through `listNotifiableReminders`),
  so copy attached there reaches both and they cannot disagree. Copy attached in a client would
  leave the notification saying something else.
- **A detail screen must read `getReminderInWindow`, never the stored row.** Reading past the seam
  words the screen differently from the row that linked to it — on the screen where the reminder is
  actually acted on. It answers `undefined` for a row outside the window, where the plain title is
  the whole truth and the caller should fall back to it.
- **A greeting with no belated form keeps the plain one.** `belatedGreeting` is a second phrase in
  `kindDefs`, not a rule applied to the first, because there is no such rule: "a happy birthday"
  takes _belated_ in the middle, "congratulations" at the front, and "Eid Mubarak" nowhere at all.
  Absent means unchanged, which reads as slightly odd rather than as mangled — the right way round.
  Holidays carry none today: a holiday's greeting is a stored column seeded from the catalog, so a
  second phrase there is a migration.

### Three windows, and why none of them is the others

| window                     | asks                                                        | answer                  |
| -------------------------- | ----------------------------------------------------------- | ----------------------- |
| `activeDays` (per action)  | what should be a **row** today                              | the errand's own run-up |
| `DISPLAY_WINDOW_DAYS`      | what is worth **previewing** to someone looking at the list | 30 days                 |
| `NOTIFICATION_WINDOW_DAYS` | what could come due before the schedule is **rebuilt**      | a year                  |

One walk (`computeDesired`) serves all three, parameterised by `ActiveDaysOf` — a second
implementation of the id derivation or the window filter would drift the day either changed.
⚠️ `DISPLAY_WINDOW_DAYS` must stay at or above `MAX_ACTIVE_DAYS`, or a row the
materialization walk already minted would fall out of the read that feeds the screen; the
test asserts it.

Previewing is not the same as forbidding. **Everything can be done early** — the window
governs when the app _prompts_ you, never what you are allowed to do — so a preview row is
tickable, and `materializeReminder` mints the row being ticked. ⚠️ Doing so **retires the
errand for the year**: the next reconcile does not want that row yet and prunes it to a
tombstone, which is never resurrected. That is the intended reading, and it is permanent.

### Known limitation

`BELATED_DAYS` is one dial for every action. A missed phone call is arguably stale sooner than a
missed gift, and per-action belated windows are a plausible refinement — deliberately not built
before there is evidence about which actions want what.

## The prompt — the product design behind it

The mechanics are on the `plan` synthesis in `computeDesired` and on `actionDefs.plan`. This is the
reasoning.

### The engine cannot know, so it must not guess

Windows made the noise quieter. Underneath them sat a second cause no window reaches: the engine has
to decide what to remind you about **before you have decided anything**, so it guesses — and a guess
that is right for some people is noise for the rest. You do not know in October which of forty
people you will post a card to in November; the engine certainly does not. Every speculative row it
mints is a row you have to learn to ignore, and a list you have learned to ignore is broken however
well it is bucketed.

So an occasion with no rules of its own mints exactly one reminder, and that reminder is a
**question**. Answering it writes ordinary `reminder_rules`, and the engine takes it from there.

The point is _when_ it asks. Configuring forty people up front is work nobody will do, and it
demands a judgement — is Violet a card person? — at the one moment you have no context for it. Asked
eight weeks out, with the occasion named, it is a five-second decision you are equipped to make.

### A question costs more than a row, so answering has to be cheap

⚠️ **This is the design's real risk, and a build constraint rather than a nicety.** Trading several
passive rows for one row that demands a decision only wins if the prompt is **cheaper to answer than
the old rows were to ignore** — and ignoring a row is free. A prompt you must open a screen to
answer, forty times a year, is the first-run wizard this package already rejected, wearing a better
hat.

Hence the one-tap _just the day_: the answer most people give most of the time, so it is a button on
the row rather than a control on a form. It writes the same full offer set the form does.

### Nothing about the timing is chosen

```
plan.offsetDays = max(offsetDays + activeDays) over the offered set   ← promptOffsetDays
plan.activeDays = 14                                                  ← actionDefs.plan
```

Due at the furthest reach of anything it offers, so ticking the gift still leaves the gift its full
thirty days rather than handing it back already past due. Ship a longer-lead action later and every
prompt slides earlier by itself, with no second constant to keep in step. ⚠️ If eight weeks turns
out to feel too early, **the dial to turn is `get:gift`'s `activeDays`, not the prompt's** — that is
where the pressure actually comes from, and where the arithmetic reads it.

### You can't be late for something the app has only just learned _(owner, 2026-09-11)_

The timing above assumes the app knew about the occasion all along. An import breaks that: forty
people arrive at once, and every occasion inside its own eight-week lead used to arrive with its
question already overdue — "37 days ago" on a birthday five days off, a wall of them, burying the
getting-started steps. Nothing had been missed; the app had only just been told.

So every deadline is measured from the day the app **learned** of the occasion — the milestone's
`createdAt`, or, for an errand, when its rules were written (`writtenAt`):

- **A question offers only what still fits** (`planOffers`, `fitsAt`). Posting needs
  `OFFER_NOTICE_DAYS` before its post date; a gift or a card can still be handed over in person,
  the day before (`latestOffsetDays`); the day-of wish is always possible. The screen that answers
  the question reads the same function, so it never offers something the row was not asking about.
- **A late question is due when the user would start losing an option** (`planTiming`) — the last
  day the soonest-to-expire of its remaining offers is still on offer — and is on display from the
  day it arrived. Ignoring it past that genuinely costs something, which is what makes calling it
  overdue honest.
- **A question with one answer is not asked**, and an ignored one **retires once only the wish is
  left** rather than lingering to the occasion. The wish it leaves behind is already on the
  schedule.
- **An errand chosen too late for its own deadline slides** to the latest it can still be done
  (`effectiveOffsetDays`): a gift ticked five days out is due the day before. A post date does not
  move.
- **…but a slide may never reorder the schedule** (`effectiveOffsets`). A card bought at 12 and
  posted at 7 is one errand feeding another; sliding only the buying put the posting first, and the
  app asked for a card to be in the post six days before it was bought. The slide is applied to the
  enabled set as a whole, and an errand something else waits on keeps its own deadline rather than
  crossing it.
- **An answer that could not be offered everything covers its own year only** (`isPartialAnswer`).
  The question returns for the next occurrence, on its usual timing, with everything on offer and
  last year's choice pre-ticked.
- **An occasion that had already passed when it was added is not reminded at all** — not even with
  a belated wish.

⚠️ **None of it is stored.** Every date is derived from the occurrence, the learned date and the
kind, so it is stable across reconciles and a steady-state reconcile still writes nothing. And the
next occurrence is always far enough out for the usual timing, so a late arrival corrects one year
and leaves nothing to clean up.

A question's row also counts down to the **occasion** rather than to its own deadline
(`countdownDate` on `ReminderWindowFacts`): its due date is when to decide by, and "in 2 weeks" was
being read as the birthday.

### Answered, unanswered, and answered-with-nothing

- **Unanswered is not silence.** An ignored prompt leaves the occasion riding its kind defaults,
  which is `wish` day-of. You never lose the birthday, and that guarantee is what makes the question
  safe to ignore.
- **An ignored prompt stays answerable** past its own deadline, as belated, for as long as it has
  more than the wish to offer; then it retires and the wish rides on. A late answer works; the
  chosen actions materialise with compressed windows, and any that could no longer make their own
  deadline slide (see _You can't be late…_ above).
- ⚠️ **Ticking nothing must be distinguishable from never being asked**, or the question returns
  every year. So an answer writes the **full offer set**, `enabled: false` rows included, and
  rows-existing is the "answered" marker. No new column — and it doubles as the record of _what was
  offered_, which a future offer-set differ will need.

### An unanswered question must never become a wall

An ignored prompt is alive from its due date until its choices run out — up to six weeks in
_belated_, and therefore in `owed`. Left there it would make the day unfinishable, for every person
you have. _A nudge, never a wall_ binds here as hard as anywhere, so a prompt can be put off like
any row before its deadline, and _don't ask again_ is on offer from the first sight of it.

⚠️ **No snooze lands past its due date** (`snoozeTargetOf`). The deadline is a real one — the last
day on which ticking "get a gift" still leaves the gift its run-up — so a _remind me next week_
offered just before it would silently forfeit the long-lead options; only the choices that land by
the deadline are offered. Once the prompt is belated it cannot be put off at all: what is left is to
answer it, or to say _don't ask again_.

### Who gets asked, where that is narrower than which kinds ask

`first-date` and `wedding` ask only about a **romantic partnership the user is in** _(owner,
2026-09-05)_; every other prompting kind asks about everyone's. Two decisions are stacked there, and
they are worth keeping apart.

That they ask at all is a volume argument in reverse: both kinds ship every action **off**, so
without a question a wedding or a first date you record generates _nothing at all_, which makes
recording one pointless.

That they ask **narrowly** turns on what the app is doing when it asks. Wishing someone else a happy
anniversary is a perfectly normal thing to want — but the prompt is not the wish, it is the app
**volunteering a set of errands** about an occasion nobody asked it about. That earns its place only
where the user has already shown the occasion matters to them, and their own marriage is that
showing. Someone else's stays fully remindable; it just has to be asked for, on the milestone's own
schedule editor, rather than raised unprompted.

⚠️ **This reverses an earlier reading from the same day**, which had `wedding` asking about
everyone's on the grounds that third parties do mark the occasion. That is true of the _wish_ and
not of the volunteered errands, and the two were being conflated.

**"The user's own" has three storage shapes, and all three count**: borne by the relationship, borne
by the partner, or borne by **the user alone** — a wedding recorded before its spouse exists at all,
which the create form's "unknown" escape allows. Your own occasion is yours whether or not the app
knows who else was there, and refusing to ask because the record is incomplete is exactly the gate
this package does not put in front of people.

⚠️ **The gate fails closed**, and that is the deliberate half. `isOwnPartnership` is an optional
port, and with no port wired the gated prompt is minted for nobody — because the failure it exists
to prevent is asking about other people's, and a wiring mistake defaulting the other way would
restore that everywhere at once.

⚠️ **It reads data the user may not have entered**, which is the accepted cost. A first date is
usually recorded on the _partner_, not on the relationship, so the check looks for a stored
`spouse`/`partner` edge (`isRomanticRole`, which takes the gendered variants through `baseRole`)
between them and the self-person. No self-person, or no role set, means no question — silence in
exactly the case that wanted asking. The alternative was asking about everyone, and between a
question that sometimes fails to appear and one that appears where it makes no sense, this one was
chosen knowingly.

### A relationship is a bearer like any other, and once was not

A milestone borne by a **relationship** — a wedding anniversary linked to the marriage it belongs
to, which both clients invite you to do — generated **nothing at all** until 2026-09-05. Not the
reminders, not the prompt. The composition root answered `null` to the label port for that bearer
type, meaning "no formatter for this"; the engine reads `null` as "the bearer is gone" and skips the
milestone. One value, two meanings, and the losing one was silent on both sides.

The fix is that a relationship now has a name: both endpoints (`relationshipPairLabel` — "Harry &
Tilly"), or, when the self-person is one end, **the other end**, since "Wish You & Violet a happy
anniversary" is not a thing to tell anyone. `null` again means only _gone_.

Two consequences worth holding on to:

- **`isSelf` is asked about every bearer type, not just people.** A relationship you are one end of
  is "about you", which is what makes your own anniversary's prompt say _your own_. It stays
  distinct from `isOwnPartnership` above: your wife is not _you_, and conflating them would give her
  birthday "It's your birthday!".
- ⚠️ **A relationship-borne row carries no mention backlink.** Its label is either two entities or an
  entity the loop does not hold the id of, and a mention token names exactly one. The row is plain
  text, which is the accepted cost of it existing at all.

### ⚠️ The mechanism generalises to holidays; the shape does not

A milestone is one person, so one prompt is one decision. A holiday is one occasion across everyone
— per-observance prompts would mean forty questions in November, which is the disease this
workstream exists to cure rather than the cure. Christmas wants a **single** prompt listing people
("who are you sending cards to?"), writing the same observance-bearer rules through the same path.
Same writes, different presentation. **Do not ship per-observance prompts in the meantime.**

### Known limitations

- **Deleting an occasion's rules does not restore the prompt within the same year.** Answering
  retires the row by soft delete, `reconcile` never resurrects a tombstone, and the id is keyed on
  the occurrence year. Undoing that needs a runtime hard delete, which no repo has and which a
  peer's tombstone would re-pull on the next sync. The prompt returns next year.
- **Every schedule save re-stamps `writtenAt`.** `replaceForBearer` rewrites the whole set, so
  saving from the schedule editor inside an occasion's late window counts as a late answer: errands
  may slide for that year, and a set missing an offer that no longer fitted asks again next year,
  once.
- **Editing a milestone's date is not "newly learned".** Only `createdAt` counts, so moving a
  birthday to next week can produce a question that is overdue at once. `updatedAt` would be wrong
  for it — any edit at all would reset it.
- **Holiday errands do not slide.** The observance walk has no learned date wired in. Its shipped
  rules are all off, so nothing reaches this today.
- **Not every kind prompts.** `death` must not — a checkbox list of ways to recognise a death
  anniversary is exactly the wrong object, and its single quiet `remember` is already right. The
  same reasoning excludes any kind offering one action: a question with one answer is not a
  question. Adding a kind is one `kindDefs` line.

## Schedules — where a rule comes from

A schedule is set on the **occasion** — one milestone, or one (person, holiday) observance — or it
is the **shipped default** for that kind (`kindDefs[kind].defaultReminderSchedule`,
`observanceDefaultReminderSchedule`). Two levels. `resolveReminderSchedule` and
`resolveObservanceReminderSchedule` therefore resolve all-or-nothing: stored rows win wholesale,
because there is exactly one level a user can write.

### There are no per-person and no per-kind defaults _(owner, 2026-09-05)_

An earlier design had four levels — this occasion, this person, all birthdays, the shipped default —
resolved per action, with the winning level shown on the row. It was cut before any of it was built.
The reasoning is recorded because it is an easy idea to have again.

A per-person default has to hold across **everything that person has**: their birthday and Arbor Day
alike. Those are not the same occasion and do not carry the same weight, so "for Violet: a gift, a
card and a call" is a rule that pretends they do. The variation that matters is between _occasions_,
which is what the occasion level already expresses — and where someone genuinely does want the same
treatment everywhere, saying so per occasion is a handful of taps rather than a system. A per-_kind_
default ("all birthdays") loses the same argument one size up: the people in a life vary more than
one setting can absorb.

⚠️ **What that spares the code is the point**, because a second writable level is not one more
lookup:

- Resolution would have to become **per action**. All-or-nothing is correct only while one level
  exists; with two, setting a person default would silently wipe an occasion's schedule.
- Every writer would have to emit a **complete** set. An action a set omits would fall _through_ to
  the level above and switch itself back **on** — so the schedule editor's Remove button, which
  means _off_ today, would quietly come to mean _inherit_.
- Existing partial rule sets would need a migration to keep the meaning they were saved with.
- A "kind" level is the one bearer that is not a row, so `bearerId` would have to stop being a
  `z.uuid()` and start accepting a keyword.

None of that exists and none of it is coming. `reminderRuleBearerTypeSchema` stays
`milestone | observance` — its "adding one is a Zod-only change" note is about a new kind of
_occasion_, not a new level — and every bearer stays a real row with a real id.

### ⚠️ Do not model rule dependencies

"Get the gift 3–7 days before the card goes in the post" is a real thought while you are _choosing_
offsets, and it must not survive into the data. Literal dependencies need ordering, cycle detection,
and an answer for what happens when the depended-on rule is disabled — all to express something set
once. Do the arithmetic wherever the numbers are chosen and store plain offsets. "Where in the world
is it going" is an input to that arithmetic, never a runtime lookup.

**What keeps them in order instead is monotonicity** _(owner, 2026-09-12)_. The authored offsets
already say what comes first — buying a card at 12 leads posting it at 7 — so the guarantee is not
_"A depends on B"_ but _"nothing derived may reorder what the offsets encode"_:

- **Derivation preserves order.** `effectiveOffsets` applies the slide to the whole enabled set and
  refuses to move a rule past one authored to follow it. This is total: it holds for every pair,
  including ones nobody declared a relation for, so "make the reservation" before "go to dinner"
  needs no new machinery — just the wider offset.
- **The authored numbers are checked once, at build time**, against the `deliveryOf` edges the
  registry already declares (`plan-offers.test.ts`). Monotonicity preserves an order; this is what
  makes that order right to begin with, and it fails the day a schedule authors a delivery ahead of
  the thing it delivers.
- **Disabled rules ask no question.** They are not in the set, so they constrain nothing — the
  third of the three costs above, and it disappears rather than being answered.

The edges stay a **static relation between actions** in the registry, never a row in
`reminder_rules`. That is the line: no dependency ever reaches the data, and no date is ever
computed by following one.

### ⚠️ A redundant action is suppressed in the read, never in the desired set

`wish` means _some acknowledgment, unspecified_, so a specific day-of action arguably makes it
redundant. If that is ever built, suppress it **where the row is rendered**. Dropping it from the
desired set instead reaches the worst failure this package has: `reconcile` retires an unwanted row
by soft delete and never resurrects a tombstone, and a system reminder's id is keyed on the
occurrence **year** — so ticking a specific action would kill the wish for the rest of the year, and
unticking it could not bring the row back. A written `enabled: false` rule gets there by the other
road.

Nothing triggers this today: the channel actions are unschedulable, so the only day-of action that
could is `visit`, and whether visiting someone silences the wish is one arguable case rather than a
rule worth building. The warning is here for the day channel-specific actions return.

## Collecting what is missing

Most of this package reminds you of things it knows. One family does the opposite: it asks for
something it does not. You recorded a spouse; the app does not know your anniversary, and waiting
will not teach it one. So it asks — once, in the place you already look, worded by what it does
know.

The general principle, which is the same one _a nudge, never a wall_ serves from the other side:
**incomplete data is a normal state, not a blocked one.** A reminder about someone you cannot reach
still fires, and offers to collect a way. An anniversary of your own with nobody attached still
fires. Nothing waits for a complete record, and every row is a place to complete one.

### ⚠️ The rule that stops this eating the home screen

Collection nudges **compound**. Each is cheap alone; six of them turn Home into a form, which is the
failure the whole prompt design exists to avoid. So:

> A collection nudge earns its place only where the missing datum blocks something the user has
> **already said they want**.

Recording a spouse is that declaration — you entered the relationship, so the date is a gap in
something you asked for. "This person has no birthday" is not, and would be forty rows. Weigh any
new one against that sentence before adding it.

### Asking the wrong question is worse than asking none

The question is worded from the relationship's own role: a `spouse` is missing a **wedding
anniversary**, a `partner` is missing a **first date** (`isRomanticRole` and `baseRole` in
`@leapsake/schema`, so `husband`/`wife` reach it too). Asking an unmarried couple when their wedding
anniversary is has the app inventing a marriage — a worse failure than silence, and the reason the
kind travels on the row rather than being guessed at the far end.

The tense follows from the same fact: an anniversary _comes round_ ("when **is**"), a first date
happened once ("when **was**").

### Two things that would make it re-ask, and do not

- ⚠️ **A date recorded on _either_ bearer counts as known.** A wedding lives on the person until its
  other party exists and on the relationship afterwards — `MilestoneRebind` is the flow between them
  — so checking one bearer would re-ask for a date already given. That is the worst thing a
  collection nudge can do, and the check reads both.
- **The id carries the kind, not just the relationship.** Dismissing "when was your first date?" is
  a dismissal of _that question_; a couple who later marry are still asked their anniversary.

### The same question from the other side

A wedding can be recorded from one person's page before its other party is in the app at all — the
create form offers "unknown" for it, and for nothing else. So there are two shapes of the same gap,
and they are duals: the partnership question knows the couple and wants the date; the unbound
wedding knows the date and wants the couple, and offers to collect it
(`linkPartners` in `@leapsake/core`).

⚠️ **Weddings only.** A `first-date` or a `met` stored on a person _is_ about that person, so asking
who it is with would be asking a question whose answer is already the row.

⚠️ **That one costs no row.** It is an affordance on a reminder that already exists — like the
contact-collection CTA — so it is not weighed against the compounding rule above, which is about
rows that ask for screen space of their own.

⚠️ **And it is the one offer shown _beside_ a row's main action rather than instead of it** _(owner,
2026-09-05)_. A row offers the highest-ranked call to action that applies, and this one sits below
both the question and the gift — so it used to surface only where nothing outranked it: the day-of
wish, a few days a year. Answer the prompt with only "get a gift" and it never appeared at all.
Doubling up is safe here precisely because it completes a _record_ rather than doing the errand, so
it never competes with the row's own point. Two CTAs on one row is also why `reminderActionKey`
exists: `kind` alone stopped being unique, and duplicate React keys reconcile wrongly rather than
loudly.

The two clients send the user to different places, deliberately and for a documented reason: desktop
has a rebind screen that re-points the milestone onto the relationship, and this client does not,
so it goes to the relationship form instead. Recording the spouse is the part that matters — a
milestone left on the person keeps working, now that a relationship bearer works too. Rebinding is
tidying.

### The question's wording, and the possessive that was a factual error

"How do you want to **mark** X?" became "What do you want to **do for** X?" _(owner, 2026-09-05)_.
"Mark" was picked to stay neutral across every action the question offers, and that neutrality is
what made it vague: it never said what was being asked, so the row had to be opened to find out.

⚠️ **The bigger fix was the possessive.** The template is written in the third person about a second
party — "@Violet's first date" — and for a shared occasion that is not vague, it is **wrong**. A first
date is not Violet's; it is _yours, with Violet_, and the possessive states that she had one with
somebody else. Three shapes, all in `planQuestion` in `@leapsake/schema`:

|                        | Reads                              |
| ---------------------- | ---------------------------------- |
| The subject is you     | "your own wedding anniversary"     |
| The occasion is shared | "your first date **with @Violet**" |
| Anyone else's          | "@Harry's birthday"                |

Shared is decided two ways, and both are needed: a **gated** kind's bearer being someone else (the
gate has already established the partnership is the user's), or any milestone borne by a
**relationship the user is in** — an `anniversary` on your own marriage is not "Violet's anniversary",
whatever its kind.

⚠️ **`planQuestion` is centralised because the question was written twice and had begun to differ.**
The engine renders the row's title; `MilestonePlanPrompt` renders its own heading. Both now go
through the one function, so a wording change cannot leave the screen that answers a prompt saying
something else about the same occasion — the drift `renderTitle` and `SCHEDULABLE_ACTIONS` were each
centralised to prevent.

### It has to be escapable

A dateless row is _owed_, and owed rows gate "done for the day" — so a question that could not be
put off would keep the day unfinishable for as long as the user declined to answer it. It can be put
off like any row, and being put off never retires it — only its answer does, or _don't ask again_.
⚠️ That is a tombstone and the id carries no year, so — exactly as for the onboarding nudges — a
dismissal is **permanent**.

Its answer is one tap from the row: the CTA opens the milestone form already on the kind the
question asked about (`?kind=`, guarded by `isMilestoneKind` since it arrives from a URL). A
question that lands the user on a blank kind picker has handed the question back to the person who
was just asked it.

## The onboarding nudges — the product design behind them

The mechanics are documented on the code. This section records the _reasoning_, which the code
cannot carry and which took several drafts to get right.

### Standing nudges, not a Day-1 flow

A first-run wizard was designed in full and **rejected**. It asked the user to make decisions
before they had any reason to care about them, and it front-loaded exactly the setup a
zero-setup first run exists to avoid. The nudges replace it: each step stands on Home while its
condition is unmet, and retires when it is met. Sequencing is carried by **display order**, not
by a flow.

The corollary is a rule worth keeping: **a nudge, never a wall.** A forced setup at first run
violates the layperson/no-hoops principle and would forfeit the zero-setup first run that is the
point of the Unauthenticated state.

### Putting a step off never retires it _(owner, 2026-09-11)_

A step goes when its condition is met or when the user says _don't ask again_ — never because it
was put off some number of times. Each step used to carry a budget of *not now*s and a snooze length
of its own, and retired itself once the budget ran out; both were cut. The budget made the gentle
option quietly permanent, and how long to wait is now the user's to say: every row, whatever made
it, offers the same _Remind me tomorrow / in 3 days / next week_ (`snoozeTargetOf` here, the presets
in `@leapsake/view-models`), always to the start of that day.

_Don't ask again_ is offered from the first sighting. It used to be withheld until the row had been
put off once, so a permanent choice was never the first a layperson saw; the confirmation that
follows it says plainly what it does, and it is now the only way a step goes for good undone.

The asymmetry that set the old dials still holds — wrongly _silencing_ a step costs more than
wrongly nagging, because the user never learns the feature exists and nothing surfaces to tell
anyone — and it now argues for keeping a step alive until someone answers it, rather than for
tuning how often it comes back.

### The account invitation

`create-account` is the step that gets a user from Unauthenticated to Authenticated — the state
that turns encryption on. Two decisions in it are easy to get wrong on a re-read:

- **It promises access, not safety.** An Unauthenticated store is plaintext with _no keys_, so
  there is nothing yet to be locked out of; an account protects access, and a **backup** is what
  protects against losing the device (`plans/encryption/model.md` §7.2.1). Calling it a data-loss
  fix was the old plan's mistake for two drafts, and the copy still has to hold this line.
- **It stands from day one.** `applies: !hasAccount`. It used to wait for data
  (`hasEntitiesBesidesSelf && !hasAccount`), which guaranteed the import landed in a plaintext
  store before anyone was asked to encrypt it — and the conversion that follows cannot scrub
  those bytes out of free space (`plans/encryption/model.md` §12).

### A step that waits on another step isn't standing on its own _(2026-09-10)_

`pick-self` read `hasEntities && !hasSelf` and asked _"which of these is you?"_ — a question that
can only be asked of a list, and so a step that could only appear once the user had already done
something else. Two things were wrong with that, and they compounded.

It made the step **dependent**: nothing about knowing who you are requires anyone else to exist,
yet the app could not ask until somebody did. And it made the first person a **punishment** —
adding one retired the getting-started nudge and raised three in its place (account, pick-self,
notifications), so the reward for a first action was a longer list than before. That is exactly
the compounding _the rule that stops this eating the home screen_ warns about, arriving through
the onboarding family rather than the collection one.

The fix was to change the question rather than the schedule. **"Tell us about yourself"** is
answerable from an empty store, because its screen takes the answer as a form as well as a pick:
a typeahead when there are people, the offer to import when there are none, and the create fields
underneath either way. So the condition became `!hasSelf` and nothing else, and the step now
stands from day one beside the import invitation — two rows, each answerable without the other.

⚠️ **That is what forced `hasEntitiesBesidesSelf`.** Answering _who are you_ creates a person, and
under a plain `hasEntities` that would have retired the invitation to import — permanently, by
tombstone — for having answered a different question. It is also the truer signal: a store holding
nothing but your own name is an empty personal CRM, and the steps that wait for "data worth
protecting" or "something to be notified about" mean data about _other people_. It replaced
`hasEntities` outright; nothing else was left using it.

### Store what happened, never what to do next

State is one column on `reminders` (`snoozed_until`) and its tombstone, not a decision table. _Did the user do it?_ stays **derived**
from the store — `hasAnyEntity`, `hasSelf`, `hasAccount` — so it cannot drift
from reality. Only what the user _answered_ is recorded. One verb, one write method.

This is also why **retirement is permanent**: it is a `softDelete` tombstone, so a step does not
re-appear if its condition later reverts (the user deletes all their people). That is the correct
"don't re-nag" semantic, and it is the same path whether a step retired because its condition was
met or because the user dismissed it.

### Onboarding defer _is_ reminder snooze

There are not two kinds of "later". Collapsing them was the change that made the whole design
work: the snooze mechanism the reminder surface already needed is exactly the mechanism
onboarding needs, so there is one implementation and one set of semantics.

### Merge safety

Every device mints the nudges under the same deterministic id, so a device that minted before it
pulled could out-rank a peer's dismissal on `updated_at` and undo it. **An untouched row never
wins a merge** — via an opt-in per-table `hasHistory` predicate the sync substrate grew for this.

### The notifications nudge asks a per-device question with a store-scoped condition

`enable-notifications` applies while **no device** has a `notification_settings` row — a row
exists only once a device has been given a policy or has answered the OS prompt, so "no rows"
is "nobody has ever been asked". That is exactly right on one device and wrong on two: the
device that turns notifications on retires the row for everybody.

⚠️ **It is not a shortcut, it is the only expressible condition today.** Onboarding rows sync,
and `reconcile` tombstones any active `system` row the desired set does not want —
_permanently_. So a device computing "does not apply" kills the row for its peers, and
namespacing the id per device only moves the problem: device one prunes device two's row for
the same reason. Nor could the desired set be built per device, because a device that has never
been asked has **no row to be enumerated from**, and the `device` table is account-bound
(migration 14) while this nudge fires in the accountless first-run state. There is nothing to
enumerate by construction until multi-device brings a registry that spans it.

Two things for whoever picks this up: the family needs a per-device notion _before_ the nudge
can have one, and the new ids must honour the old fixed id's tombstone once — otherwise a user
who said _don't ask again_ is asked again on the upgrade.

### Known limitation

Nudge display order only holds **within a single reconcile**. Cosmetic, and deliberately
deprioritized.
