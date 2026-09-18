import { z } from "zod";

/**
 * How a device wants its reminders to reach it when the app isn't open.
 * `off` is the default on a fresh
 * install; `digest` bundles a day's reminders into one 09:00 notification;
 * `each` explodes the same content into one notification per reminder — it is
 * not more timely, only a tap target per item.
 */
export const notificationModeSchema = z.enum(["off", "digest", "each"]);
export type NotificationMode = z.infer<typeof notificationModeSchema>;

/**
 * A device's local-notification policy — one row per device, synced so it is
 * editable from any device (migration 29). **`id` holds the device id**, not a
 * freshly minted row id: mirrors `self_person`'s fixed-PK precedent, riding the
 * standard `EntityRepo`/`defineSyncable` machinery instead of a custom
 * `device_id` column + codec.
 *
 * `label`/`platform` are denormalized from `device` (which deliberately does
 * not sync) so the cross-device settings UI can still name the devices it
 * lists. `permissionState` is a fact about what the OS last reported to the
 * *owning* device, not a plan — written only by that device, read by every
 * device so a peer's UI doesn't lie about deliverability.
 */
export const notificationSettingsSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  platform: z.string().nullable(),
  mode: notificationModeSchema,
  deliveryMinute: z.number().int(),
  // The real OS permission values are Inc 3's (the `expo-notifications`
  // consumer's) to define — typing this now would be guessing, the same
  // reasoning migration 28 gave for leaving a column out entirely.
  permissionState: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
