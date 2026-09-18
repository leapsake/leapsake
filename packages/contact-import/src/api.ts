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

/**
 * The entity an incoming card **is**, when its `UID` names one already stored.
 *
 * Distinct from a `DuplicateMatch`, which says an incoming card *resembles*
 * somebody. This one is an identity, established by id rather than scored: our
 * own exporter writes each entity's `people.id`/`pets.id` as the card's `UID`,
 * so a card carrying one we hold is that entity coming home. It covers pets,
 * which the duplicate detector does not, and carries `type` for that reason.
 *
 * Import still creates a **new** entity for such a card — the review's job is to
 * let the user skip it. Writing the file's ids back is a restore
 * (`plans/v0-2.md` → *Export*), not this.
 */
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
  /**
   * Reconcile the automated reminders after a batch that created anything, so
   * imported birthdays reach the Home list at once. A port because reconciling
   * is `@leapsake/reminders`' business, not this package's.
   */
  regenerateSystem: () => Promise<unknown>;
}

/**
 * Contact import as the app performs it: the repo-backed half of bringing a
 * parsed address book in.
 *
 * The parsing and the ingest *engine* are `@leapsake/vcard`, which owns the
 * format and stays free of any storage dependency. This package is the other
 * side of that seam — it builds `ImportPorts` over real repositories and drives
 * `ingestContacts` through them — which is why the two are separate packages
 * rather than one.
 */
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

  /**
   * The entity an incoming card's `UID` names, or `null` when it names none —
   * how `import.preview` tells "this is a new person" from "this is a person you
   * already have". See {@link AlreadyStored}.
   *
   * The card's `kind` decides which table to ask, rather than both being tried:
   * ids are UUIDs, so a collision across the two is not the risk — asking the
   * wrong one is. A pet card whose id happens to name a person is a malformed
   * file, and answering "already stored: Jane Wainwright" for it would be worse than
   * answering nothing.
   */
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
    // Commit the reviewed decisions. The ingest engine drives the injected ports
    // below; each contact commits in its own `driver.transaction` (one bad row
    // rolls back alone), and the automated birthday reminders reconcile once
    // after the batch — the same `regenerateSystem` a manual birthday triggers,
    // so imported birthdays surface on the Home list at once.
    commit: async (decisions: ImportDecision[]): Promise<ImportResult> => {
      const ports: ImportPorts = {
        createPerson: (name, gender) =>
          // Through `nameInputFrom`, not field-by-field: a card's blank part
          // is `""`, and the Person schema spells absent as `null`. Handing it
          // the raw strings would fail `min(1)` on exactly the mononym and
          // organisation-only cards this import is meant to accept.
          people.create({ ...nameInputFrom(name), gender }),
        // `petSchema` is a single `name`, so one slot of the card's name has
        // to be it — the first, which is the mononym shape `toPetContact`
        // writes on the way out. The surname fallback is for the one card our
        // own writer never produces but a hand-made one might (`N:Jimmy;;;;`,
        // which `deriveName` reads as a surname-only person): without it that
        // pet is refused mid-batch by `petSchema`'s `min(1)`, which is a
        // confusing way to lose a row. The engine has already refused a card
        // with no name at all, so the final `?? ""` is unreachable.
        createPet: (name, gender) => {
          const parts = nameInputFrom(name);
          return pets.create({
            name: parts.firstName ?? parts.lastName ?? "",
            gender,
          });
        },
        // The same call `people.create`/`pets.create` make for a manually
        // created entity — but over the raw repo, with no `driver.transaction`
        // of its own, because the engine has already opened one and the
        // driver's BEGIN/COMMIT does not nest.
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
            // Only ever set for a card we wrote, which is the whole reason the
            // writer emits it: the platform keys DMs on an id it does not
            // publish beside the handle, so it is unrecoverable from the rest
            // of the row and would otherwise be the one thing a backup lost.
            platformUserId: social.platformUserId,
          });
        },
        // The bearer's type comes from the engine rather than being assumed —
        // a pet's card carries a birthday too. Hardcoding `"person"` here did
        // not fail loudly the way `addRelated`'s did: a pet birthday committed
        // against `bearer_type = 'person'` and then went missing from the pet,
        // because `listForBearer("pet", …)` could never find it.
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
        // The kind and the bearer are both settled before this runs — the
        // parser read the kind off the card (or resolved it from the label for
        // a foreign one), and the engine chose the bearer and checked that the
        // kind may be held by it. This only writes the row.
        addDate: async (bearerType, bearerId, date) => {
          await milestones.create({
            kind: date.kind,
            bearerType,
            bearerId,
            year: date.date.year,
            month: date.date.month,
            day: date.date.day,
            // The card's own `-NOTE` wins; the label is the fallback, because
            // the writer deliberately omits the parameter when the note *is*
            // the label — which is what it means on an `other`-kind milestone.
            // The parser already applies that fallback, so this is what keeps
            // a hand-built IPC payload honest.
            note: date.note ?? (date.kind === "other" ? date.label : null),
          });
        },
        // Somebody the card merely named becomes an unpublished person with
        // one edge — the same thing `relationships.createWithNewOther` makes,
        // spelled over the raw repos because the engine is already inside a
        // transaction and the driver's BEGIN/COMMIT doesn't nest.
        addRelated: async (ownerType, ownerId, relation) => {
          const other = await people.create({
            ...splitName(relation.name),
            standing: "unpublished",
          });
          await relationships.create({
            // The owner's own type, not a hardcoded `"person"` — a pet's card
            // carries relations too, and `holderAllows` refuses a mismatch
            // outright rather than writing a wrong row quietly.
            aType: ownerType,
            aId: ownerId,
            aRole: inverseRole(relation.role),
            bType: "person",
            bId: other.id,
            bRole: relation.role,
            bRoleNote: relation.roleNote,
          });
        },
        // Both ends already exist, so unlike `addRelated` there is nobody to
        // create — just the edge. Spelled over the raw repo rather than through
        // `createFromSubject`, which opens a transaction of its own and would
        // also run the promotion rule; both ends came from cards of their own
        // and are already published.
        linkExisting: async (
          ownerType,
          ownerId,
          otherType,
          otherId,
          relation,
        ) => {
          // The new row's id goes back to the engine: a milestone this edge
          // bears names the id the edge had *in the file*, and the map between
          // the two is built out of these.
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
        // The raw repo, not `core.self.set` — that one runs its own
        // `regenerateSystem`, which the batch already does once at the end,
        // and it would fire inside the engine's transaction.
        setSelf: async (personId) => {
          await self.setSelf(personId);
        },
        // Only a phone import carries a source; the engine calls this inside
        // the contact's transaction, and the table's primary key refusing a
        // second link is what rolls a racing duplicate back.
        linkSource: (sourceId, entity) =>
          deviceContactLinks.link(sourceId, entity),
        transaction: (body) => driver.transaction(body),
      };
      const result = await ingestContacts(ports, decisions);
      if (result.created > 0) await regenerateSystem();
      return result;
    },
    /**
     * Read-only: for each parsed contact, what the review needs to warn about
     * before anything is written — the active people it *resembles*, and
     * whether it **is** somebody already stored. Never writes.
     *
     * The two are deliberately separate answers. `matches` is
     * `matchContact`'s resemblance score over names and contact methods;
     * `alreadyStored` is an id lookup, and an id is not a resemblance. Folding
     * the second into the first would mean saying "very likely already in
     * Leapsake" about a certainty, and would have nowhere to put a **pet** —
     * `DuplicateMatch.personId` cannot honestly hold a pet's id, and the
     * duplicate detector's pool is published people alone.
     *
     * This is what stops a user re-importing their own export from getting a
     * second copy of everyone: our own cards carry the `people.id`/`pets.id`
     * they came from as their `UID`, so the match is exact rather than
     * guessed. A `get` excludes soft-deleted rows on purpose — somebody the
     * user deleted and then re-imported should come back as new, not as a
     * clash with a tombstone.
     */
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
