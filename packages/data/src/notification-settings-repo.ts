import {
  type NotificationSettings,
  notificationSettingsSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { type EntityRepo, createEntityRepo } from "./entity-repo.js";
import { assignmentClause, resolveCodec } from "./syncable.js";

/** The fields a policy write may touch: all but the id and the clock. */
type PolicyPatch = Partial<
  Pick<
    NotificationSettings,
    "label" | "platform" | "mode" | "deliveryMinute" | "permissionState"
  >
>;

const DEFAULTS = {
  label: null,
  platform: null,
  mode: "off",
  deliveryMinute: 540,
  permissionState: null,
} as const satisfies PolicyPatch;

export interface NotificationSettingsRepo extends EntityRepo<NotificationSettings> {
  /** Upsert any device's policy fields, creating the row with defaults if
   *  needed. The caller chooses the device. */
  setPolicy(
    deviceId: string,
    patch: PolicyPatch,
  ): Promise<NotificationSettings>;
  /** Record a device's last-known OS permission state. Only the owning device
   *  calls this. */
  setPermissionState(
    deviceId: string,
    state: string | null,
  ): Promise<NotificationSettings>;
}

/** Per-device notification policy, keyed on the device id. A device appears
 *  once `setPolicy` or `setPermissionState` has run for it. */
export function createNotificationSettingsRepo(
  driver: SqliteDriver,
): NotificationSettingsRepo {
  const base = createEntityRepo<NotificationSettings>({
    driver,
    table: "notification_settings",
    schema: notificationSettingsSchema,
  });
  const codec = resolveCodec<NotificationSettings>({
    schema: notificationSettingsSchema,
  });

  async function upsert(
    deviceId: string,
    patch: PolicyPatch,
  ): Promise<NotificationSettings> {
    const existing = await base.getIncludingDeleted(deviceId);
    const now = Date.now();
    if (existing === undefined) {
      return base.insert({
        id: deviceId,
        ...DEFAULTS,
        ...patch,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }

    // May revive a tombstone, so it clears `deleted_at`; the stored clock is
    // the monotonic `MAX()` below.
    const merged = notificationSettingsSchema.parse({
      ...existing,
      ...patch,
      deletedAt: null,
      updatedAt: now,
    });
    const cols = await codec.toRow(merged);
    const [setSql, params] = assignmentClause(cols, [
      "id",
      "created_at",
      "updated_at",
    ]);
    await driver.run(
      `UPDATE notification_settings
          SET ${setSql}, updated_at = MAX(?, updated_at + 1)
        WHERE id = ?`,
      [...params, now, deviceId],
    );
    return (await base.getIncludingDeleted(deviceId)) as NotificationSettings;
  }

  return {
    ...base,
    setPolicy: (deviceId, patch) => upsert(deviceId, patch),
    setPermissionState: (deviceId, state) =>
      upsert(deviceId, { permissionState: state }),
  };
}
