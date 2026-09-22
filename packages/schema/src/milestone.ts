import { z } from "zod";
import {
  type KnownReminderAction,
  type ReminderAction,
  type ReminderRule,
  type ReminderRuleInput,
  actionDefOf,
  reminderRuleInputSchema,
  verbOf,
} from "./reminder-rule.js";

/**
 * What a milestone can hang off. Wider than `entityTypeSchema`: a wedding
 * belongs to the relationship, which holds no relationship role itself.
 */
export const milestoneBearerTypeSchema = z.enum([
  "person",
  "pet",
  "relationship",
]);

export type MilestoneBearerType = z.infer<typeof milestoneBearerTypeSchema>;

/**
 * The big dates in someone's life, in UI listing order. `other` takes its
 * label from the milestone's `note`.
 */
export const milestoneKindSchema = z.enum([
  "birthday",
  "death",
  "first-date",
  "wedding",
  "met",
  "graduation",
  "job-start",
  "moved",
  "other",
]);

export type MilestoneKind = z.infer<typeof milestoneKindSchema>;

/** Whether a value, such as a `?kind=` parameter, is a milestone kind. */
export function isMilestoneKind(value: unknown): value is MilestoneKind {
  return milestoneKindSchema.safeParse(value).success;
}

/**
 * One entry in a kind's default schedule. An action the kind never wants is
 * absent; `enabledByDefault: false` means offered but off.
 */
export interface DefaultReminderRule {
  action: KnownReminderAction;
  offsetDays: number;
  enabledByDefault: boolean;
}

/** How a milestone kind displays, what it attaches to, and what it reminds. */
export interface MilestoneKindDef {
  /** Display label, e.g. "Birthday". */
  label: string;
  /** Optional emoji shown beside the label. */
  icon?: string;
  /**
   * Bearer types that may hold this kind, preferred first. A wedding can sit on
   * a person until its relationship exists.
   */
  allowedBearerTypes: MilestoneBearerType[];
  /** Whether this kind recurs every year. */
  recursAnnually: boolean;
  /**
   * What a milestone with no stored rules offers. The engine reminds of every
   * entry with `enabledByDefault` set.
   */
  defaultReminderSchedule: DefaultReminderRule[];
  /** The phrase a `wish` interpolates, with its article: "a happy birthday". */
  greeting: string;
  /**
   * The greeting once the occasion has passed: "a happy belated birthday".
   * Absent keeps the plain greeting.
   */
  belatedGreeting?: string;
  /**
   * The whole title of a `wish` about the user's own occasion, icon included:
   * "🎂 It's your birthday!". Absent keeps the ordinary copy.
   */
  selfWish?: { plain: string; belated: string };
  /**
   * Whether the occasion belongs to a couple, so one held by your partner is
   * yours too and worded as shared.
   */
  coupled?: true;
  /**
   * Present when an unconfigured occasion of this kind asks what to do for it,
   * offering its default schedule. `occasion` is the noun the question uses.
   */
  prompt?: { occasion: string; onlyOwnPartnership?: true };
}

