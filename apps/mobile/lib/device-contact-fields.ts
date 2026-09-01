import { ContactField } from "expo-contacts";

/**
 * The `expo-contacts` fields the import asks `Contact.getAllDetails` for — kept
 * in sync with `DeviceContact` in {@link ./device-contacts}, which types the
 * slice the mapper reads.
 *
 * Its own module because it is a *value* import from `expo-contacts`, and that
 * package's entrypoint calls `requireNativeModule` at module scope. Putting it
 * beside the mapper would drag the native module into `device-contacts.ts` and
 * cost that file the purity that lets it unit-test under node.
 */
export const CONTACT_FIELDS: ContactField[] = [
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
