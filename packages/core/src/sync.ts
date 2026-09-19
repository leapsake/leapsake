import type { SyncRow } from "@leapsake/schema";
import {
  type SqliteDriver,
  type SyncableRepo,
  createContactMethodsRepo,
  createDismissalsRepo,
  createGiftIdeasRepo,
  createGiftRecipientsRepo,
  createHiddenHolidaysRepo,
  createHolidaysRepo,
  createMentionsRepo,
  createMilestonesRepo,
  createNotADuplicateRepo,
  createNotificationSettingsRepo,
  createObservancesRepo,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipsRepo,
  createReminderRulesRepo,
  createRemindersRepo,
  createSelfPersonRepo,
  createTagsRepo,
} from "@leapsake/data";

/**
 * The sync allowlist: every `SyncableRepo` that may leave the device. Rows are
 * plaintext here; the engine seals them in the master-key envelope on the wire.
 */
export function syncableRepos(driver: SqliteDriver): SyncableRepo<SyncRow>[] {
  const tags = createTagsRepo(driver);
  const contactMethods = createContactMethodsRepo(driver);
  return [
    createPeopleRepo(driver),
    createPetsRepo(driver),
    createMilestonesRepo(driver),
    createRelationshipsRepo(driver),
    createDismissalsRepo(driver),
    createNotADuplicateRepo(driver),
    createRemindersRepo(driver),
    createReminderRulesRepo(driver),
    createMentionsRepo(driver),
    // The self-person singleton converges by whole-row LWW on its fixed PK.
    createSelfPersonRepo(driver),
    createGiftIdeasRepo(driver),
    createGiftRecipientsRepo(driver),
    // The catalog syncs too, so only one device ever needs internet; its rows
    // carry the release's authored timestamp, so an old re-seed never wins LWW.
    createHolidaysRepo(driver),
    createObservancesRepo(driver),
    createHiddenHolidaysRepo(driver),
    // Per-device notification policy, editable from any device.
    createNotificationSettingsRepo(driver),
    tags,
    tags.taggings,
    contactMethods.emails,
    contactMethods.phones,
    contactMethods.postals,
    contactMethods.socials,
  ];
}
