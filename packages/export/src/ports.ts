import type {
  ContactMethod,
  EntityType,
  Milestone,
  MilestoneBearerType,
  Person,
  Pet,
  RelationshipNeighbor,
  Tag,
} from "@leapsake/schema";

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
 * ⚠️ **Any port added here must keep that true by construction, and three tables
 * `data.json` wants cannot.** `mentions`, `not_a_duplicate` and
 * `relationship_dismissals` are `SyncableRepo`s with no filtered list-all;
 * `listChangedSince(since)` is the only method that enumerates one, and it is
 * `WHERE updated_at > ?` with no `deleted_at` clause — on purpose, since sync
 * must carry tombstones. `listChangedSince(0)` reads like "give me everything"
 * and is the way this invariant gets broken. Add a filtered read to those repos
 * rather than reaching for it.
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
  tagsFor(type: EntityType, id: string): Promise<Tag[]>;
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
}
