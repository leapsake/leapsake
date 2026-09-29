import type { CoreApi } from "@leapsake/core";
import type { ContactMethodKind } from "@leapsake/schema";
import type { ContactMethodValue } from "@leapsake/contact-links";

// The four contact-method tables as three calls, dispatched on the kind.

/** The owner of a contact method. Person-only: pets have no Contact section. */
export interface ContactOwner {
  ownerType: "person";
  ownerId: string;
}

/** A contact method as its kind's `create` call. */
export function createContact(
  core: CoreApi,
  owner: ContactOwner,
  value: ContactMethodValue,
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
  value: ContactMethodValue,
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

/** The kind decides only which table the removal is in. */
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
