import { z } from "zod";

/**
 * The closed half of a {@link ReminderAction}. `plan` is the engine's question
 * and never stored; `other` keeps its errand in the rule's `label`.
 */
export const reminderVerbSchema = z.enum([
  "get",
  "send",
  "give",
  "visit",
  "call",
  "message",
  "post",
  "wish",
  "remember",
  "plan",
  "other",
]);

export type ReminderVerb = z.infer<typeof reminderVerbSchema>;

/**
 * A verb with an optional slug qualifier: `wish`, `get:gift`. Part of a system
 * reminder's id, so nothing merely true about the reminder may change it.
 */
export type ReminderAction = ReminderVerb | `${ReminderVerb}:${string}`;

const VERBS: readonly string[] = reminderVerbSchema.options;

const QUALIFIER_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A known verb, at most one colon, and a slug qualifier; `plan` never takes a
 * qualifier.
 */
export function isReminderAction(value: unknown): value is ReminderAction {
  if (typeof value !== "string") return false;
  const parts = value.split(":");
  if (parts.length > 2) return false;
  const [verb, qualifier] = parts;
  if (!VERBS.includes(verb)) return false;
  if (qualifier === undefined) return true;
  if (verb === "plan") return false;
  return QUALIFIER_RE.test(qualifier);
}

/**
 * Checks shape only, not registry membership, so an action synced from a later
 * version still parses; {@link actionDefOf} renders it.
 */
export const reminderActionSchema = z.custom<ReminderAction>(isReminderAction, {
  message: "not a reminder action",
});

/** An action split into its two halves; `qualifier` is null for a bare verb. */
export interface ParsedReminderAction {
  verb: ReminderVerb;
  qualifier: string | null;
}

/** Split an action into its verb and qualifier. */
export function parseAction(action: ReminderAction): ParsedReminderAction {
  const i = action.indexOf(":");
  return i === -1
    ? { verb: action as ReminderVerb, qualifier: null }
    : {
        verb: action.slice(0, i) as ReminderVerb,
        qualifier: action.slice(i + 1),
      };
}

/** The verb half of an action — the half anything branching should read. */
export function verbOf(action: ReminderAction): ReminderVerb {
  return parseAction(action).verb;
}

/** Join a verb and an optional qualifier back into an action string. */
export function formatAction(
  verb: ReminderVerb,
  qualifier?: string | null,
): ReminderAction {
  return qualifier == null || qualifier === ""
    ? verb
    : (`${verb}:${qualifier}` as ReminderAction);
}

/** What a reminder's copy is written about: who, and what occasion. */
export interface ReminderCopyContext {
  /** The bearer's display label, already mention-wrapped where applicable. */
  subject: string;
  /**
   * The occasion as a wish, with its own article: "a happy birthday", "Eid
   * Mubarak".
   */
  greeting: string;
  /**
   * The occasion as a bare noun, for copy that names it: "birthday",
   * "Christmas".
   */
  occasion: string;
}

/** Who the prompt's question is about, which decides how it is phrased. */
export interface PlanQuestionContext {
  /** The bearer's label, mention-wrapped where applicable. */
  subject: string;
  /** The occasion as a bare noun — "birthday", "anniversary". */
  occasion: string;
  /**
   * The subject is the user: their own birthday, or a wedding with no other
   * party yet.
   */
  subjectIsSelf: boolean;
  /**
   * The occasion is the user's, shared with the subject: a first date, an
   * anniversary.
   */
  shared: boolean;
}

/**
 * The prompt's question, read by both the reminder row and the screen that
 * answers it.
 */
export function planQuestion({
  subject,
  occasion,
  subjectIsSelf,
  shared,
}: PlanQuestionContext): string {
  if (subjectIsSelf) return `What do you want to do for your own ${occasion}?`;
  if (shared)
    return `What do you want to do for your ${occasion} with ${subject}?`;
  return `What do you want to do for ${subject}'s ${occasion}?`;
}

/**
 * How a reminder action displays, how long it sits on the list, and its copy.
 */
