import type { ContactMethod, Milestone, Person, Tag } from "@leapsake/schema";

/**
 * The **read** surface the exporter drives — the mirror of `@leapsake/vcard`'s
 * `ImportPorts`, and injected for the same reason: the archive builder unit-tests
 * against an in-memory fake with no sqlite driver, and this package never
 * depends on `@leapsake/core` or `@leapsake/data`. The composition root
 * (`@leapsake/core`) wires these over its repos.
 *
 * **Nothing here takes an "include deleted" flag, and that is deliberate.** Every
 * read in `@leapsake/data` filters `deleted_at IS NULL` structurally — it is
 * baked into `createEntityRepo`'s `listWhere` and `get`, and into
 * `tags.listForEntity`'s join — so an implementation of these ports cannot
 * accidentally surface a tombstone, and the exclusion is transitive without
 * anybody remembering to make it so. That matters here more than anywhere: the
 * export is the one artifact that leaves the device, so shipping rows the user
 * told the app to forget is a privacy surprise we could not take back. It also
 * would not round-trip — vCard cannot say "deleted", so every third-party import
 * would resurrect them as live contacts.
 *
 * `listPeople` likewise returns only *published* people, because `people.list()`
 * is the user's own catalog (`PUBLISHED_SQL`). Someone who exists only as a fact
 * about another person belongs on that person's card as a `RELATED`, which is
 * `plans/export.md` increment 2.
 */
export interface ExportPorts {
  /** Every published, undeleted person — the cards the file is made of. */
  listPeople(): Promise<Person[]>;
  contactMethodsFor(personId: string): Promise<ContactMethod[]>;
  milestonesFor(personId: string): Promise<Milestone[]>;
  tagsFor(personId: string): Promise<Tag[]>;
}
