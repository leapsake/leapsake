import type { EntityType } from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/**
 * Which of this phone's address-book contacts have already been brought into
 * Leapsake — the device-local `device_contact_links` table (migration 36; read
 * its comment for why a link outlives the person it made).
 *
 * Deliberately not a {@link SyncableRepo} and not an `EntityRepo`: a contact id
 * is local to one address book, so there is nothing here another device could
 * use, and a link is never deleted.
 */
export interface DeviceContactLinksRepo {
  /** Every address-book id this device has seen, whatever became of it. */
  listContactIds(): Promise<string[]>;
  /**
   * Record that `contactId` has been brought in as `entity`, or — for `null` —
   * seen and deliberately left out. A plain insert: linking an id twice throws,
   * which inside an import's per-contact transaction rolls that contact back
   * rather than creating the same person twice.
   */
  link(
    contactId: string,
    entity: { type: EntityType; id: string } | null,
  ): Promise<void>;
}

export function createDeviceContactLinksRepo(
  driver: SqliteDriver,
): DeviceContactLinksRepo {
  return {
    listContactIds: async () =>
      (
        await driver.all<{ contact_id: string }>(
          "SELECT contact_id FROM device_contact_links",
        )
      ).map((row) => row.contact_id),
    link: async (contactId, entity) => {
      await driver.run(
        `INSERT INTO device_contact_links
           (contact_id, entity_type, entity_id, linked_at)
         VALUES (?, ?, ?, ?)`,
        [contactId, entity?.type ?? null, entity?.id ?? null, Date.now()],
      );
    },
  };
}
