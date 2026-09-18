import { z } from "zod";
import type { DefaultReminderRule } from "./milestone.js";
import type { ReminderRule, ReminderRuleInput } from "./reminder-rule.js";

/**
 * The namespace a catalog holiday's id is derived under, from its slug. Never
 * change it: every catalog row would re-mint and duplicate on sync.
 */
export const HOLIDAY_NAMESPACE = "leapsake:holiday";

/**
 * The namespace an observance's id is derived under, from its unique key, so
 * two devices asserting one observance write the same row.
 */
export const OBSERVANCE_NAMESPACE = "leapsake:observance";

/** As {@link OBSERVANCE_NAMESPACE}, keyed on the holiday alone. */
export const HIDDEN_HOLIDAY_NAMESPACE = "leapsake:hidden-holiday";

/** The name a catalog holiday's id is derived from. */
export function holidayIdName(slug: string): string {
  return slug;
}

/** The name an observance's id is derived from. */
export function observanceIdName(
  holidayId: string,
  bearerType: ObservanceBearerType,
  bearerId: string,
): string {
  return `${holidayId}:${bearerType}:${bearerId}`;
}

/** The name a hidden-holiday row's id is derived from. */
export function hiddenHolidayIdName(holidayId: string): string {
  return holidayId;
}

/** Where a holiday came from; catalog rows are read-only. */
export const holidayOriginSchema = z.enum(["catalog", "user"]);

export type HolidayOrigin = z.infer<typeof holidayOriginSchema>;

/**
 * A catalog holiday or one the user authored. A plain `z.object` so the repo
 * can derive columns from `.shape`.
 */
export const holidaySchema = z.object({
  id: z.uuid(),
  /** Stable, readable identity; a catalog row's `id` is derived from it. */
  slug: z.string().min(1),
  name: z.string().min(1),
  /** The occasion phrase reminder copy interpolates — "a Merry Christmas". */
  greeting: z.string().min(1),
  /**
   * The recurrence rule as canonical JSON, left unparsed so a rule from a newer
   * build still syncs; `@leapsake/holidays` parses it at read time.
   */
  recurrence: z.string().min(1),
  /** Days a multi-day holiday lasts, for display; occurrences use the start. */
  durationDays: z.number().int().min(1).nullable(),
  /** Groups variants of one idea (`us-mothers-day` / `uk-mothering-sunday`). */
  familyId: z.string().nullable(),
  /** Whether it is safe to infer from the user's own locale. */
  impliedByLocale: z.boolean(),
  origin: holidayOriginSchema,
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type Holiday = z.infer<typeof holidaySchema>;

/** The entities that can observe a holiday. */
export const observanceBearerTypeSchema = z.enum(["person", "pet"]);

export type ObservanceBearerType = z.infer<typeof observanceBearerTypeSchema>;

/**
 * "Grandma observes Hanukkah", or with `observes: false` "Violet doesn't do
 * Christmas". No row means the implicit answer stands.
 */
export const observanceSchema = z.object({
  id: z.uuid(),
  holidayId: z.uuid(),
  bearerType: observanceBearerTypeSchema,
  bearerId: z.uuid(),
  observes: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type Observance = z.infer<typeof observanceSchema>;

/**
 * A hidden catalog holiday. Hiding suppresses its reminders as well as its
 * listing, and never deletes observances.
 */
export const hiddenHolidaySchema = z.object({
  id: z.uuid(),
  holidayId: z.uuid(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type HiddenHoliday = z.infer<typeof hiddenHolidaySchema>;

/**
 * What an observance with no stored rules offers. Nothing is on by default:
 * every observance of one holiday would come due on the same day.
 */
export const observanceDefaultReminderSchedule: DefaultReminderRule[] = [
  { action: "get:gift", offsetDays: 12, enabledByDefault: false },
  { action: "get:card", offsetDays: 12, enabledByDefault: false },
  { action: "send:card", offsetDays: 7, enabledByDefault: false },
  { action: "wish", offsetDays: 0, enabledByDefault: false },
];

/**
 * An observance's stored rules, or {@link observanceDefaultReminderSchedule}
 * when it has none, furthest lead first.
 */
export function resolveObservanceReminderSchedule(
  storedRules: ReminderRule[],
): ReminderRuleInput[] {
  const source: ReminderRuleInput[] =
    storedRules.length > 0
      ? storedRules.map((r) => ({
          action: r.action,
          label: r.label,
          offsetDays: r.offsetDays,
          enabled: r.enabled,
        }))
      : observanceDefaultReminderSchedule.map((d) => ({
          action: d.action,
          label: null,
          offsetDays: d.offsetDays,
          enabled: d.enabledByDefault,
        }));
  return [...source].sort((a, b) => b.offsetDays - a.offsetDays);
}

/**
 * Format a `YYYY-MM-DD` occurrence. Built in local time, since `new Date(iso)`
 * reads UTC midnight and shows the day before west of Greenwich.
 */
export function formatOccurrence(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
