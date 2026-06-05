import { z } from "zod";

/**
 * The kinds of subject a milestone can hang off. A *separate* enum from
 * `entityTypeSchema`: a `relationship` can be a milestone subject (a
 * wedding belongs to the relationship, not to either partner) but is not a
 * relationship-role holder, so we don't widen `entityTypeSchema` to include it.
 * Like taggings/relationships, the subject is a polymorphic `(type, id)` pair,
 * so a new subject type joins without a schema change.
 */
export const milestoneSubjectTypeSchema = z.enum([
  "person",
  "pet",
  "relationship",
]);

export type MilestoneSubjectType = z.infer<typeof milestoneSubjectTypeSchema>;

/**
 * The closed set of milestone kinds — "the big dates in someone's life". A
 * starter set in v1; adding a kind later is one enum line plus a `kindDefs`
 * entry, never a migration (the DB stores the kind as free text, constrained
 * here in Zod). Insertion order is the UI listing order. `other` is the escape
 * hatch and leans on the free-text `note` for its label.
 */
export const milestoneKindSchema = z.enum([
  "birthday",
  "death",
  "first-date",
  "wedding",
  "met",
  "graduation",
  "job-start",
  "other",
]);

export type MilestoneKind = z.infer<typeof milestoneKindSchema>;

/** Static metadata for a milestone kind: how it displays, who it attaches to, and whether it recurs. */
export interface MilestoneKindDef {
  /** Display label, e.g. "Birthday". */
  label: string;
  /** Optional emoji shown beside the label. */
  icon?: string;
  /**
   * Which subject types may hold this kind, in preference order. A wedding
   * prefers a `relationship` subject but can sit on a `person` until the
   * relationship exists (the unbound/pending case); a birthday is a `person` or
   * `pet`. The first entry is the {@link MilestoneKindDef.preferredSubjectType}.
   */
  allowedSubjectTypes: MilestoneSubjectType[];
  /**
   * Whether this kind recurs every year (drives the future reminders inbox).
   * Unused by the v1 UI but set now so the inbox increment needs no schema or
   * registry churn.
   */
  recursAnnually: boolean;
}

/**
 * The milestone-kind registry. `allowedSubjectTypes[0]` is the preferred
 * subject; `recursAnnually` is read by the (deferred) inbox. Insertion order
 * matches {@link milestoneKindSchema} and is the UI listing order.
 */
export const kindDefs: Record<MilestoneKind, MilestoneKindDef> = {
  birthday: {
    label: "Birthday",
    icon: "🎂",
    allowedSubjectTypes: ["person", "pet"],
    recursAnnually: true,
  },
  death: {
    label: "Death",
    icon: "🕯️",
    allowedSubjectTypes: ["person", "pet"],
    recursAnnually: true,
  },
  "first-date": {
    label: "First Date",
    icon: "💞",
    allowedSubjectTypes: ["relationship", "person"],
    recursAnnually: true,
  },
  wedding: {
    label: "Wedding",
    icon: "💍",
    allowedSubjectTypes: ["relationship", "person"],
    recursAnnually: true,
  },
  met: {
    label: "Met",
    icon: "🤝",
    allowedSubjectTypes: ["relationship", "person"],
    recursAnnually: true,
  },
  graduation: {
    label: "Graduation",
    icon: "🎓",
    allowedSubjectTypes: ["person"],
    recursAnnually: false,
  },
  "job-start": {
    label: "Started a job",
    icon: "💼",
    allowedSubjectTypes: ["person"],
    recursAnnually: false,
  },
  other: {
    label: "Other",
    allowedSubjectTypes: ["person", "pet", "relationship"],
    recursAnnually: false,
  },
};

/** The preferred (first allowed) subject type for a kind. */
export function preferredSubjectType(
  kind: MilestoneKind,
): MilestoneSubjectType {
  return kindDefs[kind].allowedSubjectTypes[0];
}

/** Whether `subjectType` is allowed to hold `kind`. */
export function kindAllowsSubject(
  kind: MilestoneKind,
  subjectType: MilestoneSubjectType,
): boolean {
  return kindDefs[kind].allowedSubjectTypes.includes(subjectType);
}

/** Kinds a given subject type may hold, in registry order — drives the kind picker. */
export function kindsForSubjectType(
  subjectType: MilestoneSubjectType,
): { kind: MilestoneKind; label: string }[] {
  return (Object.keys(kindDefs) as MilestoneKind[])
    .filter((kind) => kindAllowsSubject(kind, subjectType))
    .map((kind) => ({ kind, label: kindDefs[kind].label }));
}

