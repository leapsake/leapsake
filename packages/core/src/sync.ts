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
 * Build the **canonical sync allowlist** — every `SyncableRepo` that may leave
 * the device — over a driver and the unlocked master key. This is the single
 * production home for "what syncs": adding an entity is one more entry here, and
 * the device-local key tables (`content_key`/`key_wrap`/`sync_state`/`account`/
 * `device`) are *absent by construction*, which is what keeps sync
 * zero-knowledge (model.md §3). A guard test pins this exact set.
 *
 * **Every repo here is plaintext-row**, which is why this takes no key at all.
 * `milestones` used to be handed a content cipher so its sealed `note` decrypted
 * on collect and re-sealed under the receiving device's own content key on apply;
 * that field was retired as a layer-3 consumer on 2026-07-27 (migration 27),
 * removing the one place a device-local key had to be unwound mid-sync. The rows
 * are still protected on the wire — by the master-key *envelope* (layer 2), which
 * the engine applies, not the repos.
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
    // The self-person singleton rides the people sync channel (its `person_id`
    // points into the people rows) — plaintext, converging by whole-row LWW on
    // its fixed PK.
    createSelfPersonRepo(driver),
    // Gift ideas — plaintext, person-agnostic rows.
    createGiftIdeasRepo(driver),
    // Gift recipients — idea × person/pet, and whether it has been given.
    createGiftRecipientsRepo(driver),
    // Holidays: the catalog syncs alongside user data so only ONE device ever
    // needs internet — a laptop that updates at a coffee shop can carry the new
    // catalog to every other device over an internet-less LAN relay. The usual
    // objection (an old device's re-seed reverting a newer catalog) dissolves
    // because catalog rows carry the release's *authored* timestamp, so LWW
    // orders them correctly by construction (research §2.3, §2.5). `observances`
    // and `hidden_holidays` are ordinary user data and must sync regardless.
    createHolidaysRepo(driver),
    createObservancesRepo(driver),
    createHiddenHolidaysRepo(driver),
    // Local-notification policy — per-device, but editable from any device,
    // so it rides ordinary sync like any other preference row.
    createNotificationSettingsRepo(driver),
    tags,
    tags.taggings,
    contactMethods.emails,
    contactMethods.phones,
    contactMethods.postals,
    contactMethods.socials,
  ];
}
