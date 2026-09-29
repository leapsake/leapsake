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

/** A rejected derived relationship's row, from the schema, as this package
 *  may not import `@leapsake/data`. */
export type Dismissal = z.infer<typeof dismissalSchema>;

/**
 * The reads the exporter drives. ⚠️ None may surface a tombstone: a new port
 * reaches for `listActive()`, never `listChangedSince(0)`; see the README.
 */
export interface ExportPorts {
  /** Every published, undeleted person: the file's cards. */
  listPeople(): Promise<Person[]>;
  /** Every published, undeleted pet. Each gets a `KIND:x-pet` card. */
  listPets(): Promise<Pet[]>;
  /** Pets have none: a contact method belongs to a person or household. */
  contactMethodsFor(personId: string): Promise<ContactMethod[]>;
  /** A bearer's milestones, a relationship included, which holds weddings. */
  milestonesFor(
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<Milestone[]>;
  /** A tag bearer's tags, for both files: reminders and ideas bear tags too. */
  tagsFor(type: TagBearerType, id: string): Promise<Tag[]>;
  /** An entity's explicit relationships, never derived ones, with the other
   *  end resolved; a deleted end is skipped. */
  neighborsFor(type: EntityType, id: string): Promise<RelationshipNeighbor[]>;
  /** The `self_person` id: the card that gets `X-LEAPSAKE-SELF`. */
  selfPersonId(): Promise<string | null>;
  /** Everything not person-shaped: the `data.json` half. */
  data: ExportDataPorts;
}

/** The whole-table reads behind `data.json`, each tombstone-free by
 *  construction. */
export interface ExportDataPorts {
  listReminders(): Promise<Reminder[]>;
  /** The people and pets a reminder's text refers to. */
  listMentions(): Promise<Mentioning[]>;
  listReminderRules(): Promise<ReminderRule[]>;
  listGiftIdeas(): Promise<GiftIdea[]>;
  listGiftRecipients(): Promise<GiftRecipient[]>;
  /** The whole holiday table: user rows are written, catalog rows only
   *  resolve observances to slugs. */
  listHolidays(): Promise<Holiday[]>;
  listObservances(): Promise<Observance[]>;
  listHiddenHolidays(): Promise<HiddenHoliday[]>;
  /** The user's "these two are not the same person" judgments. */
  listNotADuplicate(): Promise<NotADuplicate[]>;
  listRelationshipDismissals(): Promise<Dismissal[]>;
  /** Every device's notification row, of which only preferences are written. */
  listNotificationSettings(): Promise<NotificationSettings[]>;
}
