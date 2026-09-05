# `@leapsake/reminders`

The engine that mints, refreshes, and retires **`system` reminders** — rows the app owns rather
than the user. Four families feed one reconcile: milestone reminders (birthdays and the like),
holiday-observance reminders, the dateless **onboarding nudges**, and the duplicate-pairs nudge.

It has no `@leapsake/core` or `@leapsake/data` dependency. Everything it needs arrives through
small injected ports (`ReminderEngineDeps`), so it stays independently testable and narrowly
scoped. The composition root wires the repos.

## Where to look

| You want | Read |
|---|---|
| How reconcile decides what to insert, refresh, or tombstone | `computeDesired` + `reconcile` in `src/engine.ts` |
| When a reminder goes on display, and when it stops | `isWithinWindow` in `src/engine.ts` |
| How long a given errand sits on the list | `activeDays` on `actionDefs`, in `@leapsake/schema` |
| How far ahead the *list* looks, versus the *notification schedule* | `DISPLAY_WINDOW_DAYS` and `NOTIFICATION_WINDOW_DAYS` in `src/engine.ts` |
| What a row can say about its own timing once it leaves the engine | `ReminderWindowFacts` in `src/engine.ts` |
| Why a not-yet-active reminder can still be ticked | `materializeReminder` in `src/engine.ts` |
| The onboarding nudge definitions and their copy | `ONBOARDING_STEPS` in `src/engine.ts` |
| How snooze budgets are read | `snoozePolicyOf`, beside `ONBOARDING_STEPS` |
| Why a second desired-row family is a parallel port, not a widened one | the `holidays` port doc-comment in `ReminderEngineDeps` |

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
the morning it is owed. A `gift` is `active 30` whatever the occasion, because a gift is a project.

**The numbers themselves are data, not architecture** — the same posture as the snooze dials below,
and for the same reason. They are one owner's estimates and expect to be corrected against real
use; changing one is editing a literal in `actionDefs`, never touching logic. If the eight-week
prompt in a later increment feels too early, the dial to turn is `gift`'s `activeDays`, because
that is where the pressure actually comes from.

### Two ways to miss something, and they are not the same

The old window closed at `daysUntilOccurrence >= 0`, so a missed birthday **disappeared the next
morning**: the app noticed and said nothing. A list that cannot tell you when you dropped something
is a list you stop trusting.

The new window closes on the **occurrence** rather than on the rule's own due date, plus a short
grace tail (`BELATED_DAYS`). That single change names both failure modes, with nothing stored and
nothing extra computed — both fall out of the arithmetic the aliveness test already does:

| state | test | means |
|---|---|---|
| **past due** | `daysUntilDue < 0`, occurrence still ahead | the deadline blew but it is **still salvageable** — the card missed its post date, but the birthday is Tuesday, so pay for express |
| **belated** | `daysUntilOccurrence < 0` | the occasion has passed; only acknowledgment is left |

It falls out per action with no configuration. A day-of action's due date *is* the occurrence, so it
can never be past due and goes straight to belated; a `card` at `offset 7` is past due for up to a
week first. `BELATED_DAYS` bounds **only** the belated tail — past due needs no dial of its own,
because the occurrence bounds it.

Holding the window open to the occurrence is also what keeps a long errand honest: an unbought gift
due twelve days before a birthday stays on your list right up to the birthday, rather than vanishing
on the day its own deadline slipped.

Reaching the belated state needed one thing the date math could not do. A recurring occurrence rolls
to *next year* the morning after it passes, so nothing looking forward can ever report "yesterday" —
hence `recentOccurrence` in `@leapsake/schema`, walked alongside `nextOccurrence`. It answers
strictly *before* today, so the two are disjoint and no occurrence is ever considered twice. The
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
  salvageable — nothing has *passed* — so it reads as past due. Belated needs a known
  occasion that has gone.

### Three windows, and why none of them is the others

| window | asks | answer |
|---|---|---|
| `activeDays` (per action) | what should be a **row** today | the errand's own run-up |
| `DISPLAY_WINDOW_DAYS` | what is worth **previewing** to someone looking at the list | 30 days |
| `NOTIFICATION_WINDOW_DAYS` | what could come due before the schedule is **rebuilt** | a year |

One walk (`computeDesired`) serves all three, parameterised by `ActiveDaysOf` — a second
implementation of the id derivation or the window filter would drift the day either changed.
⚠️ `DISPLAY_WINDOW_DAYS` must stay at or above `MAX_ACTIVE_DAYS`, or a row the
materialization walk already minted would fall out of the read that feeds the screen; the
test asserts it.

Previewing is not the same as forbidding. **Everything can be done early** — the window
governs when the app *prompts* you, never what you are allowed to do — so a preview row is
tickable, and `materializeReminder` mints the row being ticked. ⚠️ Doing so **retires the
errand for the year**: the next reconcile does not want that row yet and prunes it to a
tombstone, which is never resurrected. That is the intended reading, and it is permanent.

