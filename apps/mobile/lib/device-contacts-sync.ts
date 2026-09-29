import {
  Contact,
  ContactField,
  ContactsSortOrder,
  getPermissionsAsync,
} from "expo-contacts";
import { Platform } from "react-native";
import type { CoreApi, ImportResult } from "@leapsake/core";
import { deviceContactToParsed } from "./device-contacts";

// Brings in every contact this device has not seen, and nothing else; the
// rules are in the app's README → Keeping People in step.

/** The fields `DeviceContact` in `device-contacts.ts` reads. */
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
  // `DATES` carries anniversaries everywhere and, on Android, the birthday too.
  ContactField.DATES,
  // Android has no `BIRTHDAY` field; asking for it rejects the whole read.
  ...(Platform.OS === "ios" ? [ContactField.BIRTHDAY] : []),
];

const NOTHING_NEW: ImportResult = { created: 0, skipped: 0, errors: [] };

/** The run in flight, so a second caller queues behind it. */
let queue: Promise<unknown> = Promise.resolve();

/** Told about every run that committed anything, whoever started it. */
const observers = new Set<(result: ImportResult) => void>();

/**
 * Hear about every run that commits, since a foreground run can beat the
 * import screen's own to the new contacts. Returns the unsubscribe.
 */
export function observeDeviceContactSync(
  observe: (result: ImportResult) => void,
): () => void {
  observers.add(observe);
  return () => observers.delete(observe);
}

/**
 * Bring in whatever is new, or `null` when the sync is off or unpermitted.
 * Queued, not merged: a run begun as iOS's picker closes misses its additions.
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
  // Ids alone first: on nearly every foreground nothing is new.
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
