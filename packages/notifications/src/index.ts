// `@leapsake/notifications`: the local-notification planner and reconcile,
// with no OS calls of its own; see the README.
export { NOTIFICATION_BUDGET, planNotifications } from "./planner.js";
export type {
  DesiredNotification,
  NotifiableReminder,
  NotificationMode,
  NotificationPolicy,
  PlanOptions,
} from "./planner.js";
export type {
  DigestSituation,
  NotificationCopy,
  NotificationText,
  PartOfDay,
} from "./copy.js";
export { reconcile } from "./reconcile.js";
export type {
  NotificationScheduler,
  PendingNotification,
} from "./reconcile.js";