export interface ReminderActionDef {
  /** Display label, e.g. "Get a gift". */
  label: string;
  /**
   * The label a prompt shows once it knows the occasion, from its greeting:
   * "Wish them a happy birthday". Absent keeps `label`.
   */
  offer?: (greeting: string) => string;
  /** Optional emoji shown beside the label. */
  icon?: string;
  /**
   * The action this one delivers (`send:card` delivers `get:card`). Only the
   * prompt reads it; the rules themselves stay independent.
   */
  deliveryOf?: ReminderAction;
  /**
   * Days before its due date that the reminder appears on the list; `0` is the
   * day itself.
   */
  activeDays: number;
  /**
   * The deadline a late start slides to, in days before the occasion. Absent
   * means the rule's own offset is a hard deadline.
   */
  latestOffsetDays?: number;
  /**
   * The reminder's title. `other` takes its copy from the rule's `label`
   * instead.
   */
  template: (context: ReminderCopyContext) => string;
}

/**
 * Outside the registry so `other`'s template can read it without a circular
 * initializer.
 */
const OTHER_LABEL = "Other";

/**
 * Every registered action, keyed by the whole `verb:qualifier`. Read it through
 * {@link actionDefOf}. Insertion order is the UI listing order.
 */
export const actionDefs = {
  wish: {
    label: "Wish them",
    offer: (greeting) => `Wish them ${greeting}`,
    icon: "🎉",
    activeDays: 0,
    template: ({ subject, greeting }) => `Wish ${subject} ${greeting}`,
  },
  "get:gift": {
    label: "Get a gift",
    // The prompt's one tick for getting it and handing it over.
    offer: () => "Give a gift",
    icon: "🎁",
    activeDays: 30,
    latestOffsetDays: 1,
    template: ({ subject }) => `Get ${subject} a gift`,
  },
  "get:card": {
    label: "Get a card",
    offer: () => "Give a card",
    icon: "🛒",
    activeDays: 30,
    latestOffsetDays: 1,
    template: ({ subject }) => `Get a card for ${subject}`,
  },
  "send:card": {
    label: "Send a card",
    icon: "💌",
    deliveryOf: "get:card",
    activeDays: 14,
    template: ({ subject }) => `Send ${subject} a card`,
  },
  "send:gift": {
    label: "Send a gift",
    icon: "📦",
    deliveryOf: "get:gift",
    activeDays: 10,
    template: ({ subject }) => `Post ${subject}'s gift`,
  },
  "give:card": {
    label: "Give a card in person",
    icon: "✉️",
    deliveryOf: "get:card",
    activeDays: 0,
    template: ({ subject }) => `Give ${subject} a card`,
  },
  "give:gift": {
    label: "Give a gift in person",
    icon: "🎁",
    deliveryOf: "get:gift",
    activeDays: 0,
    template: ({ subject }) => `Give ${subject} a gift`,
  },
  // Registered but not offered (see UNOFFERED_ACTIONS): stored rules still
  // render real copy.
  call: {
    label: "Give a call",
    icon: "📞",
    activeDays: 0,
    template: ({ subject }) => `Call ${subject}`,
  },
  "message:sms": {
    label: "Send a text",
    icon: "💬",
    activeDays: 0,
    template: ({ subject }) => `Text ${subject}`,
  },
  visit: {
    label: "Visit",
    icon: "🏡",
    activeDays: 7,
    template: ({ subject }) => `Visit ${subject}`,
  },
  remember: {
    label: "Remember them",
    icon: "🕯️",
    activeDays: 0,
    template: ({ subject }) => `Remember ${subject}`,
  },
  plan: {
    label: "Decide how to mark it",
    icon: "🗓",
    // How long a decision sits before it is owed, not an errand's run-up.
    activeDays: 14,
    // The third-party form; `copyOverrideOf` in @leapsake/reminders picks the
    // self and shared forms.
    template: ({ subject, occasion }) =>
      planQuestion({ subject, occasion, subjectIsSelf: false, shared: false }),
  },
  other: {
    label: OTHER_LABEL,
    icon: "🔔",
    activeDays: 0,
    template: () => OTHER_LABEL,
  },
} satisfies Record<string, ReminderActionDef>;

/**
 * The actions the app ships a definition for, so a typo in a kind's defaults
 * fails to compile.
 */
export type KnownReminderAction = keyof typeof actionDefs & ReminderAction;

/** Every registered action, in registry (UI listing) order. */
export const KNOWN_ACTIONS = Object.keys(
  actionDefs,
) as readonly KnownReminderAction[];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * An action's registry entry, or a generic one for an unregistered action.
 * Never throws, because reconcile calls it inside a transaction.
 */
