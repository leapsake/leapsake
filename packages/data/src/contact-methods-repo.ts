import {
  type ContactMethod,
  type ContactOwnerType,
  type CreateEmailInput,
  type CreatePhoneInput,
  type CreatePostalInput,
  type CreateSocialInput,
  type EmailAddress,
  type PhoneNumber,
  type PostalAddress,
  type SocialProfile,
  type UpdateEmailInput,
  type UpdatePhoneInput,
  type UpdatePostalInput,
  type UpdateSocialInput,
  createEmailInputSchema,
  createPhoneInputSchema,
  createPostalInputSchema,
  createSocialInputSchema,
  type SyncRow,
  emailAddressSchema,
  normalizeEmail,
  normalizeHandle,
  normalizePhone,
  phoneNumberSchema,
  postalAddressSchema,
  socialProfileSchema,
  updateEmailInputSchema,
  updatePhoneInputSchema,
  updatePostalInputSchema,
  updateSocialInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import {
  type EntityRepo,
  createEntityRepo,
  softDeleteWhere,
} from "./entity-repo.js";

/** One contact-method kind: the {@link EntityRepo} surface with typed create
 *  and update, plus the owner-scoped read. */
interface KindRepo<T extends SyncRow, C, U> extends Omit<
  EntityRepo<T>,
  "update"
> {
  create(input: C): Promise<T>;
  update(id: string, input: U): Promise<T | undefined>;
  listForOwner(type: ContactOwnerType, id: string): Promise<T[]>;
}

/** Every contact-method table, for the owner-wide cascade and re-point. */
const CONTACT_TABLES = [
  "email_addresses",
  "phone_numbers",
  "postal_addresses",
  "social_profiles",
] as const;

/** Active rows of one contact-method kind for an owner, kind-stable created_at
 *  order. */
function listForOwner<T extends SyncRow>(
  repo: EntityRepo<T>,
  type: ContactOwnerType,
  id: string,
): Promise<T[]> {
  return repo.listWhere({
    where: "owner_type = ? AND owner_id = ?",
    params: [type, id],
    orderBy: "created_at",
  });
}

export interface ContactMethodsRepo {
  emails: KindRepo<EmailAddress, CreateEmailInput, UpdateEmailInput>;
  phones: KindRepo<PhoneNumber, CreatePhoneInput, UpdatePhoneInput>;
  postals: KindRepo<PostalAddress, CreatePostalInput, UpdatePostalInput>;
  socials: KindRepo<SocialProfile, CreateSocialInput, UpdateSocialInput>;

  /** Soft-delete every contact method of an owner. Transaction-free. */
  removeAllForOwner(type: ContactOwnerType, id: string): Promise<void>;

  /** Re-point every contact method of `fromId` onto `toId`, without dedup: a
   *  person may list one number twice. Transaction-free. */
  repointOwner(
    type: ContactOwnerType,
    fromId: string,
    toId: string,
  ): Promise<void>;
}

/** Typed sub-repos over the four contact-method tables. `normalized` is derived
 *  on write for emails, phones and handles. */
export function createContactMethodsRepo(
  driver: SqliteDriver,
): ContactMethodsRepo {
  const emailBase = createEntityRepo<EmailAddress>({
    driver,
    table: "email_addresses",
    schema: emailAddressSchema,
  });
  const emails: ContactMethodsRepo["emails"] = {
    ...emailBase,

    async create(input) {
      const parsed = createEmailInputSchema.parse(input);
      const now = Date.now();
      return emailBase.insert({
        id: crypto.randomUUID(),
        ownerType: parsed.ownerType,
        ownerId: parsed.ownerId,
        label: parsed.label,
        address: parsed.address,
        normalized: normalizeEmail(parsed.address),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    async update(id, input) {
      const patch = updateEmailInputSchema.parse(input);
      // Re-derive the lookup key when the address changes; otherwise the
      // existing normalized value stands.
      return emailBase.update(
        id,
        patch.address === undefined
          ? patch
          : { ...patch, normalized: normalizeEmail(patch.address) },
      );
    },

    listForOwner: (type, id) => listForOwner(emailBase, type, id),
  };

  const phoneBase = createEntityRepo<PhoneNumber>({
    driver,
    table: "phone_numbers",
    schema: phoneNumberSchema,
    // SQLite has no boolean type; `sms_capable` is stored 0/1.
    booleans: ["smsCapable"],
    // Stored as JSON TEXT; NULL decodes to the schema's `[]`.
    json: ["reachableOn"],
  });
  const phones: ContactMethodsRepo["phones"] = {
    ...phoneBase,

    async create(input) {
      const parsed = createPhoneInputSchema.parse(input);
      const now = Date.now();
      return phoneBase.insert({
        id: crypto.randomUUID(),
        ownerType: parsed.ownerType,
        ownerId: parsed.ownerId,
        label: parsed.label,
        number: parsed.number,
        normalized: normalizePhone(parsed.number),
        extension: parsed.extension ?? null,
        country: parsed.country ?? null,
        // Assume textable unless the user says otherwise (landline/fax).
        smsCapable: parsed.smsCapable ?? true,
        // An unasked number reaches no platform until the user says so.
        reachableOn: parsed.reachableOn ?? [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    async update(id, input) {
      const patch = updatePhoneInputSchema.parse(input);
      // Re-derive the lookup key when the number changes.
      return phoneBase.update(
        id,
        patch.number === undefined
          ? patch
          : { ...patch, normalized: normalizePhone(patch.number) },
      );
    },

    listForOwner: (type, id) => listForOwner(phoneBase, type, id),
  };

  const postalBase = createEntityRepo<PostalAddress>({
    driver,
    table: "postal_addresses",
    schema: postalAddressSchema,
  });
  const postals: ContactMethodsRepo["postals"] = {
    ...postalBase,

    async create(input) {
      const parsed = createPostalInputSchema.parse(input);
      const now = Date.now();
      return postalBase.insert({
        id: crypto.randomUUID(),
        ownerType: parsed.ownerType,
        ownerId: parsed.ownerId,
        label: parsed.label,
        line1: parsed.line1,
        line2: parsed.line2 ?? null,
        locality: parsed.locality ?? null,
        region: parsed.region ?? null,
        postalCode: parsed.postalCode ?? null,
        country: parsed.country ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: async (id, input) =>
      postalBase.update(id, updatePostalInputSchema.parse(input)),

    listForOwner: (type, id) => listForOwner(postalBase, type, id),
  };

  const socialBase = createEntityRepo<SocialProfile>({
    driver,
    table: "social_profiles",
    schema: socialProfileSchema,
  });
  const socials: ContactMethodsRepo["socials"] = {
    ...socialBase,

    async create(input) {
      const parsed = createSocialInputSchema.parse(input);
      const now = Date.now();
      return socialBase.insert({
        id: crypto.randomUUID(),
        ownerType: parsed.ownerType,
        ownerId: parsed.ownerId,
        label: parsed.label,
        platform: parsed.platform,
        handle: parsed.handle,
        normalized: normalizeHandle(parsed.handle),
        platformUserId: parsed.platformUserId ?? null,
        url: parsed.url ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    async update(id, input) {
      const patch = updateSocialInputSchema.parse(input);
      // Re-derive the lookup key when the handle changes.
      return socialBase.update(
        id,
        patch.handle === undefined
          ? patch
          : { ...patch, normalized: normalizeHandle(patch.handle) },
      );
    },

    listForOwner: (type, id) => listForOwner(socialBase, type, id),
  };

  return {
    emails,
    phones,
    postals,
    socials,
    async removeAllForOwner(type, id) {
      for (const table of CONTACT_TABLES) {
        await softDeleteWhere(
          driver,
          table,
          "owner_type = ? AND owner_id = ?",
          [type, id],
        );
      }
    },

    async repointOwner(type, fromId, toId) {
      const now = Date.now();
      // `MAX(?, updated_at + 1)`: see the README's re-point rule.
      for (const table of CONTACT_TABLES) {
        await driver.run(
          `UPDATE ${table} SET owner_id = ?, updated_at = MAX(?, updated_at + 1)
             WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL`,
          [toId, now, type, fromId],
        );
      }
    },
  };
}

/** Every contact method of an owner as one tagged list, in kind order: the one
 *  place the fan-out lives. */
export async function listContactMethods(
  repo: ContactMethodsRepo,
  owner: { type: ContactOwnerType; id: string },
): Promise<ContactMethod[]> {
  const [emails, phones, postals, socials] = await Promise.all([
    repo.emails.listForOwner(owner.type, owner.id),
    repo.phones.listForOwner(owner.type, owner.id),
    repo.postals.listForOwner(owner.type, owner.id),
    repo.socials.listForOwner(owner.type, owner.id),
  ]);
  return [
    ...emails.map((method) => ({ kind: "email" as const, method })),
    ...phones.map((method) => ({ kind: "phone" as const, method })),
    ...postals.map((method) => ({ kind: "postal" as const, method })),
    ...socials.map((method) => ({ kind: "social" as const, method })),
  ];
}
