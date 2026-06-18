import {
  type ContactMethod,
  type ContactOwnerType,
  type CreateEmailInput,
  type CreatePhoneInput,
  type CreatePostalInput,
  type EmailAddress,
  type PhoneNumber,
  type PostalAddress,
  type UpdateEmailInput,
  type UpdatePhoneInput,
  type UpdatePostalInput,
  createEmailInputSchema,
  createPhoneInputSchema,
  createPostalInputSchema,
  type SyncRow,
  emailAddressSchema,
  normalizeEmail,
  normalizePhone,
  phoneNumberSchema,
  postalAddressSchema,
  resolveMerge,
  updateEmailInputSchema,
  updatePhoneInputSchema,
  updatePostalInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import type { SyncableRepo } from "./syncable.js";

/** The `email_addresses` table row, exactly as stored (snake_case columns). */
interface EmailRow {
  id: string;
  owner_type: string;
  owner_id: string;
  label: string;
  address: string;
  normalized: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** The `phone_numbers` table row, exactly as stored. */
interface PhoneRow {
  id: string;
  owner_type: string;
  owner_id: string;
  label: string;
  number: string;
  normalized: string;
  extension: string | null;
  country: string | null;
  sms_capable: number; // SQLite has no bool; 0/1
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** The `postal_addresses` table row, exactly as stored. */
interface PostalRow {
  id: string;
  owner_type: string;
  owner_id: string;
  label: string;
  line1: string;
  line2: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toEmail(row: EmailRow): EmailAddress {
  return emailAddressSchema.parse({
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    label: row.label,
    address: row.address,
    normalized: row.normalized,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

function toPhone(row: PhoneRow): PhoneNumber {
  return phoneNumberSchema.parse({
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    label: row.label,
    number: row.number,
    normalized: row.normalized,
    extension: row.extension,
    country: row.country,
    smsCapable: row.sms_capable !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

function toPostal(row: PostalRow): PostalAddress {
  return postalAddressSchema.parse({
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    locality: row.locality,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  });
}

/** CRUD for one contact-method kind, scoped to an owner for reads. */
interface KindRepo<T extends SyncRow, C, U> extends SyncableRepo<T> {
  create(input: C): Promise<T>;
  get(id: string): Promise<T | undefined>;
  update(id: string, input: U): Promise<T | undefined>;
  softDelete(id: string): Promise<void>;
  listForOwner(type: ContactOwnerType, id: string): Promise<T[]>;
}

export interface ContactMethodsRepo {
  emails: KindRepo<EmailAddress, CreateEmailInput, UpdateEmailInput>;
  phones: KindRepo<PhoneNumber, CreatePhoneInput, UpdatePhoneInput>;
  postals: KindRepo<PostalAddress, CreatePostalInput, UpdatePostalInput>;

  /**
   * Soft-delete every active contact method (all three kinds) of an owner. Used
   * when the host entity (a Person) is deleted. Transaction-free building block —
   * the caller composes it with the entity's own delete inside one transaction.
   */
  removeAllForOwner(type: ContactOwnerType, id: string): Promise<void>;
}

/** Shared soft-delete-by-id for any contact-method table. */
function softDeleteFrom(driver: SqliteDriver, table: string, id: string) {
  const now = Date.now();
  return driver.run(
    `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    [now, now, id],
  );
}

/** Shared by-owner active-row read for any contact-method table. */
function listRowsForOwner<R>(
  driver: SqliteDriver,
  table: string,
  type: ContactOwnerType,
  id: string,
) {
  return driver.all<R>(
    `SELECT * FROM ${table}
      WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL
      ORDER BY created_at`,
    [type, id],
  );
}

/** Shared changed-since read (incl. tombstones) for any contact-method table. */
function listChangedRowsSince<R>(
  driver: SqliteDriver,
  table: string,
  since: number,
) {
  return driver.all<R>(
    `SELECT * FROM ${table} WHERE updated_at > ? ORDER BY updated_at`,
    [since],
  );
}

/** Shared by-id read (incl. tombstones) — the merge-fetch for any table. */
function getRowById<R>(driver: SqliteDriver, table: string, id: string) {
  return driver.get<R>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
}

/**
 * The Contact Methods repository, written against the async {@link SqliteDriver}
 * port so it runs unchanged on desktop and mobile. Three typed sub-repos
 * (emails/phones/postals) over the three tables; reads exclude soft-deleted rows
 * and writes never hard-delete. The lookup `normalized` field is derived on write
 * for emails and phones (postal has none).
 */
export function createContactMethodsRepo(
  driver: SqliteDriver,
): ContactMethodsRepo {
  const emails: ContactMethodsRepo["emails"] = {
    table: "email_addresses",

    decode(payload) {
      return emailAddressSchema.parse(payload);
    },

    async create(input) {
      const parsed = createEmailInputSchema.parse(input);
      const now = Date.now();
      const email: EmailAddress = emailAddressSchema.parse({
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
      await driver.run(
        `INSERT INTO email_addresses
           (id, owner_type, owner_id, label, address, normalized,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          email.id,
          email.ownerType,
          email.ownerId,
          email.label,
          email.address,
          email.normalized,
          email.createdAt,
          email.updatedAt,
          email.deletedAt,
        ],
      );
      return email;
    },

    async get(id) {
      const row = await driver.get<EmailRow>(
        "SELECT * FROM email_addresses WHERE id = ? AND deleted_at IS NULL",
        [id],
      );
      return row ? toEmail(row) : undefined;
    },

    async update(id, input) {
      const patch = updateEmailInputSchema.parse(input);
      const existing = await this.get(id);
      if (!existing) return undefined;
      const updated: EmailAddress = emailAddressSchema.parse({
        ...existing,
        ...patch,
        // Re-derive the lookup key from the (possibly new) address.
        normalized: normalizeEmail(patch.address ?? existing.address),
        updatedAt: Date.now(),
      });
      await driver.run(
        `UPDATE email_addresses
           SET label = ?, address = ?, normalized = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          updated.label,
          updated.address,
          updated.normalized,
          updated.updatedAt,
          id,
        ],
      );
      return updated;
    },

    softDelete: (id) => softDeleteFrom(driver, "email_addresses", id),

    async listForOwner(type, id) {
      const rows = await listRowsForOwner<EmailRow>(
        driver,
        "email_addresses",
        type,
        id,
      );
      return rows.map(toEmail);
    },

    async listChangedSince(since) {
      const rows = await listChangedRowsSince<EmailRow>(
        driver,
        "email_addresses",
        since,
      );
      return rows.map(toEmail);
    },

    async upsertFromRemote(remote) {
      const row = await getRowById<EmailRow>(
        driver,
        "email_addresses",
        remote.id,
      );
      const local = row ? toEmail(row) : undefined;
      if (local) {
        if (resolveMerge(local, remote) === local) return;
        await driver.run(
          `UPDATE email_addresses
             SET owner_type = ?, owner_id = ?, label = ?, address = ?, normalized = ?,
                 created_at = ?, updated_at = ?, deleted_at = ?
           WHERE id = ?`,
          [
            remote.ownerType,
            remote.ownerId,
            remote.label,
            remote.address,
            remote.normalized,
            remote.createdAt,
            remote.updatedAt,
            remote.deletedAt,
            remote.id,
          ],
        );
        return;
      }
      await driver.run(
        `INSERT INTO email_addresses
           (id, owner_type, owner_id, label, address, normalized,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          remote.id,
          remote.ownerType,
          remote.ownerId,
          remote.label,
          remote.address,
          remote.normalized,
          remote.createdAt,
          remote.updatedAt,
          remote.deletedAt,
        ],
      );
    },
  };

  const phones: ContactMethodsRepo["phones"] = {
    table: "phone_numbers",

    decode(payload) {
      return phoneNumberSchema.parse(payload);
    },

    async create(input) {
      const parsed = createPhoneInputSchema.parse(input);
      const now = Date.now();
      const phone: PhoneNumber = phoneNumberSchema.parse({
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
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      await driver.run(
        `INSERT INTO phone_numbers
           (id, owner_type, owner_id, label, number, normalized,
            extension, country, sms_capable, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          phone.id,
          phone.ownerType,
          phone.ownerId,
          phone.label,
          phone.number,
          phone.normalized,
          phone.extension,
          phone.country,
          phone.smsCapable ? 1 : 0,
          phone.createdAt,
          phone.updatedAt,
          phone.deletedAt,
        ],
      );
      return phone;
    },

    async get(id) {
      const row = await driver.get<PhoneRow>(
        "SELECT * FROM phone_numbers WHERE id = ? AND deleted_at IS NULL",
        [id],
      );
      return row ? toPhone(row) : undefined;
    },

    async update(id, input) {
      const patch = updatePhoneInputSchema.parse(input);
      const existing = await this.get(id);
      if (!existing) return undefined;
      const updated: PhoneNumber = phoneNumberSchema.parse({
        ...existing,
        ...patch,
        normalized: normalizePhone(patch.number ?? existing.number),
        updatedAt: Date.now(),
      });
      await driver.run(
        `UPDATE phone_numbers
           SET label = ?, number = ?, normalized = ?,
               extension = ?, country = ?, sms_capable = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          updated.label,
          updated.number,
          updated.normalized,
          updated.extension,
          updated.country,
          updated.smsCapable ? 1 : 0,
          updated.updatedAt,
          id,
        ],
      );
      return updated;
    },

    softDelete: (id) => softDeleteFrom(driver, "phone_numbers", id),

    async listForOwner(type, id) {
      const rows = await listRowsForOwner<PhoneRow>(
        driver,
        "phone_numbers",
        type,
        id,
      );
      return rows.map(toPhone);
    },

    async listChangedSince(since) {
      const rows = await listChangedRowsSince<PhoneRow>(
        driver,
        "phone_numbers",
        since,
      );
      return rows.map(toPhone);
    },

    async upsertFromRemote(remote) {
      const row = await getRowById<PhoneRow>(
        driver,
        "phone_numbers",
        remote.id,
      );
      const local = row ? toPhone(row) : undefined;
      if (local) {
        if (resolveMerge(local, remote) === local) return;
        await driver.run(
          `UPDATE phone_numbers
             SET owner_type = ?, owner_id = ?, label = ?, number = ?, normalized = ?,
                 extension = ?, country = ?, sms_capable = ?,
                 created_at = ?, updated_at = ?, deleted_at = ?
           WHERE id = ?`,
          [
            remote.ownerType,
            remote.ownerId,
            remote.label,
            remote.number,
            remote.normalized,
            remote.extension,
            remote.country,
            remote.smsCapable ? 1 : 0,
            remote.createdAt,
            remote.updatedAt,
            remote.deletedAt,
            remote.id,
          ],
        );
        return;
      }
      await driver.run(
        `INSERT INTO phone_numbers
           (id, owner_type, owner_id, label, number, normalized,
            extension, country, sms_capable, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          remote.id,
          remote.ownerType,
          remote.ownerId,
          remote.label,
          remote.number,
          remote.normalized,
          remote.extension,
          remote.country,
          remote.smsCapable ? 1 : 0,
          remote.createdAt,
          remote.updatedAt,
          remote.deletedAt,
        ],
      );
    },
  };

  const postals: ContactMethodsRepo["postals"] = {
    table: "postal_addresses",

    decode(payload) {
      return postalAddressSchema.parse(payload);
    },

    async create(input) {
      const parsed = createPostalInputSchema.parse(input);
      const now = Date.now();
      const postal: PostalAddress = postalAddressSchema.parse({
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
      await driver.run(
        `INSERT INTO postal_addresses
           (id, owner_type, owner_id, label, line1, line2,
            locality, region, postal_code, country,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          postal.id,
          postal.ownerType,
          postal.ownerId,
          postal.label,
          postal.line1,
          postal.line2,
          postal.locality,
          postal.region,
          postal.postalCode,
          postal.country,
          postal.createdAt,
          postal.updatedAt,
          postal.deletedAt,
        ],
      );
      return postal;
    },

    async get(id) {
      const row = await driver.get<PostalRow>(
        "SELECT * FROM postal_addresses WHERE id = ? AND deleted_at IS NULL",
        [id],
      );
      return row ? toPostal(row) : undefined;
    },

    async update(id, input) {
      const patch = updatePostalInputSchema.parse(input);
      const existing = await this.get(id);
      if (!existing) return undefined;
      const updated: PostalAddress = postalAddressSchema.parse({
        ...existing,
        ...patch,
        updatedAt: Date.now(),
      });
      await driver.run(
        `UPDATE postal_addresses
           SET label = ?, line1 = ?, line2 = ?, locality = ?,
               region = ?, postal_code = ?, country = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [
          updated.label,
          updated.line1,
          updated.line2,
          updated.locality,
          updated.region,
          updated.postalCode,
          updated.country,
          updated.updatedAt,
          id,
        ],
      );
      return updated;
    },

    softDelete: (id) => softDeleteFrom(driver, "postal_addresses", id),

    async listForOwner(type, id) {
      const rows = await listRowsForOwner<PostalRow>(
        driver,
        "postal_addresses",
        type,
        id,
      );
      return rows.map(toPostal);
    },

    async listChangedSince(since) {
      const rows = await listChangedRowsSince<PostalRow>(
        driver,
        "postal_addresses",
        since,
      );
      return rows.map(toPostal);
    },

    async upsertFromRemote(remote) {
      const row = await getRowById<PostalRow>(
        driver,
        "postal_addresses",
        remote.id,
      );
      const local = row ? toPostal(row) : undefined;
      if (local) {
        if (resolveMerge(local, remote) === local) return;
        await driver.run(
          `UPDATE postal_addresses
             SET owner_type = ?, owner_id = ?, label = ?, line1 = ?, line2 = ?,
                 locality = ?, region = ?, postal_code = ?, country = ?,
                 created_at = ?, updated_at = ?, deleted_at = ?
           WHERE id = ?`,
          [
            remote.ownerType,
            remote.ownerId,
            remote.label,
            remote.line1,
            remote.line2,
            remote.locality,
            remote.region,
            remote.postalCode,
            remote.country,
            remote.createdAt,
            remote.updatedAt,
            remote.deletedAt,
            remote.id,
          ],
        );
        return;
      }
      await driver.run(
        `INSERT INTO postal_addresses
           (id, owner_type, owner_id, label, line1, line2,
            locality, region, postal_code, country,
            created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          remote.id,
          remote.ownerType,
          remote.ownerId,
          remote.label,
          remote.line1,
          remote.line2,
          remote.locality,
          remote.region,
          remote.postalCode,
          remote.country,
          remote.createdAt,
          remote.updatedAt,
          remote.deletedAt,
        ],
      );
    },
  };

  return {
    emails,
    phones,
    postals,
    async removeAllForOwner(type, id) {
      const now = Date.now();
      for (const table of [
        "email_addresses",
        "phone_numbers",
        "postal_addresses",
      ]) {
        await driver.run(
          `UPDATE ${table} SET deleted_at = ?, updated_at = ?
             WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL`,
          [now, now, type, id],
        );
      }
    },
  };
}

/**
 * Every contact method of an owner, fanned out across the three typed tables and
 * merged into one tagged {@link ContactMethod} list — so screens never repeat the
 * three-way union. Emails, then phones, then postal addresses; each kind keeps
 * its own by-owner (created_at) order.
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
  const [emails, phones, postals] = await Promise.all([
    repo.emails.listForOwner(owner.type, owner.id),
    repo.phones.listForOwner(owner.type, owner.id),
    repo.postals.listForOwner(owner.type, owner.id),
  ]);
  return [
    ...emails.map((method) => ({ kind: "email" as const, method })),
    ...phones.map((method) => ({ kind: "phone" as const, method })),
    ...postals.map((method) => ({ kind: "postal" as const, method })),
  ];
}
