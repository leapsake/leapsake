# Reminders and notifications — what is unbuilt

How the shipped engine works — the prompt, the windows, the `verb:qualifier` identity split — is in
[`@leapsake/reminders`](../packages/reminders/README.md). This is only what was deferred.

⚠️ **Read that README's _Schedules_ section before any of these tempts you toward a per-person or
per-kind default.** The four-level cascade was cut on 2026-09-05, and the argument against it — plus
the four things a second writable level would drag in — is recorded there.

- **Reminder search.** Reminders join `SearchResultType` the way gift ideas did, matched on
  title + body. The last piece of the reminders surface.
  > Needs a deliberate answer first: **snoozed** rows are hidden from Home — should they be
  > findable by search? See [`../packages/reminders/README.md`](../packages/reminders/README.md).
- **The offer-set differ.** An answered prompt stores the **full** set it was offered, so the record
  of what was offered already exists; nothing compares it against today's set, so an action that
  becomes available later never re-asks.
- **Batching milestone prompts — declined** _(owner, 2026-09-11)_. Three birthdays in one
  fortnight stay three `plan` rows, and so does a contact import that raises thirty at once. A
  milestone's question is about **one person or pet and one occasion**, because that is the unit
  the decision is made in: "you have 12 birthdays in the next 6 weeks" is borderline inactionable,
  since nobody decides what to do for twelve people at once, only for Violet, then for Harry. The
  import flood that made batching tempting is a **timing** problem, not a grouping one — a
  question that arrives inside its own lead time was being shown as already late — and was fixed
  on the question's deadline instead (2026-09-11; the reminders README, _You can't be late for
  something the app has only just learned_). ⚠️ A communal question is
  right only where **one occasion genuinely spans everyone**: the holiday prompt (the holidays
  README) is that case, and stays the only one. Do not reuse its
  shape for person-specific milestones.
- **Presets — one human question instead of typed offsets. Considered and declined** _(owner,
  2026-09-05)_. "Am I seeing them, or posting it?" picks a rule set: posting wants the gift further
  out and the card in the post a week ahead; seeing them wants neither deadline. With no person
  level to hang it on it could only ever be a **second question on the prompt**, never a surface of
  its own — and the prompt's tickboxes already say _what_ you will do, so all this adds is moving
  the dates by a few days. That is a poor trade against the design's stated risk, that answering
  the prompt must stay a five-second decision (the README, _A question costs more than a row_).
  **The trigger for revisiting** is real use showing the posted-card deadline actually bites: one
  set of offsets that runs slightly early for people you will see is the accepted cost until then.
  ⚠️ If it returns, whatever picks the numbers does the arithmetic itself and stores plain offsets
  (the README, on rule dependencies).
- **Channel-aware reminder copy** — "Text A happy birthday" where a number is the only way to reach
  someone. Dropped with the channel actions _(owner, 2026-09-05)_: it needs a `reach` port on the
  engine, sentence variants beside `actionDefs.wish`, and a `@leapsake/contact-links` dependency in
  `@leapsake/core`. The ways to reach someone are buttons rendered from `reminders.targets` instead.
- **A configurable in-person deadline** _(owner, 2026-09-11)_. A gift or card started too late to
  post slides to the day before the occasion, to be handed over in person (`latestOffsetDays` on
  `actionDefs`). The owner wants that day configurable eventually; it is one literal until there is
  somewhere to set it.
- **Per-action grace periods**, **snooze for user reminders** (the open question on
  `partitionReminders`' doc-comment), and **user-defined milestone kinds**.

## Notifications

- **Let onboarding nudges notify** _(owner, 2026-08-24)_. `planNotifications` bars them today
  (`onboardingRouteOf(r.id) === null`, `packages/notifications/src/planner.ts`), on the principle
  that "come do something in the app" prompts don't get to interrupt you _outside_ the app. The
  case for revisiting: a user who turns notifications **on** and then never finishes onboarding
  has opted into being told things, and finishing setup is the one thing that makes the rest of
  the app work for them. The running-out notice already carves one exception to that rule — but
  on a narrower basis (a _service notice_: something you asked for is about to stop), so it does
  not settle this. Not urgent; the line to hold either way is service notice vs. re-engagement.
- **Notification privacy levels.** `notification_settings` (migration 29) deliberately has no
  `privacy` column — notification text carries full context today and trusts the OS's own
  lock-screen preview setting. Owner has it as a future want; adding the column later is a cheap
  migration, and guessing its shape now was not worth it. See
  [`@leapsake/notifications`](../packages/notifications/README.md).
- **Desktop local-notifications applier.** `@leapsake/notifications`'s planner and reconcile are
  platform-free by design, and `notification_settings` is device-keyed precisely so an Electron
  applier (`Notification`) drops in later — mobile-only today. A device with no row is `off`, so
  desktop simply does not appear under _Other devices_ until it ships one. Until then the
  `enable-notifications` onboarding nudge can never be satisfied on desktop and stands for good,
  pointing at a Settings screen with nothing to answer it: gate the step, or ship the applier.
