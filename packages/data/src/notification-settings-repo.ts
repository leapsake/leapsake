import {
  type NotificationSettings,
  notificationSettingsSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { type EntityRepo, createEntityRepo } from "./entity-repo.js";
import { assignmentClause, resolveCodec } from "./syncable.js";

/** The fields a policy write may touch — everything but the id and the clock. */
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
  /**
   * Upsert `deviceId`'s policy fields — the "every device may write any
   * device's row" surface. Creates the
   * row (defaulting anything omitted: `off`, 09:00, no label) if this device has
   * never had one, else merges the patch and bumps the clock. Not scoped to
   * "this device" — the caller supplies whichever deviceId the cross-device
   * settings UI is editing.
   */
  setPolicy(
    deviceId: string,
    patch: PolicyPatch,
  ): Promise<NotificationSettings>;
  /**
   * Record `deviceId`'s last-known OS permission state. Same upsert shape as
   * {@link setPolicy}, kept as a separate method because only the *owning*
   * device should ever call it — a fact about that device's OS, not a
   * preference another device can set.
   */
  setPermissionState(
    deviceId: string,
    state: string | null,
  ): Promise<NotificationSettings>;
}

/**
 * The local-notification policy repository — a synced, one-row-per-device
 * settings table keyed on the device id itself (migration 29's `id` column;
 * see its comment for why). Standard CRUD + the sync surface come from
 * {@link createEntityRepo}; the bespoke {@link NotificationSettingsRepo.setPolicy}
 * / {@link NotificationSettingsRepo.setPermissionState} give callers the
 * upsert-or-revive behavior a settings row actually wants, mirroring
 * `self-person-repo.ts`'s `setSelf`.
 *
 * No row is pre-created for every device: a device appears in {@link list} —
 * the cross-device settings UI's source — exactly when one of these two
 * methods has been called for it.
 */
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

    // Re-validate the merged row (cross-field rules, same as EntityRepo.update),
    // but — unlike EntityRepo.update — this may be reviving a tombstone, so it
    // deliberately does not require the row to be currently active, and clears
    // deleted_at explicitly. `updatedAt` here only satisfies the schema; the
    // persisted clock is the monotonic MAX() below (self-person's idiom), so a
    // write landing in the same millisecond as a peer's still out-ranks it.
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
