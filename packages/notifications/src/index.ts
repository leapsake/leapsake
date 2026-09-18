/**
 * `@leapsake/notifications` — the local-notification **planner**: a pure core
 * that computes
 * which OS notifications a device should have pending, and reconciles the
 * OS's actual pending set to it.
 *
 * It depends only on `@leapsake/schema` (civil-date math, `reminderLabel`) and
 * `@leapsake/reminders` (`onboardingRouteOf`, so an onboarding nudge never
 * notifies) — never on `@leapsake/core` or `@leapsake/data`, and it makes no
 * OS calls. The scheduler is an injected port ({@link NotificationScheduler}),
 * which is exactly why this isn't folded into `@leapsake/reminders`, and what
 * lets a future desktop applier share it. The composition root (Inc 3, the
 * `expo-notifications` adapter) supplies the real port and the trigger points.
 */
export { NOTIFICATION_BUDGET, planNotifications } from "./planner.js";
export type {
  DesiredNotification,
  NotifiableReminder,
  NotificationMode,
  NotificationPolicy,
  PlanOptions,
} from "./planner.js";
export { reconcile } from "./reconcile.js";
export type {
  NotificationScheduler,
  PendingNotification,
} from "./reconcile.js";
