import {
  type AttachPool,
  type DuplicateMatch,
  type EntityService,
  type ContactMethodsRepo,
  type DeviceContactLinksRepo,
  type DuplicateService,
  type MilestonesRepo,
  type PeopleRepo,
  type PetsRepo,
  type RelationshipsRepo,
  type SelfPersonRepo,
  type SqliteDriver,
  type TagsRepo,
  postalValue,
} from "@leapsake/data";
import {
  type AttachDate,
  type AttachFields,
  entityLabel,
  fold,
  inverseRole,
  splitName,
} from "@leapsake/schema";
import {
  type ImportDecision,
  type ImportPorts,
  type ImportResult,
  type ParsedContact,
  ingestContacts,
  nameInputFrom,
} from "@leapsake/vcard";

/** The stored person or pet an incoming card's `UID` names: an identity, not
 *  a resemblance. See the README. */
export interface AlreadyStored {
  type: "person" | "pet";
  id: string;
  name: string;
}

export interface ImportApiDeps {
  people: PeopleRepo;
  pets: PetsRepo;
  tags: TagsRepo;
  milestones: MilestonesRepo;
  relationships: RelationshipsRepo;
  contactMethods: ContactMethodsRepo;
  self: SelfPersonRepo;
  deviceContactLinks: DeviceContactLinksRepo;
  entities: EntityService;
  duplicates: DuplicateService;
  driver: SqliteDriver;
  /** Reconciles the automated reminders once after a batch that created
   *  anything. */
  regenerateSystem: () => Promise<unknown>;
}

/** A contact's fields as the attach rule compares them, values still raw. */
function attachFieldsOf(contact: ParsedContact): AttachFields {
  return {
    firstName: contact.name.firstName,
    middleName: contact.name.middleName,
    lastName: contact.name.lastName,
    gender: contact.gender,
    birthday: contact.birthday,
    dates: contact.dates.map((d) => ({ kind: d.kind, date: d.date })),
    emails: contact.emails.map((e) => ({ label: e.label, value: e.address })),
    phones: contact.phones.map((p) => ({ label: p.label, value: p.number })),
    postals: contact.postals.map((a) => ({
      label: a.label,
      value: postalValue([
        a.line1,
        a.line2,
        a.locality,
        a.region,
        a.postalCode,
        a.country,
      ]),
    })),
    handles: contact.socials.map((h) => ({
      platform: h.platform,
      value: h.handle,
    })),
  };
}

/** Whether two partial dates could be the same day: no part differs. */
function sameDay(a: AttachDate, b: AttachDate): boolean {
  const agree = (x: number | null, y: number | null) =>
    x === null || y === null || x === y;
  return (
    agree(a.year, b.year) && agree(a.month, b.month) && agree(a.day, b.day)
  );
}

/** Contact import over real repositories: vcard's `ImportPorts`, and the
 *  preview and commit the app calls. */
