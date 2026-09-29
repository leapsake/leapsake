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

// `data.json`: everything the `.vcf` cannot hold, as schema rows with four
// departures; see the README's _`data.json`_.

/** The file's version, read first by a restore; bumped only for a change of
 *  shape, since every table is an optional key. */
export const DATA_VERSION = 1;

/** A reminder's or gift idea's tags, by name. Joined with `.and()`, since
 *  `.extend()` would drop `reminderSchema`'s refinement. */
const tagged = z.object({ tags: z.array(z.string()) });

export const exportReminderSchema = reminderSchema.and(tagged);
export const exportGiftIdeaSchema = giftIdeaSchema.and(tagged);

/** A holiday by its legible slug, or null where the holiday row is gone. */
const holidayRef = z.object({ holidaySlug: z.string().nullable() });

export const exportObservanceSchema = observanceSchema.and(holidayRef);
export const exportHiddenHolidaySchema = hiddenHolidaySchema.and(holidayRef);

/** Notification preferences without one phone's OS facts; parsing a row
 *  through it strips them. */
export const exportNotificationSettingsSchema = notificationSettingsSchema.omit(
  { platform: true, permissionState: true },
);

/** What {@link DATA_VERSION} identifies: every table an optional key, though
 *  the writer emits them all. */
export const exportDataSchema = z.object({
  version: z.literal(DATA_VERSION),
  reminders: z.array(exportReminderSchema).optional(),
  mentions: z.array(mentioningSchema).optional(),
  reminderRules: z.array(reminderRuleSchema).optional(),
  giftIdeas: z.array(exportGiftIdeaSchema).optional(),
  giftRecipients: z.array(giftRecipientSchema).optional(),
  /** User-authored holidays only; the catalog reseeds itself. */
  holidays: z.array(holidaySchema).optional(),
  observances: z.array(exportObservanceSchema).optional(),
  hiddenHolidays: z.array(exportHiddenHolidaySchema).optional(),
  notADuplicate: z.array(notADuplicateSchema).optional(),
  relationshipDismissals: z.array(dismissalSchema).optional(),
  notificationSettings: z.array(exportNotificationSettingsSchema).optional(),
});

export type ExportData = z.infer<typeof exportDataSchema>;

/** Reads the ten tables into {@link exportDataSchema}. ⚠️ Never read a clock
 *  or iterate a `Set` or `Map` into the output: it must reproduce. */
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

  // A lookup only; nothing iterates it into the file.
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
