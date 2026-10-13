import { z } from "zod";

/** How a device is notified while closed: `off` or a daily `digest`. `each`
 *  parses, as v0.1 builds could store it, and is planned as `digest`. */
export const notificationModeSchema = z.enum(["off", "digest", "each"]);
export type NotificationMode = z.infer<typeof notificationModeSchema>;

/** The most delivery times a device can hold in a day. */
export const MAX_DELIVERY_TIMES = 3;

/** Minutes past local midnight, each a separate digest; at least one. */
export const deliveryMinutesSchema = z
  .array(
    z
      .number()
      .int()
      .min(0)
      .max(24 * 60 - 1),
  )
  .min(1)
  .max(MAX_DELIVERY_TIMES);

/**
 * One device's notification policy, synced so any device can edit it. `id` is
 * the device id; `label` and `platform` are copied from the unsynced `device`.
 */
export const notificationSettingsSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  platform: z.string().nullable(),
  mode: notificationModeSchema,
  deliveryMinutes: deliveryMinutesSchema,
  // What the OS last told the owning device; only that device writes it.
  permissionState: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
