import { z } from "zod";

/** How a device is notified while closed: `off` or a daily `digest`. `each`
 *  parses, as v0.1 builds could store it, and is planned as `digest`. */
export const notificationModeSchema = z.enum(["off", "digest", "each"]);
export type NotificationMode = z.infer<typeof notificationModeSchema>;

/**
 * One device's notification policy, synced so any device can edit it. `id` is
 * the device id; `label` and `platform` are copied from the unsynced `device`.
 */
export const notificationSettingsSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  platform: z.string().nullable(),
  mode: notificationModeSchema,
  deliveryMinute: z.number().int(),
  // What the OS last told the owning device; only that device writes it.
  permissionState: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