export function actionDefOf(action: ReminderAction): ReminderActionDef {
  const known = (actionDefs as Record<string, ReminderActionDef>)[action];
  if (known !== undefined) return known;
  const { verb, qualifier } = parseAction(action);
  const label =
    qualifier === null
      ? capitalize(verb)
      : `${capitalize(verb)} (${qualifier})`;
  return {
    label,
    activeDays: 0,
    template: ({ subject }) =>
      qualifier === null
        ? `${capitalize(verb)} ${subject}`
        : `${capitalize(verb)} ${subject} (${qualifier})`,
  };
}

// `plan` is the engine's question; a channel is a button on the reminder, not
// an errand.
const UNOFFERED_ACTIONS: readonly KnownReminderAction[] = [
  "plan",
  "call",
  "message:sms",
];

/** What a schedule picker lists: narrower than what a schedule may hold. */
export const SCHEDULABLE_ACTIONS: readonly KnownReminderAction[] =
  KNOWN_ACTIONS.filter((action) => !UNOFFERED_ACTIONS.includes(action));

/**
 * The rule an editor's Add button appends: the first offered action not yet in
 * the schedule, else `other`, which a schedule can hold more than once.
 */
export function nextSchedulableRule(
  existing: readonly { action: ReminderAction }[],
): ReminderRuleInput {
  const taken = new Set(existing.map((rule) => rule.action));
  const action = SCHEDULABLE_ACTIONS.find((a) => !taken.has(a)) ?? "other";
  return { action, label: null, offsetDays: 7, enabled: true };
}

/**
 * The widest `activeDays` any action has: an upper bound for narrowing
 * candidate occurrences.
 */
export const MAX_ACTIVE_DAYS: number = Math.max(
  ...Object.values(actionDefs).map((def) => def.activeDays),
);

/**
 * What a rule hangs off. `observance` is a (person, holiday) pair, so each
 * person can have their own schedule for one holiday.
 */
export const reminderRuleBearerTypeSchema = z.enum(["milestone", "observance"]);

export type ReminderRuleBearerType = z.infer<
  typeof reminderRuleBearerTypeSchema
>;

/**
 * One entry in a bearer's schedule: an action `offsetDays` before the
 * occurrence. A plain `z.object` so the repo can derive columns from `.shape`.
 */
