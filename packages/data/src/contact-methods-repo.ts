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

/**
 * CRUD for one contact-method kind, scoped to an owner for reads. Builds on the
 * standard {@link EntityRepo} surface, replacing its generic `update` (a raw
 * `Partial<T>` patch) with the kind's typed update input, and adding `create`
 * (typed input) and the owner-scoped read.
 */
interface KindRepo<T extends SyncRow, C, U> extends Omit<
  EntityRepo<T>,
  "update"
> {
  create(input: C): Promise<T>;
  update(id: string, input: U): Promise<T | undefined>;
  listForOwner(type: ContactOwnerType, id: string): Promise<T[]>;
}

/**
 * Every contact-method table, for the two owner-wide operations that work by
 * predicate rather than through a typed sub-repo (cascade delete, merge
 * re-point). Named once so adding a fifth kind is one edit here rather than two
 * identical lists drifting apart.
 */
const CONTACT_TABLES = [
  "email_addresses",
  "phone_numbers",
  "postal_addresses",
  "social_profiles",
] as const;

/** Active rows of one contact-method kind for an owner, kind-stable created_at order. */
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

  /**
   * Soft-delete every active contact method (all four kinds) of an owner. Used
   * when the host entity (a Person) is deleted. Transaction-free building block —
   * the caller composes it with the entity's own delete inside one transaction.
   */
  removeAllForOwner(type: ContactOwnerType, id: string): Promise<void>;

  /**
   * Re-point every active contact method (all four kinds) of `fromId` onto
   * `toId` (used when merging `fromId` into `toId`). Methods are not deduped — a
   * person can legitimately list the same number twice. Transaction-free
   * building block.
   */
  repointOwner(
    type: ContactOwnerType,
    fromId: string,
    toId: string,
  ): Promise<void>;
}

/**
 * The Contact Methods repository, written against the async {@link SqliteDriver}
 * port so it runs unchanged on desktop and mobile. Four typed sub-repos
 * (emails/phones/postals/socials) over the four tables; reads exclude
 * soft-deleted rows and writes never hard-delete. The lookup `normalized` field
 * is derived on write for emails, phones and social handles (postal has none).
 */
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
      // Re-derive the lookup key when the address changes (else the existing
      // normalized value — already in sync with the unchanged address — stands).
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
    // …nor an array type; `reachable_on` is stored as JSON TEXT. A NULL (every
    // row predating migration 32) decodes to the schema's `[]` default.
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
        // Nothing is assumed here, though: whether a number is on WhatsApp is
        // not something Leapsake can guess, so an unasked number reaches nothing
        // until the user says otherwise.
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
      // `MAX(?, updated_at + 1)` keeps each re-point strictly newer than the row it
      // rewrites so it wins LWW on every device rather than tying when the merge
      // lands in the contact method's creation millisecond (see relationships-repo
      // `repointEntity`).
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

/**
 * Every contact method of an owner, fanned out across the four typed tables and
 * merged into one tagged {@link ContactMethod} list — so screens never repeat the
 * four-way union. Emails, then phones, then postal addresses, then social
 * profiles; each kind keeps its own by-owner (created_at) order.
 *
 * This is the single place the fan-out lives. When the household entity ships, an
 * owner's **effective** methods become `own ∪ household's` — a read-time union
 * added here and nowhere else, the same derived pattern as `listTimelineForEntity`
 * and derived relationships. Nothing is materialised; no method is duplicated.
 */
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
