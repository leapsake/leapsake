import {
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
} from "@leapsake/data";
import { entityLabel, inverseRole, splitName } from "@leapsake/schema";
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

  return {
    // Ports over raw repos, as the engine holds each contact's transaction.
    commit: async (decisions: ImportDecision[]): Promise<ImportResult> => {
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
        // As a manual create tags, minus its own transaction.
        addTags: async (entityType, entityId, names) => {
          await tags.setEntityTags(entityType, entityId, names);
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
            country: phone.country,
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
          await milestones.create({
            kind: "birthday",
            bearerType,
            bearerId,
            year: birthday.year,
            month: birthday.month,
            day: birthday.day,
          });
        },
        // Kind and bearer are settled and checked; this only writes.
        addDate: async (bearerType, bearerId, date) => {
          await milestones.create({
            kind: date.kind,
            bearerType,
            bearerId,
            year: date.date.year,
            month: date.date.month,
            day: date.date.day,
            // An `other` falls back to its label, for a hand-built payload.
            note: date.note ?? (date.kind === "other" ? date.label : null),
          });
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
      };
      const result = await ingestContacts(ports, decisions);
      if (result.created > 0) await regenerateSystem();
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
