import { Platform } from "react-native";
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
 * The one Android channel this app schedules into. Channels are an OS
 * object, not a manifest entry — `expo-notifications`' config plugin only
 * exposes a `defaultChannel` *id* for FCM's own default-channel selection,
 * nothing that actually creates one (confirmed against the installed
 * package: `withNotificationsAndroid.js` writes that id straight into an FCM
 * meta-data tag and nothing else). So "declared before it's used" means
 * created once at the top of this module, awaited by `schedule` below —
 * not, as `plans/v0-1_08_local-notifications.md` originally assumed, a
 * manifest declaration ahead of first launch. iOS has no channel concept;
 * `setNotificationChannelAsync` no-ops there (confirmed against the base,
 * non-`.android.` implementation), so this runs unconditionally.
 */
const CHANNEL_ID = "reminders";

const channelReady: Promise<void> = Notifications.setNotificationChannelAsync(
  CHANNEL_ID,
  { name: "Reminders", importance: Notifications.AndroidImportance.DEFAULT },
).then(() => undefined);

/**
 * **iOS**: Apple caps pending notification requests at 64 per app and drops
 * the excess *silently*, so overshooting is invisible from JS. 60 leaves four
 * slots spare against a notification scheduled outside the planner — which
 * today nothing does (the `expo-notifications` import is lint-fenced to this
 * file and the permission prompt), making this insurance rather than a live
 * need.
 */
export const IOS_NOTIFICATION_BUDGET = 60;

/**
 * **Android**: no equivalent per-app notification ceiling.
 * `expo-notifications` schedules each one as its own `AlarmManager` alarm
 * (`setExactAndAllowWhileIdle`, falling back to `setAndAllowWhileIdle` where
 * the app can't schedule exact alarms — `ExpoSchedulingDelegate.kt` in the
 * installed package), and nothing in that path caps the count anywhere near
 * 64. Android is therefore budgeted on its own terms, not handed iOS's number.
 *
 * It is a number rather than `Infinity` because Android's constraint is real
 * but differently shaped: AOSP's `AlarmManagerService` enforces a per-uid
 * alarm limit and *throws* past it rather than degrading, so an uncapped plan
 * would trade iOS's silent drop for an Android exception — the worse of the
 * two failures. **Unverified on a real device**: that limit is believed to be
 * 500 in current AOSP, and 200 is chosen to sit clear of it under any
 * variation rather than to track it exactly. Nothing depends on the precise
 * figure; if a device ever throws, this is the number to lower.
 */
export const ANDROID_NOTIFICATION_BUDGET = 200;

/**
 * What *this* device can hold pending, for `@leapsake/notifications`'
 * `planNotifications` — the platform half of a decision the pure planner
 * can't make for itself, resolved once here.
 */
export const PLATFORM_NOTIFICATION_BUDGET =
  Platform.OS === "android"
    ? ANDROID_NOTIFICATION_BUDGET
    : IOS_NOTIFICATION_BUDGET;

/**
 * The `expo-notifications`-backed implementation (Inc 3 §3,
 * `plans/v0-1_08_local-notifications.md`). `schedule`/`cancel` drive the OS
 * directly, addressing each notification by `DesiredNotification.id` — the
 * same id `@leapsake/notifications`' `reconcile` computed, passed straight
 * through as `NotificationRequestInput.identifier` rather than letting the OS
 * mint its own, so a later `cancel(id)` can find it again.
 */
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
