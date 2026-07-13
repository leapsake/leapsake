/**
 * `@leapsake/reminders` — the orchestration for **automated (`system`)
 * reminders**, kept as its own narrowly-scoped, independently-testable unit
 * outside `@leapsake/core`. It owns computing the desired set of system
 * reminders for "today" and the idempotent, tombstone-respecting reconcile that
 * makes the store match it.
 *
 * It depends only on `@leapsake/schema` (the pure occurrence/civil-date math and
 * the milestone kind registry) and `@leapsake/crypto` (the deterministic id), and
 * on a handful of small **injected ports** ({@link ReminderEngineDeps}) — never
 * on `@leapsake/core` or `@leapsake/data`. The composition root (`@leapsake/core`)
 * constructs the real ports over its repos and calls the engine.
 */
export {
  LEAD_DAYS,
  SYSTEM_REMINDER_NAMESPACE,
  regenerateSystemReminders,
} from "./engine.js";
export type { ReminderEngineDeps, SystemReminderStore } from "./engine.js";
