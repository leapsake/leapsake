import type { CoreApi } from "@leapsake/core";
import type { ContactMethodKind } from "@leapsake/schema";
import type { ContactFormValue } from "../components/ContactMethodFields";

/**
 * The four contact-method tables as three calls — the dispatch every writer of a
 * contact method needs, and the only thing any of them needs to know about the
 * split.
 *
 * `ContactMethodFields` produces one {@link ContactFormValue} whatever kind the
 * user picked, but `core.contactMethods` is four sibling repositories, so
 * somebody has to turn the tag back into a table. It lives here rather than in
 * any one caller because there are now three: the create screen writes a whole
 * form of staged rows, and the contact routes write one at a time.
 */

/** The owner of a contact method. Person-only: pets have no Contact section. */
export interface ContactOwner {
  ownerType: "person";
  ownerId: string;
}

/** A contact method as its kind's `create` call. */
export function createContact(
  core: CoreApi,
  owner: ContactOwner,
  value: ContactFormValue,
): Promise<unknown> {
  if (value.kind === "email") {
    return core.contactMethods.emails.create({
      ...owner,
      label: value.label,
      address: value.address,
    });
  }
  if (value.kind === "phone") {
    return core.contactMethods.phones.create({
      ...owner,
      label: value.label,
      number: value.number,
      extension: value.extension,
      country: value.country,
      smsCapable: value.smsCapable,
      reachableOn: value.reachableOn,
    });
  }
  if (value.kind === "postal") {
    return core.contactMethods.postals.create({
      ...owner,
      label: value.label,
      line1: value.line1,
      line2: value.line2,
      locality: value.locality,
      region: value.region,
      postalCode: value.postalCode,
      country: value.country,
    });
  }
  return core.contactMethods.socials.create({
    ...owner,
    label: value.label,
    platform: value.platform,
    handle: value.handle,
    platformUserId: value.platformUserId,
    url: value.url,
  });
}

/** The same value as its kind's `update` call — the owner never moves. */
export function updateContact(
  core: CoreApi,
  id: string,
  value: ContactFormValue,
): Promise<unknown> {
  if (value.kind === "email") {
    return core.contactMethods.emails.update(id, {
      label: value.label,
      address: value.address,
    });
  }
  if (value.kind === "phone") {
    return core.contactMethods.phones.update(id, {
      label: value.label,
      number: value.number,
      extension: value.extension,
      country: value.country,
      smsCapable: value.smsCapable,
      reachableOn: value.reachableOn,
    });
  }
  if (value.kind === "postal") {
    return core.contactMethods.postals.update(id, {
      label: value.label,
      line1: value.line1,
      line2: value.line2,
      locality: value.locality,
      region: value.region,
      postalCode: value.postalCode,
      country: value.country,
    });
  }
  return core.contactMethods.socials.update(id, {
    label: value.label,
    platform: value.platform,
    handle: value.handle,
    platformUserId: value.platformUserId,
    url: value.url,
  });
}

/** Which table a removed method belongs to is the only thing its kind decides. */
export function deleteContact(
  core: CoreApi,
  id: string,
  kind: ContactMethodKind,
): Promise<void> {
  if (kind === "email") return core.contactMethods.emails.softDelete(id);
  if (kind === "phone") return core.contactMethods.phones.softDelete(id);
  if (kind === "postal") return core.contactMethods.postals.softDelete(id);
  return core.contactMethods.socials.softDelete(id);
}
