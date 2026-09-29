import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type {
  DesiredNotification,
  NotificationScheduler,
  PendingNotification,
} from "@leapsake/notifications";

/** The port, plus the read of what is pending that the caller does first. */
export interface MobileNotificationScheduler extends NotificationScheduler {
  listPending(): Promise<PendingNotification[]>;
}

/**
 * The Android channel, created at module load since the config plugin cannot
 * create one; `schedule` awaits it. A no-op on iOS.
 */
const CHANNEL_ID = "reminders";

const channelReady: Promise<void> = Notifications.setNotificationChannelAsync(
  CHANNEL_ID,
  { name: "Reminders", importance: Notifications.AndroidImportance.DEFAULT },
).then(() => undefined);

/** iOS silently drops pending requests past 64; four are spare. */
export const IOS_NOTIFICATION_BUDGET = 60;

/**
 * Each is an alarm, and AOSP throws past a per-uid alarm limit (believed 500,
 * unverified on a device). Lower this if a device ever throws.
 */
export const ANDROID_NOTIFICATION_BUDGET = 200;

/** What this device can hold pending, for `planNotifications`. */
export const PLATFORM_NOTIFICATION_BUDGET =
  Platform.OS === "android"
    ? ANDROID_NOTIFICATION_BUDGET
    : IOS_NOTIFICATION_BUDGET;

/** Each request's identifier is the planner's id, so `cancel(id)` finds it. */
export function expoNotificationScheduler(): MobileNotificationScheduler {
  return {
    async schedule(notification: DesiredNotification): Promise<void> {
      await channelReady;
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
          channelId: CHANNEL_ID,
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
 * Only `DATE` triggers are scheduled, and they echo back exactly. Anything
 * else is `NaN`, which never equals itself, so `reconcile` replaces it.
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
