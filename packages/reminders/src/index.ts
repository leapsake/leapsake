/**
 * `@leapsake/reminders` — the orchestration for **automated (`system`)
 * reminders**, kept as its own narrowly-scoped, independently-testable unit
 * outside `@leapsake/core`. It owns computing the desired set of system
 * reminders for "today" and the idempotent, tombstone-respecting reconcile that
 * makes the store match it.
 *
 * `engine.ts` is the pure half: the occurrence/civil-date math, the copy, and
 * the reconcile, over a handful of small **injected ports**
 * ({@link ReminderEngineDeps}). `api.ts` is the repo-backed half — the surface a
 * client calls, and the one place those ports are built over real repositories.
 *
 * Neither depends on `@leapsake/core`. `api.ts` takes its repo interfaces from
 * `@leapsake/data`, and takes the account question and the holiday candidates as
 * injected ports rather than importing `@leapsake/key-custody` or
 * `@leapsake/holidays` — the latter would be a cycle, since holidays depends on
 * this package.
 *
 * **`api.ts` is a separate entry point (`@leapsake/reminders/api`), and this
 * barrel deliberately does not re-export it.** `@leapsake/view-models` depends
 * on this package and `@leapsake/ui` depends on that, so re-exporting the
 * repo-backed half here would pull `data` — and through it `crypto` — into the
 * type graph of a package that renders components and has no business seeing
 * either.
 */
export {
  BELATED_DAYS,
  DISPLAY_WINDOW_DAYS,
  NOTIFICATION_WINDOW_DAYS,
  ONBOARDING_REMINDERS,
  SYSTEM_REMINDER_NAMESPACE,
  duplicatesReminderId,
  getReminderInWindow,
  listNotifiableReminders,
  listRemindersInWindow,
  listSystemReminderTargets,
  materializeReminder,
  onboardingRouteOf,
  partnershipNudgeId,
  regenerateSystemReminders,
  snoozeTargetOf,
} from "./engine.js";
export type {
  HolidayBearerType,
  HolidayOccurrenceCandidate,
  OnboardingReminder,
  OnboardingRoute,
  ReminderEngineDeps,
  ReminderWindowFacts,
  SystemReminderStore,
  SystemReminderTarget,
  UndatedPartnership,
  WindowedReminder,
} from "./engine.js";
