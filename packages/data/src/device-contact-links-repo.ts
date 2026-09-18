import type { EntityType } from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/** Which address-book contacts this device has brought in. Device-local and
 *  never deleted (README, "Migrations"). */
export interface DeviceContactLinksRepo {
  /** Every address-book id this device has seen, whatever became of it. */
  listContactIds(): Promise<string[]>;
  /** Record a contact as imported (`null`: seen and left out). Linking twice
   *  throws, rolling back that contact's import. */
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
