# Reminders and notifications — what is unbuilt

How the shipped engine works — the prompt, the windows, the `verb:qualifier` identity split — is in
[`@leapsake/reminders`](../packages/reminders/README.md). This is only what was deferred.

- **The offer-set differ.** An answered prompt stores the **full** set it was offered, so the record
  of what was offered already exists; nothing compares it against today's set, so an action that
  becomes available later never re-asks.
- **A configurable in-person deadline** _(owner, 2026-09-11)_. A gift or card started too late to
  post slides to the day before the occasion, to be handed over in person (`latestOffsetDays` on
  `actionDefs`). The owner wants that day configurable eventually; it is one literal until there is
  somewhere to set it.
- **Per-action grace periods**, **snooze for user reminders** (the open question on
  `partitionReminders`' doc-comment), and **user-defined milestone kinds**.

## Notifications

- **Let onboarding nudges notify** _(owner, 2026-08-24)_. `planNotifications` bars them today
  (`packages/notifications/src/planner.ts`). Undecided: a user who turned notifications on but
  never finished onboarding has asked to be told things. If nudges do notify, the line to hold is
  service notice vs. re-engagement.
- **Notification privacy levels.** Notification text carries full context and relies on the OS's
  lock-screen preview setting; it wants a `privacy` column on `notification_settings`.
- **Desktop local-notifications applier**, an Electron `Notification` over the platform-free
  planner and reconcile. Until it ships, desktop's `enable-notifications` onboarding nudge can
  never be satisfied: gate the step, or ship the applier.