export const reminderRuleSchema = z.object({
  id: z.uuid(),
  bearerType: reminderRuleBearerTypeSchema,
  bearerId: z.uuid(),
  action: reminderActionSchema,
  /**
   * Free-text label; carries the user's text when the verb is `other`, else
   * null.
   */
  label: z.string().nullable(),
  /** Lead days before the occurrence; 0 = day-of. */
  offsetDays: z.number().int().min(0),
  enabled: z.boolean(),
  /** The one occurrence a prompt's answer covers; null for a standing rule. */
  occurrenceYear: z.number().int().nullable(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type ReminderRule = z.infer<typeof reminderRuleSchema>;

/**
 * One rule as an editor saves it. Parsing rejects `plan`, but the type still
 * admits it, so the engine's synthesized prompt rule shares this shape.
 */
export const reminderRuleInputSchema = z
  .object({
    action: reminderActionSchema.refine((a) => verbOf(a) !== "plan", {
      message: "'plan' is the engine's own question, not a schedulable action",
    }),
    label: z.string().nullable().optional(),
    offsetDays: z.number().int().min(0),
    enabled: z.boolean(),
  })
  .refine(
    (r) => verbOf(r.action) !== "other" || (r.label ?? "").trim().length > 0,
    {
      message: "an 'other' reminder needs a label",
      path: ["label"],
    },
  );

export type ReminderRuleInput = z.infer<typeof reminderRuleInputSchema>;

/**
 * What makes two rules on one bearer the same reminder: the action, or for
 * `other` its trimmed, lowercased label, so renaming one makes a new reminder.
 */
export function actionKeyOf(rule: {
  action: ReminderAction;
  label?: string | null;
}): string {
  if (verbOf(rule.action) !== "other") return rule.action;
  return `other:${(rule.label ?? "").trim().toLowerCase()}`;
}

/**
 * A bearer's whole schedule, and the only place a duplicate is caught. The
 * issue lands on the second occurrence: the row the user just added.
 */
export const reminderScheduleInputSchema = z
  .array(reminderRuleInputSchema)
  .superRefine((rules, ctx) => {
    const seen = new Map<string, number>();
    rules.forEach((rule, i) => {
      const key = actionKeyOf(rule);
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, i);
        return;
      }
      ctx.addIssue({
        code: "custom",
        message: `duplicate reminder: "${reminderRuleLabel(rule)}" is already scheduled`,
        path: [i, verbOf(rule.action) === "other" ? "label" : "action"],
      });
    });
  });

/** A rule's display label: the action's, or for `other` its own text. */
export function reminderRuleLabel(rule: {
  action: ReminderAction;
  label?: string | null;
}): string {
  if (verbOf(rule.action) === "other") return rule.label ?? OTHER_LABEL;
  return actionDefOf(rule.action).label;
}

/** An action's label on a prompt about an occasion with this greeting. */
export function offerLabel(action: ReminderAction, greeting: string): string {
  const def = actionDefOf(action);
  return def.offer?.(greeting) ?? def.label;
}

/**
 * A lead time in words, always in days so a list reads in one unit: "12 days
 * before".
 */
export function leadTimeLabel(offsetDays: number): string {
  if (offsetDays <= 0) return "on the day";
  return offsetDays === 1 ? "1 day before" : `${offsetDays} days before`;
}

/**
 * One row of the prompt, with its index so an editor can write the rule back in
 * place.
 */
export interface PromptItem {
  /** Where this rule sits in the array the prompt was handed. */
  index: number;
  rule: ReminderRuleInput;
}

/**
 * The item a delivery belongs to, or null; a delivery whose item is absent is
 * an item itself.
 */
function deliveryParentOf(
  rule: ReminderRuleInput,
  present: ReadonlySet<ReminderAction>,
): ReminderAction | null {
  const parent = actionDefOf(rule.action).deliveryOf;
  return parent !== undefined && present.has(parent) ? parent : null;
}

/** The ticks the prompt draws: every rule but the deliveries, which follow. */
export function promptItemsOf(
  rules: readonly ReminderRuleInput[],
): PromptItem[] {
  const present = new Set(rules.map((r) => r.action));
  return rules.flatMap((rule, index) =>
    deliveryParentOf(rule, present) === null ? [{ index, rule }] : [],
  );
}

/** Tick or untick one prompt item. `index` is a {@link PromptItem}'s. */
export function setPromptItem(
  rules: readonly ReminderRuleInput[],
  index: number,
  enabled: boolean,
): ReminderRuleInput[] {
  return rules.map((rule, i) => (i === index ? { ...rule, enabled } : rule));
}

/** The prompt's starting answer: an unticked item will be posted once ticked,
 *  or handed over in person where posting is not on offer. */
export function promptDraftOf(
  offers: readonly ReminderRuleInput[],
): ReminderRuleInput[] {
  const present = new Set(offers.map((r) => r.action));
  const ticked = new Set(offers.filter((r) => r.enabled).map((r) => r.action));
  const posted = new Set(
    offers
      .filter((r) => verbOf(r.action) === "send")
      .map((r) => deliveryParentOf(r, present)),
  );
  return offers.map((rule) => {
    const parent = deliveryParentOf(rule, present);
    if (parent === null || ticked.has(parent)) return rule;
    const mailed = posted.has(parent);
    return {
      ...rule,
      enabled: verbOf(rule.action) === "send" ? mailed : !mailed,
    };
  });
}

/** The prompt's answer as it is written: a delivery only for a ticked item. */
export function promptAnswerOf(
  rules: readonly ReminderRuleInput[],
): ReminderRuleInput[] {
  const present = new Set(rules.map((r) => r.action));
  const ticked = new Set(rules.filter((r) => r.enabled).map((r) => r.action));
  return rules.map((rule) => {
    const parent = deliveryParentOf(rule, present);
    return parent === null || ticked.has(parent)
      ? rule
      : { ...rule, enabled: false };
  });
}

/** A schedule that hands over on the day, in person, what `send` would post. */
export function handedOverInPerson(
  rules: readonly ReminderRuleInput[],
  send: ReminderAction,
): ReminderRuleInput[] {
  const give = formatAction("give", parseAction(send).qualifier);
  return [
    ...rules
      .filter((rule) => rule.action !== give)
      .map((rule) =>
        rule.action === send ? { ...rule, enabled: false } : rule,
      ),
    { action: give, label: null, offsetDays: 0, enabled: true },
  ];
}
