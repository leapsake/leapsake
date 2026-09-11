import {
  Contact,
  ContactField,
  ContactsSortOrder,
  getPermissionsAsync,
} from "expo-contacts";
import type { CoreApi, ImportResult } from "@leapsake/core";
import { deviceContactToParsed } from "./device-contacts";

/**
 * Keeping People in step with the phone's address book: bring in every contact
 * this device has not seen before, and nothing else. The import screen runs it
 * once to switch it on; after that `core-context` runs it at boot, on foreground
 * and when the address book changes while the app is open.
 *
 * The rules (settled 2026-09-10) are deliberately one-way and additive:
 *
 * - A **new contact** becomes a person, through the same `import.commit` a
 *   vCard uses, carrying its address-book id as the decision's `sourceId`.
 * - A **deleted person** stays deleted: their contact's id is still linked
 *   (`device_contact_links`, migration 36), so it is not new.
 * - A **contact deleted from the phone** leaves its person alone — Leapsake holds
 *   their reminders and gifts, and a tidy-up of the address book must not erase
 *   them.
 * - A **contact edited on the phone** changes nothing here yet.
 * - **Permission withdrawn**: nothing runs, and nothing is removed.
 *
 * Under iOS's limited access the address book this sees is only what the user
 * chose to share, so a contact added to the phone arrives once it is shared.
 *
 * A value import of `expo-contacts`, so unlike `device-contacts.ts` this module
 * cannot load under node; the logic worth testing is in the ingest engine and
 * core, which are.
 */

/**
 * The fields the mapper reads — kept in sync with `DeviceContact` in
 * `device-contacts.ts`, which types the slice it consumes.
 */
const CONTACT_FIELDS: ContactField[] = [
  ContactField.GIVEN_NAME,
  ContactField.MIDDLE_NAME,
  ContactField.FAMILY_NAME,
  ContactField.FULL_NAME,
  ContactField.COMPANY,
  ContactField.NOTE,
  ContactField.EMAILS,
  ContactField.PHONES,
  ContactField.ADDRESSES,
  // Both date sources. `BIRTHDAY` is iOS-only (Android's `ContactField` enum has
  // no such member and its detail record no such property); `DATES` carries
  // anniversaries on both platforms and, on Android, the birthday itself.
  ContactField.BIRTHDAY,
  ContactField.DATES,
];

const NOTHING_NEW: ImportResult = { created: 0, skipped: 0, errors: [] };

/** The run in flight, so a second caller queues behind it rather than racing it. */
let queue: Promise<unknown> = Promise.resolve();

/** Told about every run that committed anything, whoever started it. */
const observers = new Set<(result: ImportResult) => void>();

/**
 * Hear about every run that commits, not only the caller's own — which is what
 * the import screen needs to say what it imported. Closing the system's
 * permission sheet brings the app back to the foreground, and granting access
 * changes the address book, so a background run can reach the new contacts
 * before the screen's own run does and leave that one nothing new. Returns the
 * unsubscribe.
 */
export function observeDeviceContactSync(
  observe: (result: ImportResult) => void,
): () => void {
  observers.add(observe);
  return () => observers.delete(observe);
}

/**
 * Bring in whatever is new, or `null` when this device has not switched the sync
 * on or has no permission to read contacts. Never prompts for permission.
 *
 * Runs are **queued, not merged**: the foreground event that fires as iOS's
 * access picker closes would otherwise start a run that read the address book
 * *before* the picker's additions, and a caller joining it would miss them. A
 * queued run that finds nothing new costs one pass over the ids.
 */
export function syncDeviceContacts(
  core: CoreApi,
): Promise<ImportResult | null> {
  const run = queue.then(() => syncOnce(core));
  queue = run.catch(() => undefined);
  return run;
}

async function syncOnce(core: CoreApi): Promise<ImportResult | null> {
  if (!(await core.deviceContacts.getSyncEnabled())) return null;
  if (!(await getPermissionsAsync()).granted) return null;

  const linked = new Set(await core.deviceContacts.linkedIds());
  // Ids alone first: on nearly every foreground nothing is new, and reading
  // every contact's details to find that out would be the expensive way.
  const ids = await Contact.getAllDetails([ContactField.GIVEN_NAME]);
  if (ids.every(({ id }) => linked.has(id))) return NOTHING_NEW;

  const details = await Contact.getAllDetails(CONTACT_FIELDS, {
    sortOrder: ContactsSortOrder.GivenName,
  });
  const result = await core.import.commit(
    details
      .filter(({ id }) => !linked.has(id))
      .map((detail) => ({
        action: "create" as const,
        contact: deviceContactToParsed(detail),
        sourceId: detail.id,
      })),
  );
  for (const observe of observers) observe(result);
  return result;
}
