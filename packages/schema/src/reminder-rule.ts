import { z } from "zod";

/**
 * The closed set of reminder **verbs** — the "what kind of thing to do" half of
 * an action. Small, closed, and Zod-validated, because the verb is what the code
 * ever branches on; the {@link ReminderAction} qualifier beside it is open.
 *
 * Two members are not things the user schedules. `plan` is the engine's question
 * — *"how do you want to mark this?"* — asked of an occasion nobody has
 * configured; it is synthesized per reconcile, never stored as a rule, and never
 * takes a qualifier (it is a question about the occasion, not an action toward
 * the person). `other` is the escape hatch, and leans on the per-rule free-text
 * `label` exactly like the `other` milestone kind leans on its `note`.
 *
 * `post` is declared with no registry entry of its own, and if posting is ever
 * offered it is a **bare `post`** — one "make a post for their birthday", not
 * `post:instagram` beside `post:x` *(owner, 2026-09-05)*. Surfacing which
 * platforms someone actually posts on is a later move of the same shape as the
 * contact affordances on a `wish`, not a row you schedule weeks ahead. That
 * costs one registry entry and one line in a kind's defaults whenever someone
 * wants it. Declaring the verb now costs one line and is separately what lets a
 * `post:instagram` synced from a later version parse instead of failing the
 * row.
 */
