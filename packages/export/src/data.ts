import {
  type Holiday,
  type NotificationSettings,
  type Tag,
  type TagBearerType,
  dismissalSchema,
  giftIdeaSchema,
  giftRecipientSchema,
  hiddenHolidaySchema,
  holidaySchema,
  mentioningSchema,
  notADuplicateSchema,
  notificationSettingsSchema,
  observanceSchema,
  reminderRuleSchema,
  reminderSchema,
} from "@leapsake/schema";
import { z } from "zod";
import type { ExportPorts } from "./ports.js";

/**
 * `data.json` — everything the `.vcf` cannot hold.
 *
 * A vCard is a person. Reminders, gift ideas, the user's holiday choices, the
 * duplicate judgments they made and their notification preferences belong to no
 * single card, and appending them as fabricated `KIND:x-leapsake-*` records
 * would make Apple Contacts import somebody's reminders as human beings. So
 * they go in a companion file inside the same archive, which **duplicates
 * nothing** in the `.vcf`: no fact is written twice across the two.
 *
 * The format is the rows as `@leapsake/schema` spells them, with four
 * deliberate departures, each marked below: tags travel as names, holidays
 * travel by slug, catalog holidays do not travel at all, and a device's OS facts
 * do not travel.
 */

/**
 * The version stamped into the file, and the thing a future restore path reads
 * first.
 *
 * It shipped from the first commit, while the file still held nothing else,
 * because the first release already put it on users' disks: adding fields to an
 * identified file later is ordinary, retrofitting a version onto one already in
 * the wild is not. Filling the file did **not** bump it — every table below is
 * its own optional key, so a file written by an older app still parses, and the
 * version is reserved for a change of *shape*.
 */
export const DATA_VERSION = 1;

/**
 * A tag on a reminder or a gift idea, carried **by name**.
 *
 * People and pets carry theirs as `CATEGORIES` in the `.vcf`; these two bearers
 * have no card, so without this a tag the user put on a reminder would vanish
 * from their backup silently. Names rather than ids for the same reason
 * `CATEGORIES` uses them: they are what a human reads, and a restore re-creates
 * them through the `tags.setEntityTags(type, id, names)` the app already writes
 * every tag with — so the file never has to carry the `tags`/`taggings` tables
 * and their ids.
 *
 * `.and()` rather than `.extend()` because `reminderSchema` is `.refine()`d
 * (title-or-body), and the intersection keeps that check.
 */
const tagged = z.object({ tags: z.array(z.string()) });

export const exportReminderSchema = reminderSchema.and(tagged);
export const exportGiftIdeaSchema = giftIdeaSchema.and(tagged);

/**
 * A holiday reference the file can resolve on its own.
 *
 * The row's `holidayId` is `deterministicUuid(HOLIDAY_NAMESPACE, slug)`, so the
 * two agree by construction — but only the slug is *legible*, and it is the key
 * `ux_holidays_slug_active` makes stable. Null where the holiday row itself is
 * gone: honest, rather than dropping the observance and losing the user's
 * answer with it.
 */
const holidayRef = z.object({ holidaySlug: z.string().nullable() });

export const exportObservanceSchema = observanceSchema.and(holidayRef);
export const exportHiddenHolidaySchema = hiddenHolidaySchema.and(holidayRef);

/**
 * Notification **preferences**, without the two columns that are facts about one
 * phone rather than choices: `permissionState` (what that OS last answered) and
 * `platform`. Restoring "notifications allowed" onto a new device would be a
 * lie the app then acts on. `label` stays — the user typed it.
 *
 * `.omit()` also does the stripping: a Zod object drops unknown keys, so
 * parsing a full row through this schema is how a row becomes an exported one.
 */
export const exportNotificationSettingsSchema = notificationSettingsSchema.omit(
  { platform: true, permissionState: true },
);

/**
 * What {@link DATA_VERSION} identifies. Every table is its **own optional key**,
 * which is what lets a file written by an older app parse against a newer
 * schema — the reader decides what an absent table means, and the version is
 * left for a change of shape. The writer always emits every key, empty arrays
 * included, so the file reads as a full inventory.
 */
