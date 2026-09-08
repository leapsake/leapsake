import {
  type ContactMethod,
  type EntityType,
  type GiftIdea,
  type GiftRecipient,
  type HiddenHoliday,
  type Holiday,
  type Mentioning,
  type Milestone,
  type MilestoneBearerType,
  type NotADuplicate,
  type NotificationSettings,
  type Observance,
  type Person,
  type Pet,
  type RelationshipNeighbor,
  type Reminder,
  type ReminderRule,
  type Tag,
  type TagBearerType,
  dismissalSchema,
} from "@leapsake/schema";
import type { z } from "zod";

/**
 * A rejected derived relationship, in its stored shape.
 *
 * Derived from the schema rather than imported as a type because
 * `@leapsake/data` deliberately owns the *behavioural* `Dismissal` (see
 * `dismissalSchema`'s own doc), and this package must not depend on the data
 * layer — that independence is what lets the builder unit-test with no sqlite
 * driver. The two shapes are the same row; the schema is the definition.
 */
export type Dismissal = z.infer<typeof dismissalSchema>;

/**
 * The **read** surface the exporter drives — the mirror of `@leapsake/vcard`'s
 * `ImportPorts`, and injected for the same reason: the archive builder unit-tests
 * against an in-memory fake with no sqlite driver, and this package never
 * depends on `@leapsake/core` or `@leapsake/data`. The composition root
 * (`@leapsake/core`) wires these over its repos.
 *
 * **Nothing here takes an "include deleted" flag, and that is deliberate.** Every
 * read below goes through `createEntityRepo`, which filters `deleted_at IS NULL`
 * structurally in `listWhere` and `get` (as `tags.listForEntity`'s join does),
 * so no implementation of *these* ports can surface a tombstone and the
 * exclusion is transitive without anybody remembering to make it so. That
 * matters here more than anywhere: the export is the one artifact that leaves
 * the device, so shipping rows the user told the app to forget is a privacy
 * surprise we could not take back. It also would not round-trip — vCard cannot
 * say "deleted", so every third-party import would resurrect them as live
 * contacts.
 *
 * ⚠️ **Any port added here must keep that true by construction**, and the three
 * tables `data.json` wants that no `createEntityRepo` covers — `mentions`,
 * `not_a_duplicate` and `relationship_dismissals` — are the case that nearly
 * broke it. Their only enumerating method used to be `listChangedSince(since)`,
 * which is `WHERE updated_at > ?` with no `deleted_at` clause on purpose, since
 * sync must carry tombstones; `listChangedSince(0)` reads like "give me
 * everything" and would have put deleted rows in this file. `listActive()` on
 * `defineSyncable` is the filtered read they got instead, so **every** synced
 * table now has one and a new port has something correct to reach for.
 *
 * `listPeople` and `listPets` likewise return only *published* entities, because
 * `people.list()`/`pets.list()` are the user's own catalog (`PUBLISHED_SQL`).
 * Someone who exists only as a fact about another person gets **no card of their
 * own**: they are a `RELATED` on the card of the one person they hang off, which
 * is exactly what the store says about them. `neighborsFor` is how the exporter
 * reaches them, and it is the only way an unpublished row enters the file.
 */
export interface ExportPorts {
  /** Every published, undeleted person — the cards the file is made of. */
  listPeople(): Promise<Person[]>;
  /** Every published, undeleted pet. Each gets a `KIND:x-pet` card. */
  listPets(): Promise<Pet[]>;
  /** Pets have none — a contact method's owner is a person or a household. */
  contactMethodsFor(personId: string): Promise<ContactMethod[]>;
  /**
   * A bearer's milestones. The bearer is a person, a pet, **or a relationship** —
   * a wedding is stored on the marriage rather than on either partner, and an
   * exporter that only asked for `person` would leave every one of them out.
   */
  milestonesFor(
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<Milestone[]>;
  /**
   * A tag bearer's tags. `TagBearerType`, not `EntityType`: a reminder and a
   * gift idea bear tags too, and theirs have no `CATEGORIES` line to ride —
   * they travel in `data.json` instead, by name, so this one port serves both
   * files.
   */
  tagsFor(type: TagBearerType, id: string): Promise<Tag[]>;
  /**
   * An entity's relationships, oriented so the *other* end is resolved.
   *
   * **Explicit edges only.** The kinship engine also computes "derived" ones —
   * your parent's sibling is your pibling — and those have no stored row and no
   * id. Exporting them would write inferences into the file as if the user had
   * recorded them, and a re-import would then store what was computed, so the
   * inference stops being live. The implementation must not return them.
   *
   * An edge whose other end is soft-deleted does not come back either, for the
   * same structural reason the rest of this interface has no `includeDeleted`:
   * the resolver skips an endpoint that no longer reads.
   */
  neighborsFor(type: EntityType, id: string): Promise<RelationshipNeighbor[]>;
  /** The `self_person` row's person id — the card that gets `X-LEAPSAKE-SELF`. */
  selfPersonId(): Promise<string | null>;
  /** Everything that is not person-shaped — the `data.json` half. */
  data: ExportDataPorts;
}

/**
 * The reads behind `data.json` — the tables that belong to no single card, and
 * which would make Apple import your reminders as contacts if the exporter
 * tried to invent a `KIND:x-leapsake-*` record for them.
 *
 * One method per table, all of them whole-table reads, because unlike the
 * person graph there is no walk here: the file is a snapshot of ten tables.
 * Seven answer with `EntityRepo.list()`; the three without one answer with
 * `SyncableRepo.listActive()`. Both are `deleted_at IS NULL` by construction —
 * see the warning above, which is about exactly these.
 */
export interface ExportDataPorts {
  listReminders(): Promise<Reminder[]>;
  /** The people and pets a reminder's text refers to. */
  listMentions(): Promise<Mentioning[]>;
  listReminderRules(): Promise<ReminderRule[]>;
  listGiftIdeas(): Promise<GiftIdea[]>;
  listGiftRecipients(): Promise<GiftRecipient[]>;
  /**
   * The **whole** holiday table, catalog rows included — but only
   * `origin: "user"` rows are written to the file. The catalog is read-only and
   * the app reseeds it, so exporting it would bloat the archive with data that
   * regenerates itself; the catalog rows are read anyway because they are what
   * resolves an observance's `holidayId` back to its stable slug.
   */
  listHolidays(): Promise<Holiday[]>;
  listObservances(): Promise<Observance[]>;
  listHiddenHolidays(): Promise<HiddenHoliday[]>;
  /** The user's "these two are not the same person" judgments. */
  listNotADuplicate(): Promise<NotADuplicate[]>;
  listRelationshipDismissals(): Promise<Dismissal[]>;
  /**
   * Every device's notification row. Only the *preferences* are written — see
   * `exportNotificationSettingsSchema`.
   */
  listNotificationSettings(): Promise<NotificationSettings[]>;
}
