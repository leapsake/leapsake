import * as Notifications from "expo-notifications";
import type {
  DesiredNotification,
  NotificationScheduler,
  PendingNotification,
} from "@leapsake/notifications";

/**
 * The `NotificationScheduler` port ({@link NotificationScheduler}) extended
 * with the one OS read `@leapsake/notifications`' `reconcile` needs before it
 * can diff: what's actually pending. Not part of the pure package's port
 * (`schedule`/`cancel` only) because "what's pending" is a real OS call, not
 * something `reconcile` drives — it's the caller's job to read it first.
 */
export interface MobileNotificationScheduler extends NotificationScheduler {
  listPending(): Promise<PendingNotification[]>;
}

/**
 * The `expo-notifications`-backed implementation (Inc 3 §3,
 * `plans/v0-1_08_local-notifications.md`). `schedule`/`cancel` drive the OS
 * directly, addressing each notification by `DesiredNotification.id` — the
 * same id `@leapsake/notifications`' `reconcile` computed, passed straight
 * through as `NotificationRequestInput.identifier` rather than letting the OS
 * mint its own, so a later `cancel(id)` can find it again.
 *
 * No `channelId` is set on the Android trigger: §2 (the config plugin) hasn't
 * declared a channel yet, so this rides whatever default `expo-notifications`
 * falls back to. Once §2 lands a real channel, thread its id through here.
 */
export function expoNotificationScheduler(): MobileNotificationScheduler {
  return {
    async schedule(notification: DesiredNotification): Promise<void> {
      await Notifications.scheduleNotificationAsync({
        identifier: notification.id,
        content: {
          title: notification.title,
          body: notification.body,
          data:
            notification.reminderId === null
              ? {}
              : { reminderId: notification.reminderId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: notification.fireAt,
        },
      });
    },
    async cancel(id: string): Promise<void> {
      await Notifications.cancelScheduledNotificationAsync(id);
    },
    async listPending(): Promise<PendingNotification[]> {
      const requests = await Notifications.getAllScheduledNotificationsAsync();
      return requests.map((r) => ({
        id: r.identifier,
        fireAt: fireAtFromTrigger(r.trigger),
        title: r.content.title ?? "",
        body: r.content.body ?? "",
      }));
    },
  };
}

/**
 * Every trigger this adapter ever schedules is
 * `SchedulableTriggerInputTypes.DATE` — `getAllScheduledNotificationsAsync`
 * echoes that same shape back (unlike `CALENDAR`, which iOS would otherwise
 * decompose into date components), so reading `date` straight back is exact,
 * not reconstructed. `NaN` for anything else — shouldn't happen, since
 * nothing here schedules another trigger type — so `reconcile`'s
 * `fireAt === fireAt` drift check always fails for it and the entry is safely
 * replaced rather than kept under a guessed time.
 */
function fireAtFromTrigger(trigger: Notifications.NotificationTrigger): number {
  if (
    trigger !== null &&
    typeof trigger === "object" &&
    "type" in trigger &&
    trigger.type === "date" &&
    "date" in trigger
  ) {
    const date = trigger.date;
    return date instanceof Date ? date.getTime() : date;
  }
  return Number.NaN;
}