export const reminderVerbSchema = z.enum([
  "get",
  "send",
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
 * A reminder **action**: a {@link ReminderVerb}, optionally followed by `:` and
 * a qualifier — `wish`, `get:gift`, `send:card`, `message:discord`.
 *
 * **The action string is the reminder's identity**, and it never moves. A system
 * reminder's id is `milestone:<id>:<year>:<action>`, so the action is the whole
 * of what keeps two reminders for one birthday distinct. Two consequences worth
 * holding on to:
 *
 * - **A verb alone is not enough.** Getting a gift and getting a card are two
 *   errands with two due dates, and before the qualifier existed they could not
 *   both be scheduled — the engine keys its desired set by derived id, so two
 *   rules sharing an action silently collapsed into one reminder. The qualifier
 *   is what makes them distinct; {@link reminderScheduleInputSchema} is what
 *   stops a genuine duplicate re-creating the collapse by another route.
 * - **Nothing that is merely *true about* a reminder may reach the action.** How
 *   you happen to be able to contact someone is derived at render (see
 *   {@link ReminderActionDef.template}); if adding a phone number moved a row
 *   from `wish` to `message:sms`, the old id would be tombstoned — permanently,
 *   since the engine never resurrects a tombstone — and a birthday the user had
 *   already ticked would come back unticked under a new id.
 *
 * **The verb half is closed; the qualifier half is deliberately open.** Verbs are
 * branched on and so must be enumerable. Qualifiers are `card`/`gift` or a
 * platform id from `@leapsake/contact-links` — a registry this package does not
 * (and should not) depend on — so they are validated by *shape*, not membership.
 * The type is a template literal rather than a plain `string` so the compiler
 * still rejects `"gift"`, which is a qualifier wearing a verb's clothes.
 *
 * Stored as free text: the DB column is unconstrained, so adding an action is an
 * {@link actionDefs} entry and (for a new verb) one enum line, never a migration.
 */
export type ReminderAction = ReminderVerb | `${ReminderVerb}:${string}`;

const VERBS: readonly string[] = reminderVerbSchema.options;

/** A qualifier is a lowercase slug: it rides in a deterministic id and in a
 *  free-text column, so it stays boring on purpose. */
const QUALIFIER_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Whether `value` is a well-formed {@link ReminderAction} — a known verb, at
 * most one colon, and a slug qualifier. `plan` is rejected *with* a qualifier
 * (see {@link reminderVerbSchema}); every other verb accepts one or none.
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
 * The action column's validator. A `z.custom` rather than a `z.enum` because the
 * qualifier half is open — the value set is infinite, so membership is a
 * predicate rather than a list.
 *
 * ⚠️ It stays **permissive about verbs it has no {@link actionDefs} entry for**.
 * A row's action only has to be well-*formed* here; whether the app knows how to
 * render it is {@link actionDefOf}'s problem, and it answers with a generic def
 * rather than `undefined`. That split is what keeps a peer on a later version
 * from syncing a row this one cannot parse — a sync failure, which is much worse
 * than a dull reminder.
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

/**
 * What a reminder's copy is written about: who, and what occasion.
 *
 * Passed as an object rather than positionally on purpose. The `greeting` was
 * added when holidays joined milestones as a reminder source, and a forgotten
 * positional argument would have silently rendered birthday copy for Christmas
 * — a failure that typechecks and reads fine in review.
 *
 * Note what is **not** here: the qualifier. Each concrete action has its own
 * {@link actionDefs} entry and so writes its own sentence ("Get {subject} a
 * gift", "Get {subject} a card") — the qualifier is baked into the template that
 * was chosen by it, rather than threaded through as another field every template
 * would have to remember to read.
 */
export interface ReminderCopyContext {
  /** The bearer's display label, already mention-wrapped where applicable. */
  subject: string;
  /**
   * The occasion phrase, carrying its own article where it needs one: "a happy
   * birthday", "a Merry Christmas", "Eid Mubarak". Supplied by the milestone
   * kind (`kindDefs`) or the holiday catalog entry, so one template serves both.
   */
  greeting: string;
  /**
   * The occasion as a bare noun — "birthday", "wedding anniversary",
   * "Christmas" — for copy that *names* the occasion instead of wishing it.
   *
   * Deliberately separate from {@link ReminderCopyContext.greeting} rather than
   * derived from it: a greeting carries an article and a sentiment ("**a happy**
   * birthday") that read as nonsense in a question ("How do you want to mark
   * Violet's a happy birthday?"). Two fields, because the two jobs genuinely
   * differ; and required, not optional, for the reason this whole interface is
   * an object — a missing one here renders plausible copy that typechecks.
   */
  occasion: string;
}

/**
 * Who the prompt's question is about, which decides how it is phrased.
 *
 * Three shapes, because the third-person possessive the templates are written in
 * is wrong for two of them — and one of those is wrong in a way that misstates a
 * fact about the user's life rather than merely reading oddly.
 */
export interface PlanQuestionContext {
  /** The bearer's label, mention-wrapped where applicable. */
  subject: string;
  /** The occasion as a bare noun — "birthday", "wedding anniversary". */
  occasion: string;
  /** The subject named *is* the user: their own birthday, or a wedding of
   *  theirs recorded before its other party existed. */
  subjectIsSelf: boolean;
  /** The occasion is the user's but the subject is the person they share it
   *  with — a first date, or anything borne by a relationship of theirs. */
  shared: boolean;
}

/**
 * The prompt's question, in the one place both the reminder row and the screen
 * that answers it can read it.
 *
 * ⚠️ **Centralised because it was written twice and had started to differ.** The
 * engine renders the row's title and `MilestonePlanPrompt` renders its own
 * heading, and a wording change to one silently left the other saying something
 * else about the same occasion — the drift `renderTitle` and `SCHEDULABLE_ACTIONS`
 * were each centralised to prevent.
 *
 * ⚠️ **The shared form is a correctness fix, not a nicety.** "@Violet's first
 * date" says Violet had one, with somebody. It is *yours, with Violet*, and the
 * possessive states the opposite of the fact the app is holding.
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

/** Static metadata for a reminder action: how it displays, how long it takes,
 *  and its default copy. */
export interface ReminderActionDef {
  /** Display label, e.g. "Get a gift". */
  label: string;
  /** Optional emoji shown beside the label. */
  icon?: string;
  /**
   * The action this one **delivers** — set on `send:card` (which delivers
   * `get:card`) and `send:gift`, and on nothing else.
   *
   * It exists because posting a card is not a peer of buying one: it is what you
   * do with the card afterwards, and offering the two as sibling toggles let a
   * user schedule a posting for a card they never bought. Naming the relation
   * here rather than in a component is what keeps both clients' prompts drawing
   * the same tree — the drift {@link SCHEDULABLE_ACTIONS} and `planQuestion`
   * were each centralised to prevent.
   *
   * ⚠️ It changes **presentation only**. A delivery is still an ordinary rule
   * with its own action, offset and id, still listed flat by the full schedule
   * editor, and still free to be enabled without its parent by anything that
   * writes rules directly. Only {@link promptGroupsOf} and the prompt built on
   * it treat the pair as one question.
   */
  deliveryOf?: ReminderAction;
  /**
   * How many days **before its due date** a reminder for this action goes on
   * display. Not when it comes due — how long the errand then sits on the list.
   *
   * It lives on the **action**, not on a kind's `defaultReminderSchedule`,
   * because it describes the *work*: a gift is a project whatever the occasion
   * — buy it, wrap it, post it — while a phone call takes minutes and cannot be
   * done early. `offsetDays`, which says when the thing is **due**, stays
   * per-kind, because that genuinely does vary by occasion.
   *
   * `0` means "appears on its due date, not before". A `wish` is offset 0,
   * active 0, so it shows up on the day. Required rather than optional so a new
   * action cannot silently inherit a window nobody chose for it.
   *
   * ⚠️ It is a property of the **whole** action, not of its verb. `get:gift` and
   * `get:card` are both projects at 30 days, but `send:card` is a fortnight —
   * the same card, a different errand — so a verb-keyed number could not express
   * the registry as it already stands.
   *
   * **Provisional numbers, not architecture** — data, like the onboarding snooze
   * dials in `@leapsake/reminders`, and expected to be corrected once real use
   * disagrees.
   */
  activeDays: number;
  /**
   * The latest this errand can still be done, in days before the occasion, when
   * it is started too late for its own offset — the deadline a late start slides
   * to (`effectiveOffsetDays` in `milestone.ts`), and how long a question keeps
   * offering it (`fitsAt`).
   *
   * Set only where there is a later way to do the thing: a gift or a card bought
   * too late to post can still be **handed over in person**, the day before
   * *(owner, 2026-09-11; to become configurable)*. Absent means the rule's own
   * offset is a hard deadline — a post date does not move.
   */
  latestOffsetDays?: number;
  /**
   * The reminder copy this action produces, e.g.
   * `` ({subject}) => `Get ${subject} a gift` ``. Most actions ignore the
   * occasion entirely — a gift is a gift — but {@link ReminderCopyContext.greeting}
   * is what lets `wish` serve both "Wish @Violet a happy birthday" and "Wish
   * @Violet a Merry Christmas" from one template. `other` has no fixed template —
   * its copy is the rule's free-text {@link ReminderRule.label} (see
   * {@link reminderRuleLabel}) — so it falls back to its plain label.
   */
  template: (context: ReminderCopyContext) => string;
}

/** `other`'s display label, hoisted out of the registry so its own template can
 *  reach it: the registry's type is inferred (see the `satisfies` below), so a
 *  self-reference in the initializer would be circular. */
const OTHER_LABEL = "Other";

/**
 * The reminder-action registry, parallel to `kindDefs`, keyed by the **whole**
 * `verb:qualifier` action rather than by verb.
 *
 * Keying it by verb was the obvious reading of the split and is the wrong one:
 * every field here varies by qualifier. `get:gift` and `get:card` want different
 * labels, different icons and different sentences, and `send:card` wants a
 * different `activeDays` from both. A verb-keyed registry would need a parallel
 * per-qualifier registry to put all of that back, which is two tables to keep in
 * step where one will do.
 *
 * What the verb *does* carry is the fallback for a qualifier nobody registered —
 * see {@link actionDefOf}. Insertion order is the UI listing order.
 */
export const actionDefs = {
  wish: {
    label: "Wish them",
    icon: "🎉",
    // Day-of, and only day-of. "Happy birthday" said a week early is not a
    // reminder you can act on, so it appears on the morning it is owed — the
    // single change that empties a month of standing birthday rows off Home.
    activeDays: 0,
    // The one action whose copy turns on the occasion. With a birthday's
    // greeting this renders exactly the string the birthday-only engine used to
    // hard-code, which is what keeps existing reminders from drifting on
    // upgrade; with a holiday's it reads "Wish @Violet a Merry Christmas".
    template: ({ subject, greeting }) => `Wish ${subject} ${greeting}`,
  },
  "get:gift": {
    label: "Get a gift",
    icon: "🎁",
    // The longest window of any action: choosing a gift is the one errand here
    // that genuinely wants weeks, and it is the reason `activeDays` had to exist
    // at all.
    activeDays: 30,
    // Too late to post it, you can still hand it over — the day before.
    latestOffsetDays: 1,
    template: ({ subject }) => `Get ${subject} a gift`,
  },
  "get:card": {
    label: "Get a card",
    icon: "🛒",
    // The buying half of a card, at the buying half of a gift's numbers: a shop
    // trip is a shop trip, and the thing that makes a card different from a gift
    // is the *posting*, which is `send:card`'s problem and keeps its own shorter
    // window. Splitting the two is the point of the verb/qualifier identity —
    // before it, one `card` action had to mean both and could only have one
    // due date.
    activeDays: 30,
    // As `get:gift`: a card can be handed over in person the day before.
    latestOffsetDays: 1,
    template: ({ subject }) => `Get a card for ${subject}`,
  },
  "send:card": {
    label: "Send a card",
    icon: "💌",
    deliveryOf: "get:card",
    // *Send*, per the label. A fortnight is enough runway to write and post one
    // — and deliberately shorter than `get:card`'s month, because this is the
    // errand that has a postal deadline rather than the one that has a shop.
    activeDays: 14,
    template: ({ subject }) => `Send ${subject} a card`,
  },
  "send:gift": {
    label: "Send a gift",
    icon: "📦",
    deliveryOf: "get:gift",
    // Ten days, between `send:card`'s fortnight and nothing: a parcel wants more
    // handling than an envelope (wrapping, a box, a queue at the counter) but
    // less runway than choosing the gift did, and that choosing is already
    // `get:gift`'s thirty. Provisional, like every number in this registry.
    activeDays: 10,
    template: ({ subject }) => `Post ${subject}'s gift`,
  },
  // ⚠️ The two channel actions below are **registered but not offered** — see
  // `UNOFFERED_ACTIONS` beside `SCHEDULABLE_ACTIONS` for why (a channel is an
  // affordance, not an errand). They stay here, and must, so a rule stored under
  // one before that decision still renders its real copy rather than
  // `actionDefOf`'s generic fallback. Do not delete them to tidy up.
  call: {
    label: "Give a call",
    icon: "📞",
    // Minutes, and cannot be done early — day-of like `wish`.
    activeDays: 0,
    template: ({ subject }) => `Call ${subject}`,
  },
  "message:sms": {
    label: "Send a text",
    icon: "💬",
    // A channel qualifier, and the first one: `message` is the verb that would
    // take the platform ids from `@leapsake/contact-links` (`message:discord`,
    // `message:whatsapp`) if anything ever picked one. Nothing does, and under
    // the 2026-09-05 decision nothing is meant to.
    activeDays: 0,
    template: ({ subject }) => `Text ${subject}`,
  },
  visit: {
    label: "Visit",
    icon: "🏡",
    // Due day-of, but worth a week's warning: seeing someone needs arranging,
    // even though the visit itself happens on the day.
    activeDays: 7,
    template: ({ subject }) => `Visit ${subject}`,
  },
  remember: {
    label: "Remember them",
    icon: "🕯️",
    // A death anniversary asks for nothing in advance. It arrives on the day and
    // says so quietly.
    activeDays: 0,
    template: ({ subject }) => `Remember ${subject}`,
  },
  plan: {
    label: "Decide how to mark it",
    icon: "🗓",
    // A fortnight to answer a question, which is a different kind of number from
    // the rest of this registry: every other `activeDays` is how long an
    // *errand* wants, this is how long a *decision* should sit before it is
    // owed. It is deliberately shorter than the run-up of the longest thing the
    // question offers, because the question's own due date is derived from that
    // run-up (`promptOffsetDays`) — the prompt has to come and go before the
    // errands it unlocks would have needed starting.
    //
    // ⚠️ If eight weeks turns out to feel too early to be asked, the dial to
    // turn is `get:gift`'s `activeDays`, not this one: that is where the
    // pressure actually comes from, and it is where the arithmetic reads it.
    activeDays: 14,
    // Names the occasion rather than wishing it — see `occasion` on
    // {@link ReminderCopyContext}. No distance in the copy: the row's countdown
    // is rendered from its due date (`formatDueIn`), and a written-in "in two
    // months" would be wrong by tomorrow.
    // "What do you want to do for" rather than "How do you want to mark"
    // *(owner, 2026-09-05)*. "Mark" was chosen to be neutral across every action
    // the question offers, and neutrality is what made it vague — it never says
    // what is being asked, and a reader has to open the row to find out.
    //
    // ⚠️ This is the **third-party** form, and it is not the only one. An
    // occasion that is the user's own reads "your own {occasion}", and one they
    // *share* reads "your {occasion} with {subject}" — a first date is not
    // Violet's, it is yours with Violet, and the possessive here says otherwise.
    // Both live in `copyOverrideOf` in `@leapsake/reminders`, beside the
    // self-directed wish, because they need to know who the bearer is and a
    // template only sees the words.
    template: ({ subject, occasion }) =>
      planQuestion({ subject, occasion, subjectIsSelf: false, shared: false }),
  },
  other: {
    label: OTHER_LABEL,
    icon: "🔔",
    // The user picked the lead time themselves, via the rule's own `offsetDays`;
    // a window on top of it would be second-guessing them.
    activeDays: 0,
    // No fixed copy — the rule's free-text `label` is the reminder text.
    template: () => OTHER_LABEL,
  },
} satisfies Record<string, ReminderActionDef>;

/**
 * The actions the app ships a definition for — the closed half of an otherwise
 * open type, and what {@link DefaultReminderRule} and the pickers are written
 * against, so a typo in a kind's defaults fails to compile.
 */
export type KnownReminderAction = keyof typeof actionDefs & ReminderAction;

/** Every registered action, in registry (UI listing) order. */
export const KNOWN_ACTIONS = Object.keys(
  actionDefs,
) as readonly KnownReminderAction[];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The definition for an action — its registry entry, or a generic one derived
 * from its verb when nothing has registered that qualifier.
 *
 * **Every lookup goes through this, never through {@link actionDefs} directly.**
 * The action type is open, so an index would be a possible `undefined` at every
 * call site, and the one that mattered would be inside the engine's reconcile,
 * where a throw aborts the transaction and leaves the user's whole reminder list
 * unreconciled.
 *
 * The fallback is a safety net, not a product surface: no picker can reach it
 * today, and the only way to hold an unregistered action is to sync one from a
 * later version. So it is deliberately dull — the plainest copy that names the
 * right person, and `activeDays: 0`, which is the one window that cannot be
 * wrong in the expensive direction (a row that appears late is a row that
 * appears; a row given an invented month-long window is a month of noise).
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

/**
 * The actions a schedule editor **offers**, which is deliberately narrower than
 * the actions a schedule may *hold*.
 *
 * Two exclusions, for two unrelated reasons.
 *
 * `plan` is the engine's own question about an unconfigured occasion, not an
 * errand the user picks: it is synthesized per reconcile from
 * `promptOffsetDays`, and a stored `plan` rule would both mint a prompt for an
 * occasion that has by definition already been answered and offer "decide how to
 * mark it" as one of the things you might decide to do.
 *
 * `call` and `message:sms` are excluded on a product decision *(owner,
 * 2026-09-05)*: **a channel is an affordance, not an errand.** How you reach
 * someone is a button on the acknowledgment — one row, *wish them a happy
 * birthday*, with their contact methods on it — rather than a row of its own you
 * schedule in advance. Scheduling "call Violet" and "text Violet" as separate
 * errands asks the user, weeks ahead, a question they can only answer in the
 * moment, and answers it with two rows to tick where one would do.
 *
 * ⚠️ **They keep their {@link actionDefs} entries, and that is the point.** A
 * rule already stored under one — a prompt answered before this narrowed, or a
 * peer on an older build — still resolves to proper copy instead of falling
 * through to {@link actionDefOf}'s deliberately dull generic. Nothing about the
 * data model changed: {@link reminderRuleInputSchema} validates an action by
 * *shape* and never against this list, so narrowing it cannot fail the read of a
 * stored row, and getting specific again later is an edit to this filter rather
 * than a rebuild.
 *
 * So this, and not {@link KNOWN_ACTIONS}, is what a picker lists. Both schedule
 * editors read it directly, which is why it lives here rather than being
 * filtered at each of them.
 */
const UNOFFERED_ACTIONS: readonly KnownReminderAction[] = [
  "plan",
  "call",
  "message:sms",
];

export const SCHEDULABLE_ACTIONS: readonly KnownReminderAction[] =
  KNOWN_ACTIONS.filter((action) => !UNOFFERED_ACTIONS.includes(action));

/**
 * The rule an editor's **Add** button should append, given what the schedule
 * already holds: the first offered action not already in it.
 *
 * It lives here rather than in each editor for the same reason
 * {@link SCHEDULABLE_ACTIONS} does — there are two of them, on two clients, and
 * a seed chosen locally is a seed that drifts. Both used to append a fixed
 * `call` row, which this replaces on two counts: `call` is no longer offered at
 * all, and a *fixed* seed of any action is a latent bug, since pressing Add
 * twice appends the same action twice and
 * {@link reminderScheduleInputSchema} rejects the set as a duplicate — the very
 * collapse that whole-set validation exists to catch.
 *
 * Falls back to `other` when every offered action is already present: it is the
 * free-text escape hatch, so it is the one action a schedule can hold more than
 * one of (its identity is its label — see `actionKeyOf`), and a full schedule
 * should still be able to grow a custom row.
 *
 * `offsetDays: 7` is carried over unchanged from the seed this replaces. It is a
 * starting point the user edits on the row, not a recommendation for any
 * particular action.
 */
export function nextSchedulableRule(
  existing: readonly { action: ReminderAction }[],
): ReminderRuleInput {
  const taken = new Set(existing.map((rule) => rule.action));
  const action = SCHEDULABLE_ACTIONS.find((a) => !taken.has(a)) ?? "other";
  return { action, label: null, offsetDays: 7, enabled: true };
}

/**
 * The widest {@link ReminderActionDef.activeDays} any registered action
 * declares.
 *
 * For callers that must narrow a set of *candidate occurrences* before they know
 * which actions will apply to them — `@leapsake/core`'s holiday candidate walk
 * pairs this with the widest `offsetDays` actually in use. Taking the two maxima
 * independently is deliberately generous: the sum only has to **bound** the real
 * (offset + active) reach of any single rule, never match it, and an
 * under-estimate would silently drop occurrences instead of failing. An
 * unregistered action cannot raise it, since {@link actionDefOf} gives those
 * `activeDays: 0`.
 */
export const MAX_ACTIVE_DAYS: number = Math.max(
  ...Object.values(actionDefs).map((def) => def.activeDays),
);

/**
 * The bearer types a reminder rule can hang off, via the same polymorphic
 * `(bearerType, bearerId)` pair milestones/taggings/mentions use. Adding one is
 * a Zod-only change — the column is free text.
 *
 * Note the second entry is **`observance`**, not `holiday`, though earlier
 * comments here and on migration 21 anticipated the latter. The rule bears on
 * the observance — the (person, holiday) pair — because that is what makes a
 * per-person schedule expressible: "gift Violet 30 days before Christmas" but
 * "just call Grandma day-of". Hanging it off the holiday would need a third
 * column naming the person, plus a parallel copy of the schedule machinery
 * (`@leapsake/holidays` README, the three layers).
 */
export const reminderRuleBearerTypeSchema = z.enum(["milestone", "observance"]);

export type ReminderRuleBearerType = z.infer<
  typeof reminderRuleBearerTypeSchema
>;

/**
 * A reminder rule — one entry in a bearer's staggered-reminder schedule: an
 * {@link ReminderAction} to take `offsetDays` days before the bearer's
 * occurrence (0 = day-of), on or off. A milestone with **no** rule rows rides
 * its kind's defaults (see `resolveReminderSchedule`); rows are written only
 * once the user customises the schedule.
 *
 * Deliberately **plaintext** (no per-item content key), consistent with
 * reminders themselves: reminder policy is scheduling
 * metadata, not a share target, and is covered by whole-DB-at-rest + the
 * master-key sync seal.
 *
 * Same sync-safe substrate as every domain row (see AGENTS.md): client UUID id,
 * epoch-ms UTC timestamps, nullable `deletedAt` — so it merges via whole-row
 * LWW. Kept a plain `z.object` (no `.refine`) so the entity repo can derive its
 * columns from `.shape`; the `other`-requires-a-label rule lives on the input
 * schema below.
 */
export const reminderRuleSchema = z.object({
  id: z.uuid(),
  bearerType: reminderRuleBearerTypeSchema,
  bearerId: z.uuid(),
  action: reminderActionSchema,
  /** Free-text label; carries the user's text when the verb is `other`, else null. */
  label: z.string().nullable(),
  /** Lead days before the occurrence; 0 = day-of. */
  offsetDays: z.number().int().min(0),
  enabled: z.boolean(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type ReminderRule = z.infer<typeof reminderRuleSchema>;

/**
 * One row the schedule editor emits when saving — an action, its lead time,
 * whether it's on, and (for `other`) its free-text label. The repo mints the
 * id + timestamps and the bearer is supplied by the caller. `other` requires a
 * non-empty label (mirrors the `other` milestone kind requiring a note).
 *
 * ⚠️ Note the asymmetry between the check and the type. The runtime check
 * rejects `plan`; the inferred `action` type stays the full
 * {@link ReminderAction}, which is open. That is deliberate, and it is what lets
 * the engine hand its synthesized prompt rule — a `plan`, which is not user
 * input and is never parsed — through the same shape the resolver returns,
 * instead of splitting one schedule into two types everything downstream would
 * have to discriminate.
 */
export const reminderRuleInputSchema = z
  .object({
    // A well-formed action that is not `plan`: a `plan` rule is never stored
    // (see {@link SCHEDULABLE_ACTIONS}). The stored-row schema above stays
    // permissive deliberately — narrowing it there would make a peer's row fail
    // to parse, which is a sync failure rather than a validation one.
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
 * What makes two rules on one bearer **the same reminder** — the string folded
 * into the deterministic id, and the key the duplicate check below compares.
 *
 * It is the action for everything except `other`, whose action carries no
 * information at all: the errand *is* its free-text label, so two `other` rules
 * are distinct exactly when their labels are. Keying them on `other` alone would
 * have collapsed "Send flowers" and "Book the restaurant" into one reminder —
 * the same bug the qualifier fixes for `get:gift` and `get:card`, in the form
 * that is easiest to reach, since the schedule editor visibly invites a second
 * custom row.
 *
 * Compared case- and whitespace-insensitively, so re-capitalising a custom
 * errand is an edit rather than a new reminder. ⚠️ Genuinely **renaming** one
 * still re-keys it: the old id is tombstoned and a fresh row minted, losing a
 * tick. That is the intended reading — the label is the reminder's whole
 * content, so a renamed errand is a different errand — but it is the one place
 * where editing a rule can cost a completion, and it is why the copy a *derived*
 * fact contributes (a contact method, `isSelf`) must never reach identity.
 */
export function actionKeyOf(rule: {
  action: ReminderAction;
  label?: string | null;
}): string {
  if (verbOf(rule.action) !== "other") return rule.action;
  return `other:${(rule.label ?? "").trim().toLowerCase()}`;
}

/**
 * A bearer's whole schedule as the editors and the prompt emit it — and the only
 * place a **duplicate** is caught.
 *
 * It has to be caught somewhere, and a per-row schema cannot see it. The engine
 * keys its desired set by derived id so that two devices minting "the same"
 * reminder converge on one row; the flip side is that two *different* rules
 * sharing an identity collapse into one, silently, with the later one winning.
 * Nothing in the DB prevents writing them — there is no unique constraint on
 * `reminder_rules` — so the set-level parse is the guard, and it sits on the one
 * write path both editors and the prompt's answer go through
 * (`reminderRulesRepo.replaceForBearer`).
 *
 * Reported against the *second* occurrence's index, so a form can mark the row
 * the user just added rather than the one they already had.
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

/**
 * The display label for a reminder rule: the action's registry label, except
 * `other`, which uses its free-text `label` (falling back to "Other" when
 * blank). Direct analogue of `milestoneLabel`.
 */
export function reminderRuleLabel(rule: {
  action: ReminderAction;
  label?: string | null;
}): string {
  if (verbOf(rule.action) === "other") return rule.label ?? OTHER_LABEL;
  return actionDefOf(rule.action).label;
}

/**
 * A lead time in words — "12 days before", "on the day".
 *
 * Always days, never weeks: the number is the rule's own `offsetDays`, it is
 * what the prompt is about to let the user *edit*, and "1 week before" sitting
 * beside "12 days before" in one list makes two rows look like they are measured
 * in different things.
 */
export function leadTimeLabel(offsetDays: number): string {
  if (offsetDays <= 0) return "on the day";
  return offsetDays === 1 ? "1 day before" : `${offsetDays} days before`;
}

/** One row of the prompt, carrying its index so a controlled editor can write
 *  the rule back in place. */
export interface PromptItem {
  /** Where this rule sits in the array the prompt was handed. */
  index: number;
  rule: ReminderRuleInput;
}

/**
 * The prompt's delivery question — *in person, or by mail?* — as one choice for
 * the whole occasion rather than one per item.
 *
 * **Coupled deliberately** *(owner, 2026-09-06)*: asking "and how about this
 * one?" separately under the gift and under the card is two questions where
 * nobody has two answers. The rules underneath stay independent — the full
 * schedule editor can still post the gift and hand over the card — it is only
 * the prompt that declines to ask.
 */
export interface PromptDelivery {
  /** Whether the user has chosen *by mail*. */
  mailed: boolean;
  /**
   * Whether to show the question at all: only once something it could deliver is
   * turned on. Also true whenever a delivery rule is already enabled, so the
   * group can never hide a rule that is on.
   */
  visible: boolean;
  /**
   * The lead time to describe under the choice, when every delivery it governs
   * agrees on one — null when they differ, so the caption says nothing rather
   * than picking a number arbitrarily.
   */
  offsetDays: number | null;
}

/** The prompt's rules as it draws them: the things you might do, and the one
 *  delivery question hanging under them. */
export interface PromptGroups {
  items: PromptItem[];
  /** Null when the offer set holds no delivery rules at all — nothing to ask. */
  delivery: PromptDelivery | null;
}

/**
 * The item a delivery rule belongs to, or null if this rule stands on its own —
 * including a delivery whose item **isn't in this set at all**.
 *
 * That last case is what stops the grouping ever losing a row. A schedule is
 * free to hold a `send:card` with no `get:card` beside it (the full editor can
 * write one, and a peer on an older build may sync one), and a delivery with
 * nothing to hang from would otherwise be filtered into a group that only shows
 * itself when its absent parent is on — i.e. never. Orphaned, it is simply an
 * item again, which is what it was before `deliveryOf` existed.
 */
function deliveryParentOf(
  rule: ReminderRuleInput,
  present: ReadonlySet<ReminderAction>,
): ReminderAction | null {
  const parent = actionDefOf(rule.action).deliveryOf;
  return parent !== undefined && present.has(parent) ? parent : null;
}

/**
 * Split an offer set into the prompt's two groups.
 *
 * Pure and index-carrying, because the prompt writes back the **whole** set
 * positionally: rows existing is what makes "asked, and chose nothing"
 * distinguishable from "never asked", so nothing here may drop a rule.
 */
export function promptGroupsOf(
  rules: readonly ReminderRuleInput[],
): PromptGroups {
  const present = new Set(rules.map((r) => r.action));
  const items: PromptItem[] = [];
  const deliveries: PromptItem[] = [];
  rules.forEach((rule, index) => {
    (deliveryParentOf(rule, present) === null ? items : deliveries).push({
      index,
      rule,
    });
  });
  if (deliveries.length === 0) return { items, delivery: null };

  const on = new Set(
    items.filter((i) => i.rule.enabled).map((i) => i.rule.action),
  );
  // The deliveries this choice actually governs right now — the ones whose item
  // is on. The caption's lead time is read from these rather than from all of
  // them, so turning the gift off stops the card's number being described as if
  // it covered both.
  const live = deliveries.filter((d) =>
    on.has(deliveryParentOf(d.rule, present) as ReminderAction),
  );
  const mailed = deliveries.some((d) => d.rule.enabled);
  const offsets = new Set(live.map((d) => d.rule.offsetDays));

  return {
    items,
    delivery: {
      mailed,
      visible: live.length > 0 || mailed,
      offsetDays: offsets.size === 1 ? [...offsets][0]! : null,
    },
  };
}

/**
 * Re-derive every delivery rule from the delivery choice and its item's state:
 * on exactly when the user picked *by mail* **and** the thing being delivered is
 * itself on.
 *
 * This is what stops the prompt writing a posting for a card nobody is getting.
 * It runs on every edit rather than only on the delivery toggle, because turning
 * an item **off** has to take its delivery with it — and the row must still be
 * written, disabled, never dropped.
 */
function reconcileDelivery(
  rules: readonly ReminderRuleInput[],
  mailed: boolean,
): ReminderRuleInput[] {
  const present = new Set(rules.map((r) => r.action));
  const on = new Set(
    rules
      .filter((r) => r.enabled && deliveryParentOf(r, present) === null)
      .map((r) => r.action),
  );
  return rules.map((rule) => {
    const parent = deliveryParentOf(rule, present);
    if (parent === null) return rule;
    return { ...rule, enabled: mailed && on.has(parent) };
  });
}

/**
 * Turn one of the prompt's items on or off, carrying its delivery with it.
 *
 * `index` addresses the array the prompt was handed — a {@link PromptItem}'s
 * own. Handing it a delivery rule's index is a caller error: the delivery is set
 * through {@link setPromptDelivery}, which is the only thing that owns that bit.
 */
export function setPromptItem(
  rules: readonly ReminderRuleInput[],
  index: number,
  enabled: boolean,
): ReminderRuleInput[] {
  const mailed = promptGroupsOf(rules).delivery?.mailed ?? false;
  return reconcileDelivery(
    rules.map((rule, i) => (i === index ? { ...rule, enabled } : rule)),
    mailed,
  );
}

/** Answer the delivery question for the whole occasion. */
export function setPromptDelivery(
  rules: readonly ReminderRuleInput[],
  mailed: boolean,
): ReminderRuleInput[] {
  return reconcileDelivery(rules, mailed);
}
