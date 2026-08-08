# `@leapsake/reminders`

The engine that mints, refreshes, and retires **`system` reminders** — rows the app owns rather
than the user. Three families feed one reconcile: milestone reminders (birthdays and the like),
holiday-observance reminders, and the dateless **onboarding nudges**.

It has no `@leapsake/core` or `@leapsake/data` dependency. Everything it needs arrives through
small injected ports (`ReminderEngineDeps`), so it stays independently testable and narrowly
scoped. The composition root wires the repos.

## Where to look

| You want | Read |
|---|---|
| How reconcile decides what to insert, refresh, or tombstone | `computeAndReconcile` in `src/engine.ts` |
| The onboarding nudge definitions and their copy | `ONBOARDING_STEPS` in `src/engine.ts` |
| How snooze budgets are read | `snoozePolicyOf`, beside `ONBOARDING_STEPS` |
| Why a second desired-row family is a parallel port, not a widened one | the `holidays` port doc-comment in `ReminderEngineDeps` |

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