export function createImportApi(deps: ImportApiDeps) {
  const {
    people,
    pets,
    tags,
    milestones,
    relationships,
    contactMethods,
    self,
    deviceContactLinks,
    entities,
    duplicates,
    driver,
    regenerateSystem,
  } = deps;

  /** The entity a card's `UID` names, or `null`; its `kind` picks the one
   *  table to ask, so a malformed card finds nobody. */
  async function storedAs(
    contact: ParsedContact,
  ): Promise<AlreadyStored | null> {
    if (contact.uid === null) return null;
    const type = contact.kind === "pet" ? "pet" : "person";
    const entity = await entities.resolve(type, contact.uid);
    return entity === undefined
      ? null
      : { type, id: contact.uid, name: entityLabel(type, entity) };
  }

  /** The engine's attach ports over one import's pool. */
  function attachPorts(pool: AttachPool): ImportPorts["attach"] {
    return {
      target: async (contact) => pool.target(attachFieldsOf(contact)),
      into: async (personId, contact) => {
        const held = pool.known(personId);
        if (held === undefined) return contact;
        const incoming = pool.normalize(attachFieldsOf(contact));
        const gaps = {
          ...(held.middleName === null && contact.name.middleName
            ? { middleName: contact.name.middleName }
            : {}),
          ...(held.gender === null && contact.gender
            ? { gender: contact.gender }
            : {}),
        };
        if (Object.keys(gaps).length > 0) await people.update(personId, gaps);

        const lacks = (heldValues: { value: string }[], value: string) =>
          !heldValues.some((v) => v.value === value);
        const handleKey = (h: { platform: string; value: string }) =>
          `${fold(h.platform)}\u0000${h.value}`;
        const heldHandles = held.handles.map(handleKey);
        return {
          ...contact,
          emails: contact.emails.filter((_, i) =>
            lacks(held.emails, incoming.emails[i].value),
          ),
          phones: contact.phones.filter((_, i) =>
            lacks(held.phones, incoming.phones[i].value),
          ),
          postals: contact.postals.filter((_, i) =>
            lacks(held.postals, incoming.postals[i].value),
          ),
          socials: contact.socials.filter(
            (_, i) => !heldHandles.includes(handleKey(incoming.handles[i])),
          ),
          birthday: held.birthday === null ? contact.birthday : null,
          dates: contact.dates.filter(
            (d) =>
              !held.dates.some(
                (h) => h.kind === d.kind && sameDay(h.date, d.date),
              ),
          ),
        };
      },
      landed: (personId, contact) =>
        pool.landed(personId, attachFieldsOf(contact)),
    };
  }

  return {
    // Ports over raw repos, as the engine holds each contact's transaction.
    /** With `attach`, a person's contact may attach to someone stored; see
     *  the README's _Attaching a contact_. */
    commit: async (
      decisions: ImportDecision[],
      options: { attach?: boolean } = {},
    ): Promise<ImportResult> => {
      const pool = options.attach ? await duplicates.attachPool() : null;
      const ports: ImportPorts = {
        createPerson: (name, gender) =>
          // Blanks become `null`, or a mononym would fail `min(1)`.
          people.create({ ...nameInputFrom(name), gender }),
        // The first name, as we write a pet; the surname for a hand-made
        // `N:Jimmy;;;;`. The final `?? ""` is unreachable.
        createPet: (name, gender) => {
          const parts = nameInputFrom(name);
          return pets.create({
            name: parts.firstName ?? parts.lastName ?? "",
            gender,
          });
        },
        // Added to whatever the entity already has, as an attach may.
        addTags: async (entityType, entityId, names) => {
          const held = await tags.listForEntity(entityType, entityId);
          await tags.setEntityTags(entityType, entityId, [
            ...held.map((t) => t.name),
            ...names,
          ]);
        },
        addEmail: async (personId, email) => {
          await contactMethods.emails.create({
            ownerType: "person",
            ownerId: personId,
            label: email.label,
            address: email.address,
          });
        },
        addPhone: async (personId, phone) => {
          await contactMethods.phones.create({
            ownerType: "person",
            ownerId: personId,
            label: phone.label,
            number: phone.number,
            extension: phone.extension,
            smsCapable: phone.smsCapable,
          });
        },
        addPostal: async (personId, postal) => {
          await contactMethods.postals.create({
            ownerType: "person",
            ownerId: personId,
            label: postal.label,
            line1: postal.line1,
            line2: postal.line2,
            locality: postal.locality,
            region: postal.region,
            postalCode: postal.postalCode,
            country: postal.country,
          });
        },
        addSocial: async (personId, social) => {
          await contactMethods.socials.create({
            ownerType: "person",
            ownerId: personId,
            label: social.label,
            platform: social.platform,
            handle: social.handle,
            url: social.url,
            // Only a card we wrote carries it; nothing else can recover it.
            platformUserId: social.platformUserId,
          });
        },
        // ⚠️ The engine's bearer type: a pet's birthday stored as a person's
        // commits silently and is never listed.
        addBirthday: async (bearerType, bearerId, birthday) => {
          await milestones.create(
            {
              kind: "birthday",
              bearerType,
              bearerId,
              year: birthday.year,
              month: birthday.month,
              day: birthday.day,
            },
            { imported: true },
          );
        },
        // Kind and bearer are settled and checked; this only writes.
        addDate: async (bearerType, bearerId, date) => {
          await milestones.create(
            {
              kind: date.kind,
              bearerType,
              bearerId,
              year: date.date.year,
              month: date.date.month,
              day: date.date.day,
              // An `other` falls back to its label, for a hand-built payload.
              note: date.note ?? (date.kind === "other" ? date.label : null),
            },
            { imported: true },
          );
        },
        // A named relation: an unpublished person with one edge.
        addRelated: async (ownerType, ownerId, relation) => {
          const other = await people.create({
            ...splitName(relation.name),
            standing: "unpublished",
          });
          await relationships.create({
            // The owner's own type; a pet's card carries relations too.
            aType: ownerType,
            aId: ownerId,
            aRole: inverseRole(relation.role),
            bType: "person",
            bId: other.id,
            bRole: relation.role,
            bRoleNote: relation.roleNote,
          });
        },
        // Just the edge: both ends exist and are published, so no promotion.
        linkExisting: async (
          ownerType,
          ownerId,
          otherType,
          otherId,
          relation,
        ) => {
          // The engine maps the file's edge id to this new one.
          const row = await relationships.create({
            aType: ownerType,
            aId: ownerId,
            aRole: inverseRole(relation.role),
            bType: otherType,
            bId: otherId,
            bRole: relation.role,
            bRoleNote: relation.roleNote,
          });
          return { id: row.id };
        },
        // Not `core.self.set`, whose own reconcile the batch runs once at end.
        setSelf: async (personId) => {
          await self.setSelf(personId);
        },
        // Only a phone import has a source; a second link rolls back.
        linkSource: (sourceId, entity) =>
          deviceContactLinks.link(sourceId, entity),
        transaction: (body) => driver.transaction(body),
        attach: pool === null ? undefined : attachPorts(pool),
      };
      const result = await ingestContacts(ports, decisions);
      if (result.created + result.attached > 0) await regenerateSystem();
      return result;
    },
    /** Read-only: whom each contact resembles, and whom it is; see the
     *  README's _Two answers about an incoming card_. */
    preview: (
      contacts: ParsedContact[],
    ): Promise<
      {
        index: number;
        matches: DuplicateMatch[];
        alreadyStored: AlreadyStored | null;
      }[]
    > =>
      Promise.all(
        contacts.map(async (contact, index) => ({
          index,
          matches: await duplicates.matchContact({
            name: `${contact.name.firstName} ${contact.name.lastName}`.trim(),
            emails: contact.emails.map((e) => e.address),
            phones: contact.phones.map((p) => p.number),
            handles: contact.socials.map((s) => ({
              platform: s.platform,
              handle: s.handle,
            })),
          }),
          alreadyStored: await storedAs(contact),
        })),
      ),
  };
}