export const exportDataSchema = z.object({
  version: z.literal(DATA_VERSION),
  reminders: z.array(exportReminderSchema).optional(),
  mentions: z.array(mentioningSchema).optional(),
  reminderRules: z.array(reminderRuleSchema).optional(),
  giftIdeas: z.array(exportGiftIdeaSchema).optional(),
  giftRecipients: z.array(giftRecipientSchema).optional(),
  /** User-authored holidays only — the catalog reseeds itself. */
  holidays: z.array(holidaySchema).optional(),
  observances: z.array(exportObservanceSchema).optional(),
  hiddenHolidays: z.array(exportHiddenHolidaySchema).optional(),
  notADuplicate: z.array(notADuplicateSchema).optional(),
  relationshipDismissals: z.array(dismissalSchema).optional(),
  notificationSettings: z.array(exportNotificationSettingsSchema).optional(),
});

export type ExportData = z.infer<typeof exportDataSchema>;

/**
 * Read the ten tables and shape them into {@link exportDataSchema}.
 *
 * `rows` is what the caller reports as `counts.otherRecords` — without it,
 * filling this file changes nothing a user can see after tapping Export, and
 * the on-device harness has no way to tell an archive that carries their
 * reminders from one that does not.
 *
 * **Nothing here may read a clock or iterate a `Set`/`Map` into the output.**
 * The archive is asserted reproducible byte-for-byte for a fixed instant, so
 * every array must come out in the order its read gave it (`listActive` orders
 * by `created_at`; the entity repos by their own `orderBy`).
 */
export async function buildExportData(
  ports: ExportPorts,
): Promise<{ data: ExportData; rows: number }> {
  const d = ports.data;
  const tagsFor = (type: TagBearerType, id: string): Promise<Tag[]> =>
    ports.tagsFor(type, id);
  const [
    reminders,
    mentions,
    reminderRules,
    giftIdeas,
    giftRecipients,
    holidays,
    observances,
    hiddenHolidays,
    notADuplicate,
    relationshipDismissals,
    notificationSettings,
  ] = await Promise.all([
    d.listReminders(),
    d.listMentions(),
    d.listReminderRules(),
    d.listGiftIdeas(),
    d.listGiftRecipients(),
    d.listHolidays(),
    d.listObservances(),
    d.listHiddenHolidays(),
    d.listNotADuplicate(),
    d.listRelationshipDismissals(),
    d.listNotificationSettings(),
  ]);

  // One read of the holiday table answers both questions it is needed for:
  // which rows the user authored, and what slug each id stands for. The map is
  // a lookup only — nothing iterates it into the file.
  const slugs = new Map(holidays.map((holiday) => [holiday.id, holiday.slug]));
  const slugOf = (holidayId: string): string | null =>
    slugs.get(holidayId) ?? null;

  const data: ExportData = {
    version: DATA_VERSION,
    reminders: await withTags(reminders, "reminder", tagsFor),
    mentions,
    reminderRules,
    giftIdeas: await withTags(giftIdeas, "gift_idea", tagsFor),
    giftRecipients,
    holidays: holidays.filter((holiday: Holiday) => holiday.origin === "user"),
    observances: observances.map((observance) => ({
      ...observance,
      holidaySlug: slugOf(observance.holidayId),
    })),
    hiddenHolidays: hiddenHolidays.map((hidden) => ({
      ...hidden,
      holidaySlug: slugOf(hidden.holidayId),
    })),
    notADuplicate,
    relationshipDismissals,
    notificationSettings: notificationSettings.map(
      (row: NotificationSettings) =>
        exportNotificationSettingsSchema.parse(row),
    ),
  };

  const rows = Object.values(data).reduce<number>(
    (total, value) => total + (Array.isArray(value) ? value.length : 0),
    0,
  );

  return { data, rows };
}

/** Attach each row's tag names, in the order the tags repo answers them. */
async function withTags<T extends { id: string }>(
  rows: T[],
  type: TagBearerType,
  tagsFor: (type: TagBearerType, id: string) => Promise<Tag[]>,
): Promise<(T & { tags: string[] })[]> {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      tags: (await tagsFor(type, row.id)).map((tag) => tag.name),
    })),
  );
}