### Known limitation

`BELATED_DAYS` is one dial for every action. A missed phone call is arguably stale sooner than a
missed gift, and per-action belated windows are a plausible refinement — deliberately not built
before there is evidence about which actions want what.

## The onboarding nudges — the product design behind them

The mechanics are documented on the code. This section records the *reasoning*, which the code
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

### The steps have unequal stakes, and that asymmetry sets the dials

Wrongly *nagging* costs annoyance the user can dismiss. Wrongly *silencing* a step costs
something that gives **no signal it happened** — the user simply never learns the feature exists,
and nothing surfaces to tell anyone. The two errors are not symmetric, so where a step's budget
is unclear it gets another repetition rather than fewer.

Two consequences, both already enforced in code:

- **The floor is two *not now*s, never one** *(owner, 2026-08-01)*. At 1 the gentle-looking
  option is the permanent one, and *don't ask again* — withheld on a first encounter precisely so
  a permanent choice is never a trap — is then never offered at all. Read `snoozeRepetitions` as
  *not nows accepted*, not *times it returns*; the two readings differ by one.
- **The dials are data, not architecture.** Changing one is editing a literal. Expect to correct
  them once real usage disagrees.

Exactly one step sits above the floor: **the account invitation**, at three. It is the step whose
wrong-silencing leaves a user's data in the clear with nothing to signal it, so it is where the
asymmetry above is actually spent.

### The account invitation, and the fork it is half of

`create-account` is the step that gets a user from Unauthenticated to Authenticated — the state
that turns encryption on. Three decisions in it are easy to get wrong on a re-read:

- **It promises access, not safety.** An Unauthenticated store is plaintext with *no keys*, so
  there is nothing yet to be locked out of; an account protects access, and a **backup** is what
  protects against losing the device (`plans/encryption/model.md` §7.2.1). Calling it a data-loss
  fix was the old plan's mistake for two drafts, and the copy still has to hold this line.
- **It waits for data, not for days.** `applies: hasEntities && !hasAccount`. Gating on data is
  what puts the invitation in front of someone who imported 200 contacts on day one — the moment
  the account matters most, and exactly the moment an elapsed-time floor would mute it. "Day 2 or
  3" is the expected *effect* of the data gate, not a second condition. If a floor is ever wanted
  it needs no new column: `sync-devices` is minted at the first reconcile, so its `createdAt`
  **is** the install date.
- **It is one half of a fork, not a second similar offer.** The other half is `sync-devices`,
  which stands from day one and is worded *sign in*. The two mistakes cost wildly different
  amounts: signing in when you should have created self-corrects (the lookup branches you to
  signup), whereas creating when you should have signed in was, until the account merge landed
  *(2026-08-08)*, a one-way street. Ordering alone cannot fix that — both rows are on Home
  together — so the **wording carries the load**, and "connect to sync" was our vocabulary rather
  than the returning user's.

`sync-devices` therefore retires on **`hasAccount || syncConnected`**, not on a bound relay alone.
Both nudges deep-link to the same Settings screen, and retiring only on `relayUrl` left a user who
created a *local-only* account being nudged toward a flow that could no longer satisfy it.

The stronger guard — the create screen itself opening with *"do you already have an account on
another device?"* — was weighed and deferred to v0.2 with the Settings decomposition. It catches
every route in, including Settings visited directly, but it is not worth the launch clock now that
the wrong turn is recoverable.

### Store what happened, never what to do next

State is two columns on `reminders`, not a decision table. *Did the user do it?* stays **derived**
from the store — `hasAnyEntity`, `isSyncConnected`, `hasSelf`, `hasAccount` — so it cannot drift
from reality. Only what the user *answered* is recorded. One verb, one write method.

`isSyncConnected` and `hasAccount` are two reads of one account singleton and stay separate
deliberately: the account exists as soon as one is created, but `relayUrl` is set only when it is
also bound to a relay. A local-only account is the case that tells them apart, and it is the case
both custody nudges hinge on.

This is also why **retirement is permanent**: it is a `softDelete` tombstone, so a step does not
re-appear if its condition later reverts (the user deletes all their people). That is the correct
"don't re-nag" semantic, and it is the same path whether a step retired because its condition was
met or because it exhausted its budget.

### Onboarding defer *is* reminder snooze

There are not two kinds of "later". Collapsing them was the change that made the whole design
work: the snooze mechanism the reminder surface already needed is exactly the mechanism
onboarding needs, so there is one implementation and one set of semantics.

### Merge safety

Every device mints the nudges under the same deterministic id, so a device that minted before it
pulled could out-rank a peer's dismissal on `updated_at` and undo it. **An untouched row never
wins a merge** — via an opt-in per-table `hasHistory` predicate the sync substrate grew for this.

### Known limitation

Nudge display order only holds **within a single reconcile**. Cosmetic, and deliberately
deprioritized.