/** Every milestone kind's definition, in UI listing order. */
export const kindDefs: Record<MilestoneKind, MilestoneKindDef> = {
  birthday: {
    label: "Birthday",
    icon: "🎂",
    allowedBearerTypes: ["person", "pet"],
    recursAnnually: true,
    greeting: "a happy birthday",
    belatedGreeting: "a happy belated birthday",
    selfWish: {
      plain: "🎂 It's your birthday!",
      belated: "🎂 It was your birthday!",
    },
    prompt: { occasion: "birthday" },
    // The day-of wish is the only reminder on by default for any kind.
    defaultReminderSchedule: [
      { action: "get:gift", offsetDays: 12, enabledByDefault: false },
      { action: "get:card", offsetDays: 12, enabledByDefault: false },
      // One offset for both, because the prompt asks "by mail?" only once.
      { action: "send:card", offsetDays: 7, enabledByDefault: false },
      { action: "send:gift", offsetDays: 7, enabledByDefault: false },
      { action: "wish", offsetDays: 0, enabledByDefault: true },
    ],
  },
  death: {
    label: "Death",
    icon: "🕯️",
    allowedBearerTypes: ["person", "pet"],
    recursAnnually: true,
    greeting: "a peaceful remembrance",
    defaultReminderSchedule: [
      { action: "remember", offsetDays: 0, enabledByDefault: false },
    ],
  },
  "first-date": {
    label: "First Date",
    icon: "💞",
    allowedBearerTypes: ["relationship", "person"],
    recursAnnually: true,
    greeting: "a happy anniversary",
    selfWish: {
      plain: "\u{1F49E} It's your anniversary!",
      belated: "\u{1F49E} It was your anniversary",
    },
    coupled: true,
    prompt: { occasion: "first date", onlyOwnPartnership: true },
    defaultReminderSchedule: [
      { action: "get:card", offsetDays: 12, enabledByDefault: false },
      { action: "send:card", offsetDays: 7, enabledByDefault: false },
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  // Shown as "Anniversary": unqualified, the word means a wedding anniversary.
  wedding: {
    label: "Anniversary",
    icon: "\u{1F48D}",
    // Relationship first; a person holds one whose spouse is not known yet.
    allowedBearerTypes: ["relationship", "person"],
    recursAnnually: true,
    greeting: "a happy anniversary",
    belatedGreeting: "a happy belated anniversary",
    selfWish: {
      plain: "\u{1F48D} It's your anniversary!",
      belated: "\u{1F48D} It was your anniversary",
    },
    coupled: true,
    prompt: { occasion: "anniversary" },
    // One offset for each pair, because the prompt asks "by mail?" only once.
    defaultReminderSchedule: [
      { action: "get:gift", offsetDays: 12, enabledByDefault: false },
      { action: "get:card", offsetDays: 12, enabledByDefault: false },
      { action: "send:card", offsetDays: 7, enabledByDefault: false },
      { action: "send:gift", offsetDays: 7, enabledByDefault: false },
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  met: {
    label: "Met",
    icon: "🤝",
    // No `selfWish`: a `met` is the day you met someone else.
    allowedBearerTypes: ["relationship", "person"],
    recursAnnually: true,
    greeting: "a happy anniversary",
    belatedGreeting: "a happy belated anniversary",
    defaultReminderSchedule: [
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  graduation: {
    label: "Graduation",
    icon: "🎓",
    allowedBearerTypes: ["person"],
    recursAnnually: false,
    greeting: "congratulations",
    belatedGreeting: "belated congratulations",
    selfWish: {
      plain: "\u{1F393} It's your graduation!",
      belated: "\u{1F393} Congratulations on graduating!",
    },
    defaultReminderSchedule: [
      { action: "get:gift", offsetDays: 14, enabledByDefault: false },
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  "job-start": {
    label: "Started a job",
    icon: "💼",
    allowedBearerTypes: ["person"],
    recursAnnually: false,
    greeting: "congratulations",
    belatedGreeting: "belated congratulations",
    selfWish: {
      plain: "\u{1F4BC} It's your first day!",
      belated: "\u{1F4BC} Congratulations on the new job!",
    },
    defaultReminderSchedule: [
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  moved: {
    label: "Moved",
    icon: "🏠",
    allowedBearerTypes: ["person", "pet"],
    recursAnnually: false,
    greeting: "a happy housewarming",
    belatedGreeting: "a happy belated housewarming",
    defaultReminderSchedule: [
      { action: "get:gift", offsetDays: 0, enabledByDefault: false },
      { action: "visit", offsetDays: 0, enabledByDefault: false },
    ],
  },
  other: {
    label: "Other",
    allowedBearerTypes: ["person", "pet", "relationship"],
    recursAnnually: false,
    greeting: "the best",
    defaultReminderSchedule: [],
  },
};

/** The preferred (first allowed) bearer type for a kind. */
export function preferredBearerType(kind: MilestoneKind): MilestoneBearerType {
  return kindDefs[kind].allowedBearerTypes[0];
}

/** Whether `bearerType` is allowed to hold `kind`. */
export function kindAllowsBearer(
  kind: MilestoneKind,
  bearerType: MilestoneBearerType,
): boolean {
  return kindDefs[kind].allowedBearerTypes.includes(bearerType);
}

/** The kinds a bearer type may hold, in listing order. */
export function kindsForBearerType(
  bearerType: MilestoneBearerType,
): { kind: MilestoneKind; label: string }[] {
  return (Object.keys(kindDefs) as MilestoneKind[])
    .filter((kind) => kindAllowsBearer(kind, bearerType))
    .map((kind) => ({ kind, label: kindDefs[kind].label }));
}

/**
 * Where a resolved schedule came from. `kind-default` means the occasion has
 * no rules of its own, which is what mints the prompt.
 */
export type ReminderScheduleSource = "stored" | "kind-default";

/** A milestone's effective schedule, and which level supplied it. */
export interface ResolvedReminderSchedule {
  rules: ReminderRuleInput[];
  source: ReminderScheduleSource;
  /**
   * When the user last saved this schedule (epoch ms, UTC), or null for a kind
   * default. Every save replaces the whole set, so the newest row says when.
   */
  writtenAt: number | null;
}

/**
 * A milestone's stored rules, or its kind's defaults when it has none, furthest
 * lead first. A stored `plan` row is ignored; nothing valid writes one.
 */
export function resolveReminderSchedule(
  kind: MilestoneKind,
  storedRules: ReminderRule[],
): ResolvedReminderSchedule {
  const stored = storedRules.filter((r) => verbOf(r.action) !== "plan");
  const source: ReminderScheduleSource =
    stored.length > 0 ? "stored" : "kind-default";
  const rules: ReminderRuleInput[] =
    source === "stored"
      ? stored.map((r) => ({
          action: r.action,
          label: r.label,
          offsetDays: r.offsetDays,
          enabled: r.enabled,
        }))
      : kindDefs[kind].defaultReminderSchedule.map((d) => ({
          action: d.action,
          label: null,
          offsetDays: d.offsetDays,
          enabled: d.enabledByDefault,
        }));
  return {
    rules: [...rules].sort((a, b) => b.offsetDays - a.offsetDays),
    source,
    writtenAt:
      stored.length > 0 ? Math.max(...stored.map((r) => r.createdAt)) : null,
  };
}

/**
 * Days before the occurrence a kind's prompt comes due: the furthest
 * `offsetDays + activeDays` it offers, so every offer keeps its full run-up.
 */
export function promptOffsetDays(kind: MilestoneKind): number {
  return Math.max(
    0,
    ...kindDefs[kind].defaultReminderSchedule.map(
      (d) => d.offsetDays + actionDefOf(d.action).activeDays,
    ),
  );
}

/**
 * The fewest days that must remain before an action's latest deadline for it
 * to be offered, or for a newly chosen errand to keep its own deadline.
 */
export const OFFER_NOTICE_DAYS = 2;

/**
 * The latest an action can still be done, in days before the occasion: its
 * definition's `latestOffsetDays` if closer, else its own offset.
 */
export function latestOffsetDays(
  action: ReminderAction,
  offsetDays: number,
): number {
  const slide = actionDefOf(action).latestOffsetDays;
  return slide === undefined ? offsetDays : Math.min(offsetDays, slide);
}

/**
 * Whether an action can still be offered `daysUntilOccurrence` days out. A
 * day-of action always fits; others need {@link OFFER_NOTICE_DAYS} of notice.
 */
export function fitsAt(
  action: ReminderAction,
  offsetDays: number,
  daysUntilOccurrence: number,
): boolean {
  const latest = latestOffsetDays(action, offsetDays);
  return latest === 0
    ? daysUntilOccurrence >= 0
    : daysUntilOccurrence - latest >= OFFER_NOTICE_DAYS;
}

/**
 * What a kind's question offers `daysUntilOccurrence` days out: its offers that
 * still fit, with any stored answer's offset and tick, furthest lead first.
 */
export function planOffers(
  kind: MilestoneKind,
  storedRules: readonly ReminderRuleInput[],
  daysUntilOccurrence: number,
): ReminderRuleInput[] {
  const stored = new Map(storedRules.map((r) => [r.action, r]));
  return kindDefs[kind].defaultReminderSchedule
    .map(
      (d): ReminderRuleInput =>
        stored.get(d.action) ?? {
          action: d.action,
          label: null,
          offsetDays: d.offsetDays,
          enabled: d.enabledByDefault,
        },
    )
    .filter((r) => fitsAt(r.action, r.offsetDays, daysUntilOccurrence))
    .sort((a, b) => b.offsetDays - a.offsetDays);
}

/** When a question comes due, and whether it arrived late. */
export interface PlanTiming {
  /** Days before the occasion the question comes due. */
  dueOffsetDays: number;
  /**
   * Whether the app learned of the occasion too late for the usual timing; a
   * late question shows from the day the app learned of it.
   */
  late: boolean;
}

/**
 * When the question comes due, learned `learnedDaysOut` days ahead. Too late
 * for the usual timing, it is due the last day its soonest offer still fits.
 */
export function planTiming(
  kind: MilestoneKind,
  storedRules: readonly ReminderRuleInput[],
  learnedDaysOut: number,
): PlanTiming {
  const usual = promptOffsetDays(kind);
  if (learnedDaysOut - usual >= OFFER_NOTICE_DAYS)
    return { dueOffsetDays: usual, late: false };
  const lastDays = planOffers(kind, storedRules, learnedDaysOut)
    .map((r) => latestOffsetDays(r.action, r.offsetDays))
    .filter((latest) => latest > 0)
    .map((latest) => latest + OFFER_NOTICE_DAYS)
    .filter((lastDay) => lastDay < learnedDaysOut);
  return { dueOffsetDays: Math.max(0, ...lastDays), late: true };
}

/**
 * Whether an answer written `writtenDaysOut` days ahead missed some offers.
 * Such an answer covers that year only, so the question comes back next year.
 */
export function isPartialAnswer(
  kind: MilestoneKind,
  storedRules: readonly ReminderRuleInput[],
  writtenDaysOut: number,
): boolean {
  if (kindDefs[kind].prompt === undefined) return false;
  return (
    planOffers(kind, storedRules, writtenDaysOut).length <
    kindDefs[kind].defaultReminderSchedule.length
  );
}

/**
 * An errand's deadline for one occurrence, its rule written `learnedDaysOut`
 * days ahead: its own offset, or {@link latestOffsetDays} if chosen too late.
 */
export function effectiveOffsetDays(
  action: ReminderAction,
  offsetDays: number,
  learnedDaysOut: number,
): number {
  if (learnedDaysOut < 0 || learnedDaysOut - offsetDays >= OFFER_NOTICE_DAYS)
    return offsetDays;
  return latestOffsetDays(action, offsetDays);
}

/**
 * {@link effectiveOffsetDays} over a set of enabled rules, except that a rule
 * which would slide past one authored after it keeps its own deadline.
 */
export function effectiveOffsets(
  rules: readonly ReminderRuleInput[],
  learnedDaysOut: number,
): { rule: ReminderRuleInput; offsetDays: number }[] {
  // Furthest lead first: the authored order the result must keep.
  const timed = [...rules]
    .sort((a, b) => b.offsetDays - a.offsetDays)
    .map((rule) => ({
      rule,
      offsetDays: effectiveOffsetDays(
        rule.action,
        rule.offsetDays,
        learnedDaysOut,
      ),
    }));
  // Walk back from the last, carrying the deadline of everything already fixed:
  // no rule may come due after one authored to follow it.
  let floor = 0;
  for (let i = timed.length - 1; i >= 0; i--) {
    const t = timed[i]!;
    if (t.offsetDays < floor) t.offsetDays = t.rule.offsetDays;
    floor = t.offsetDays;
  }
  return timed;
}

/**
 * One dated fact about a bearer. The date is partial (any part may be null),
 * but a day always needs a month.
 */
export const milestoneSchema = z
  .object({
    id: z.uuid(),
    kind: milestoneKindSchema,
    bearerType: milestoneBearerTypeSchema,
    bearerId: z.uuid(),
    year: z.number().int().nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    day: z.number().int().min(1).max(31).nullable(),
    note: z.string().min(1).nullable(), // free text; also the `other`-kind label
    createdAt: z.number().int(), // epoch ms, UTC
    updatedAt: z.number().int(),
    deletedAt: z.number().int().nullable(),
  })
  .refine((m) => m.day === null || m.month !== null, {
    message: "a day requires a month (no lone day, no year+day)",
    path: ["day"],
  })
  .refine((m) => kindAllowsBearer(m.kind, m.bearerType), {
    message: "bearerType is not allowed to hold this milestone kind",
    path: ["bearerType"],
  });

export type Milestone = z.infer<typeof milestoneSchema>;

/**
 * The fields the reminder engine reads from a milestone. It omits the encrypted
 * `note`, so a scan across bearers needs no content key.
 */
export interface RemindEligibleMilestone {
  id: string;
  kind: MilestoneKind;
  bearerType: MilestoneBearerType;
  bearerId: string;
  year: number | null;
  month: number | null;
  day: number | null;
  /**
   * When the milestone was recorded (epoch ms, UTC): the day the app learned of
   * the occasion, so nothing already past by then counts against the user.
   */
  createdAt: number;
}

/**
 * One entry on an entity's timeline: its own milestone, or one stored on a
 * relationship it is in, shown read-only.
 */
export interface MilestoneTimelineEntry {
  milestone: Milestone;
  origin: "own" | "relationship";
  /** The relationship the milestone is stored on; null for `own` entries. */
  relationshipId: string | null;
  /** The other partner's display label; null for `own` entries. */
  otherLabel: string | null;
}

/** Date parts shared by the create and update inputs. */
const datePartsShape = {
  year: z.number().int().nullable().optional(),
  month: z.number().int().min(1).max(12).nullable().optional(),
  day: z.number().int().min(1).max(31).nullable().optional(),
  note: z.string().min(1).nullable().optional(),
};

/** A day needs a month; absent parts count as null. */
function dayImpliesMonth(d: { month?: number | null; day?: number | null }) {
  return (d.day ?? null) === null || (d.month ?? null) !== null;
}

/**
 * When present, replaces the milestone's stored rules (empty clears them);
 * when absent, leaves them alone.
 */
const reminderScheduleShape = {
  reminderSchedule: z.array(reminderRuleInputSchema).optional(),
};

/** The bearer + kind + partial date accepted when creating a milestone. */
export const createMilestoneInputSchema = z
  .object({
    kind: milestoneKindSchema,
    bearerType: milestoneBearerTypeSchema,
    bearerId: z.uuid(),
    ...datePartsShape,
    ...reminderScheduleShape,
  })
  .refine(dayImpliesMonth, {
    message: "a day requires a month (no lone day, no year+day)",
    path: ["day"],
  })
  .refine((m) => kindAllowsBearer(m.kind, m.bearerType), {
    message: "bearerType is not allowed to hold this milestone kind",
    path: ["bearerType"],
  });

export type CreateMilestoneInput = z.infer<typeof createMilestoneInputSchema>;

/**
 * A partial milestone update, bearer included. The repo re-validates the
 * merged row, so the whole-row rules still hold.
 */
export const updateMilestoneInputSchema = z.object({
  kind: milestoneKindSchema.optional(),
  bearerType: milestoneBearerTypeSchema.optional(),
  bearerId: z.uuid().optional(),
  ...datePartsShape,
  ...reminderScheduleShape,
});

export type UpdateMilestoneInput = z.infer<typeof updateMilestoneInputSchema>;

/**
 * How much of a milestone's date is known. `year-month` is a month with or
 * without a year; `recurring` is a month and day with no year.
 */
export type DatePrecision =
  | "none"
  | "year"
  | "year-month"
  | "recurring"
  | "full";

/** Derive a milestone's {@link DatePrecision} from its present date parts. */
export function datePrecisionOf(m: {
  year: number | null;
  month: number | null;
  day: number | null;
}): DatePrecision {
  const hasYear = m.year !== null;
  const hasMonth = m.month !== null;
  const hasDay = m.day !== null;
  if (hasMonth && hasDay) return hasYear ? "full" : "recurring";
  if (hasMonth) return "year-month"; // year+month, or the rarer month-only
  return hasYear ? "year" : "none";
}

/** Localized month names, January first. */
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2001, i, 1)).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  }),
);

/**
 * A partial date in words, built from its parts so it never implies more than
 * is known: "March 9, 1992", "March 1992", "1992", "March 9", or "".
 */
export function formatMilestoneDate(m: {
  year: number | null;
  month: number | null;
  day: number | null;
}): string {
  const monthName = m.month !== null ? MONTH_NAMES[m.month - 1] : null;
  switch (datePrecisionOf(m)) {
    case "full":
      return `${monthName} ${m.day}, ${m.year}`;
    case "recurring":
      return `${monthName} ${m.day}`;
    case "year-month":
      return m.year !== null ? `${monthName} ${m.year}` : (monthName ?? "");
    case "year":
      return String(m.year);
    default:
      return "";
  }
}

/** A milestone's display label: the kind's, or for `other` its note. */
export function milestoneLabel(m: {
  kind: MilestoneKind;
  note: string | null;
}): string {
  if (m.kind === "other") return m.note ?? kindDefs.other.label;
  return kindDefs[m.kind].label;
}