/**
 * A Milestone — one dated fact about a subject, stored as a single row.
 *
 * The date is **partial**: `year`/`month`/`day` are individually nullable so a
 * milestone can record exactly what's known ("March 9, 1992", "March 1992",
 * "1992", "March 9" for a recurring birthday whose year is unknown). The only
 * structural rule is **day ⇒ month** (never a lone day, never year+day);
 * precision is *derived* from which parts are present (see
 * {@link datePrecisionOf}), not stored. The nullable parts stay individually
 * queryable so the future inbox can scan `month`/`day` ignoring `year`.
 *
 * The subject is a polymorphic, *mutable* `(subjectType, subjectId)` pair: a
 * wedding added before its relationship exists lives on the person and is
 * later re-pointed to the relationship via a single-row subject update.
 *
 * Same sync-safe conventions as the other tables (reboot-plan.md §4.2): client
 * UUID id, epoch-ms UTC timestamps, nullable `deletedAt`.
 */
export const milestoneSchema = z
  .object({
    id: z.uuid(),
    kind: milestoneKindSchema,
    subjectType: milestoneSubjectTypeSchema,
    subjectId: z.uuid(),
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
  .refine((m) => kindAllowsSubject(m.kind, m.subjectType), {
    message: "subjectType is not allowed to hold this milestone kind",
    path: ["subjectType"],
  });

export type Milestone = z.infer<typeof milestoneSchema>;

/** The date parts shared by create/update inputs; the day⇒month rule re-applies on each. */
const datePartsShape = {
  year: z.number().int().nullable().optional(),
  month: z.number().int().min(1).max(12).nullable().optional(),
  day: z.number().int().min(1).max(31).nullable().optional(),
  note: z.string().min(1).nullable().optional(),
};

/** A day is meaningful only alongside a month, on partial inputs too (treating absent as null). */
function dayImpliesMonth(d: { month?: number | null; day?: number | null }) {
  return (d.day ?? null) === null || (d.month ?? null) !== null;
}

/** The subject + kind + partial date accepted when creating a milestone. */
export const createMilestoneInputSchema = z
  .object({
    kind: milestoneKindSchema,
    subjectType: milestoneSubjectTypeSchema,
    subjectId: z.uuid(),
    ...datePartsShape,
  })
  .refine(dayImpliesMonth, {
    message: "a day requires a month (no lone day, no year+day)",
    path: ["day"],
  })
  .refine((m) => kindAllowsSubject(m.kind, m.subjectType), {
    message: "subjectType is not allowed to hold this milestone kind",
    path: ["subjectType"],
  });

export type CreateMilestoneInput = z.infer<typeof createMilestoneInputSchema>;

/**
 * Editable fields when updating a milestone: the kind, the date parts, and the
 * note — **plus** an optional new `subjectType`/`subjectId`, so the v2 rebind
 * (unbound person → relationship) is a normal update. The repository merges
 * this onto the stored row and re-validates the whole row, so the day⇒month and
 * subject-type rules still hold after a partial update.
 */
export const updateMilestoneInputSchema = z.object({
  kind: milestoneKindSchema.optional(),
  subjectType: milestoneSubjectTypeSchema.optional(),
  subjectId: z.uuid().optional(),
  ...datePartsShape,
});

export type UpdateMilestoneInput = z.infer<typeof updateMilestoneInputSchema>;

/**
 * The precision of a milestone's date, derived from which parts are present:
 * `none` (nothing), `year` (year only), `year-month` (a month, with or without
 * a year), `recurring` (month+day, no year — recurs annually with no anchor
 * year), or `full` (year+month+day). The day⇒month rule means these cases are
 * exhaustive (a lone day can't occur).
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

/** A reference January (any year with 31-day months works) for month-name formatting. */
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2001, i, 1)).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  }),
);

/**
 * A locale-aware, precision-aware rendering of a milestone's partial date:
 * "March 9, 1992" (full), "March 1992" (year-month), "1992" (year only),
 * "March 9" (recurring, no year), or "" when no date is set. Built from the
 * individual parts rather than a `Date` so a partial date never implies a day
 * or month it doesn't have.
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
      // A month, with the year when known; "March 1992" or just "March".
      return m.year !== null ? `${monthName} ${m.year}` : (monthName ?? "");
    case "year":
      return String(m.year);
    default:
      return "";
  }
}

/**
 * The display label for a milestone: the kind's label, except `other`, which
 * uses its free-text `note` (falling back to "Other" when blank).
 */
export function milestoneLabel(m: {
  kind: MilestoneKind;
  note: string | null;
}): string {
  if (m.kind === "other") return m.note ?? kindDefs.other.label;
  return kindDefs[m.kind].label;
}
