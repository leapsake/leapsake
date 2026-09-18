import {
  type ContactMethod,
  type CreateReminderInput,
  type EntityType,
  type GiftPartyType,
  type MilestoneBearerType,
  type MilestoneKind,
  type Reminder,
  type ReminderRuleInput,
  type ReminderWithTags,
  type ResolvedMention,
  type UpdateReminderInput,
  baseRole,
  civilFromDueMs,
  daysUntil,
  isReminderEditable,
  isRomanticRole,
  kindDefs,
  parseHashtags,
  parseMentions,
  planOffers,
  resolveObservanceReminderSchedule,
  resolveReminderSchedule,
  todayCivil,
  verbOf,
} from "@leapsake/schema";
import {
  type ContactMethodsRepo,
  type DuplicateService,
  type EntityService,
  type MentionsRepo,
  type MilestonesRepo,
  type NotificationSettingsRepo,
  type PeopleRepo,
  type PetsRepo,
  type RelationshipsRepo,
  type ReminderRulesRepo,
  type RemindersRepo,
  type SelfPersonRepo,
  type SqliteDriver,
  type TagsRepo,
  endpointsOf,
  listContactMethods,
} from "@leapsake/data";
import type {
  HolidayOccurrenceCandidate,
  ReminderEngineDeps,
  ReminderWindowFacts,
  UndatedPartnership,
  WindowedReminder,
} from "./engine.js";
import {
  DISPLAY_WINDOW_DAYS,
  getReminderInWindow,
  listNotifiableReminders,
  listRemindersInWindow,
  listSystemReminderTargets,
  materializeReminder,
  partnershipNudgeId,
  regenerateSystemReminders,
  snoozeTargetOf,
} from "./engine.js";

/**
 * A reminder as the **list** reads it: the joined row plus the two timing facts
 * only the engine can supply (see {@link createRemindersApi}'s `listInWindow`).
 */
export type ReminderInWindow = ReminderWithTags & ReminderWindowFacts;

/**
 * A `🎁 gift` system reminder paired with the person/pet it's about — what turns
 * "Get @Violet a gift" from a note into a loop: the client links it to Violet's
 * gifts, and once it's done, to ticking off what was actually given
 *. Derived from the engine's own desired-set walk,
 * so it lights up on exactly the reminders the engine minted — never a stored
 * column, in keeping with the id-convention the onboarding CTAs established.
 */
export interface GiftReminderTarget {
  reminderId: string;
  recipientType: GiftPartyType;
  recipientId: string;
}

/**
 * A `🎉 wish` reminder paired with the ways its person can actually be reached —
 * the read behind both halves of the acknowledgment: the buttons when there are
 * methods, and the *add a way to reach them* prompt when there are none.
 *
 * Derived from the same desired-set walk as the gift and prompt targets, so it
 * lights up on exactly the rows the engine minted rather than on a stored column.
 *
 * ⚠️ **The methods travel with it, rather than being a second read per row.** A
 * client rendering this has to know both *whether* there is a way in and *which*
 * ones, and the two answers come from one query; splitting them would mean the
 * screen deciding what to show before it knows what it has.
 */
export interface ContactReminderTarget {
  reminderId: string;
  /** Always a person: a pet owns no contact methods. */
  personId: string;
  /** Their display label, for copy that has to name them — the confirmation
   *  before a call, which interrupts someone and should say who. */
  subject: string;
  /** Their reachable methods, postal excluded — see {@link reachableMethods}. */
  methods: ContactMethod[];
}

/** Everything today's automated reminders are about, from one walk — see
 *  `reminders.targets`. */
export interface SystemReminderTargets {
  gifts: GiftReminderTarget[];
  plans: PlanReminderTarget[];
  contacts: ContactReminderTarget[];
  partnerships: PartnershipReminderTarget[];
  linkPartners: LinkPartnerReminderTarget[];
}

/**
 * A wedding reminder with nobody on the other side of the wedding.
 *
 * The dual of {@link PartnershipReminderTarget}: that one knows the couple and
 * wants the date, this one knows the date and wants the couple. Both exist
 * because a wedding can be recorded from one person's page before its other
 * party is in the app at all — the create form offers "unknown" for exactly that.
 *
 * ⚠️ Costs no row of its own. It is an affordance on a reminder that already
 * exists, like the contact-collection CTA, which is why it is not weighed against
 * the compounding rule in `@leapsake/reminders` → *Collecting what is missing*.
 */
export interface LinkPartnerReminderTarget {
  reminderId: string;
  milestoneId: string;
  personId: string;
  /** Whether it is the user's own wedding — a wording difference only. */
  isSelf: boolean;
}

/**
 * One partnership question on today's list, and what answering it means.
 *
 * Built from core's own read rather than from the engine's target walk — the
 * same shape the duplicates nudge uses (`duplicates.nudgeId`), and for the same
 * reason: the row has no person or pet bearer to hang a target off, so the id is
 * recomputed here from the data that minted it.
 */
export interface PartnershipReminderTarget {
  reminderId: string;
  relationshipId: string;
  /** Which date is missing — and so which kind the form should open on. */
  milestoneKind: "wedding" | "first-date";
  /** The partner, for a client that would rather route via their page. */
  partnerId: string;
}

/**
 * The contact methods worth offering *on a reminder*, which is not all of them:
 * everything but the postal address.
 *
 * ⚠️ **A mailing address is not a way to say happy birthday on the day**
 * *(owner, 2026-09-05)*. It is a real contact method and it belongs on the
 * person's own screen; what it is not is something you can act on when the
 * reminder fires. Posting something has its own reminder, `send:card`, on its
 * own clock a week or more earlier — so an address offered here would be an
 * affordance for an errand whose deadline has already gone.
 *
 * Filtered here rather than in each client so the two cannot disagree about what
 * "a way to reach them" means, and so the reasoning has one home.
 */
function reachableMethods(methods: ContactMethod[]): ContactMethod[] {
  return methods.filter((entry) => entry.kind !== "postal");
}

/**
 * A `🗓 plan` prompt and everything needed to answer it — the read behind the
 * prompt CTA, and the exact analogue of {@link GiftReminderTarget}: the same
 * `listSystemReminderTargets` walk, so the affordance lights up on precisely the
 * rows the engine minted rather than on a stored column.
 *
 * It carries the **offer set** as well as the milestone. Answering writes the
 * *full* set — the unticked actions as `enabled: false` rows, which is what
 * makes "I was asked and chose nothing" distinguishable from "I was never
 * asked" — so a client that had only the milestone would need a second read
 * before it could write anything, including for the one-tap answer.
 */
export interface PlanReminderTarget {
  reminderId: string;
  milestoneId: string;
  /** Named for what it is: a reminder CTA discriminates on `kind`, so the
   *  view-model this feeds keeps the two apart. */
  milestoneKind: MilestoneKind;
  /**
   * Who the occasion belongs to, for the prompt's own heading — a person, a pet,
   * or the **relationship** a wedding anniversary or a first date is linked to.
   */
  bearerType: MilestoneBearerType;
  bearerId: string;
  /** That bearer's display label, so the screen can name who it is asking about. */
  subject: string;
  /**
   * Which of `planQuestion`'s three shapes the question takes — see it in
   * `@leapsake/schema`. Carried rather than re-derived so the screen that
   * answers a prompt and the row that sent the user there can never word the
   * same question differently, which they had begun to.
   */
  subjectIsSelf: boolean;
  shared: boolean;
  /**
   * The occasion itself, as a stored due-date epoch.
   *
   * ⚠️ Not the same as the reminder's `dueDate`, and the difference is the whole
   * reason this is here. Every row renders its trailing distance from `dueDate`,
   * which for a prompt is *decide by* — six weeks before the birthday. On the
   * row that reads correctly, in the same convention every other reminder uses.
   * On the screen that asks the question there is room to say when the occasion
   * actually is, and saying it is what stops "in 2 weeks" being read as the
   * birthday.
   */
  occurrenceDate: number | null;
  /** Every action offered, `enabled` carrying which arrive pre-ticked. */
  offers: ReminderRuleInput[];
}

// The `@mention` targets embedded inline in a reminder's text — the derivation
// input the `mentions` join is reconciled to on every write, mirroring how
// `parseHashtags` drives the taggings graph. Title and body are joined so a
// mention in either field counts.
function mentionTargetsOf(r: {
  title: string | null;
  body: string | null;
}): { targetType: EntityType; targetId: string }[] {
  return parseMentions(`${r.title ?? ""}\n${r.body ?? ""}`).map((m) => ({
    targetType: m.targetType,
    targetId: m.targetId,
  }));
}

export interface RemindersApiDeps {
  reminders: RemindersRepo;
  milestones: MilestonesRepo;
  reminderRules: ReminderRulesRepo;
  mentions: MentionsRepo;
  tags: TagsRepo;
  self: SelfPersonRepo;
  relationships: RelationshipsRepo;
  people: PeopleRepo;
  pets: PetsRepo;
  notificationSettings: NotificationSettingsRepo;
  contactMethods: ContactMethodsRepo;
  entities: EntityService;
  duplicates: DuplicateService;
  driver: SqliteDriver;
  /** A relationship's display label — `null` means *gone*, which the engine
   *  reads as "skip this milestone". */
  relationshipLabel: (id: string) => Promise<string | null>;
  /**
   * Whether this store has an account yet, for the custody onboarding nudge.
   * Injected rather than read here: the answer lives in `@leapsake/key-custody`,
   * and reminders has no business depending on custody to ask one question.
   */
  hasAccount: () => Promise<boolean>;
  /**
   * Today's holiday-observance candidates. Injected because `@leapsake/holidays`
   * already depends on this package — importing it back would be a cycle.
   */
  listHolidayCandidates: () => Promise<HolidayOccurrenceCandidate[]>;
}

/**
 * The repo-backed Reminders surface: the reads a client makes, the writes that
 * keep a reminder's #tags and @mentions in step with its text, and the
 * composition root that builds this package's own engine ports over real repos.
 *
 * The engine — the desired-set walk, the display window, the copy — is the rest
 * of this package and takes {@link ReminderEngineDeps}. This is the layer that
 * supplies them.
 */
export function createRemindersApi(deps: RemindersApiDeps) {
  const {
    reminders,
    milestones,
    reminderRules,
    mentions,
    tags,
    self,
    relationships,
    people,
    pets,
    notificationSettings,
    contactMethods,
    entities,
    duplicates,
    driver,
    relationshipLabel,
  } = deps;

  // The @mention targets a reminder's text currently names, each resolved to the
  // label its target goes by now, so a renamed person reads correctly in an old
  // reminder. The join rows say *which* entities are mentioned; the label is
  // re-resolved fresh.
  const resolveMentions = async (
    reminderId: string,
  ): Promise<ResolvedMention[]> => {
    const rows = await mentions.listForBearer("reminder", reminderId);
    return Promise.all(
      rows.map(async (m) => ({
        targetType: m.targetType,
        targetId: m.targetId,
        label: (await entities.label(m.targetType, m.targetId)) ?? null,
      })),
    );
  };

  /**
   * Is this milestone **about you**? The self-person, or a relationship they are
   * one end of. Named rather than inline because two readers need the same
   * answer: the engine's copy layer, which flips a wish and a prompt to their
   * self-directed wording, and `reminders.targets`, which tells the screen that
   * answers a prompt how the question was phrased.
   */
  async function milestoneIsSelf(
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<boolean> {
    const selfId = (await self.getSelf())?.personId;
    if (selfId === undefined) return false;
    if (bearerType === "person") return bearerId === selfId;
    if (bearerType === "relationship")
      return endpointsOf(await relationships.get(bearerId)).some(
        (e) => e.type === "person" && e.id === selfId,
      );
    return false; // a pet is never you
  }

  /**
   * Any milestone bearer, named — the person, the pet, or the relationship. The
   * engine's `resolveLabel` port and the `reminders.targets` reads both go
   * through it so a relationship cannot be named one way in the reminder's text
   * and another on the screen that answers it.
   */
  async function milestoneBearerLabel(
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<string | null> {
    return bearerType === "relationship"
      ? relationshipLabel(bearerId)
      : ((await entities.label(bearerType, bearerId)) ?? null);
  }

  /**
   * The user's own romantic partnerships that have no date on them yet.
   *
   * Which date is missing follows from the role, and only one is ever asked for:
   * a marriage wants its **wedding** anniversary, an unmarried partnership its
   * **first date**. Asking the wrong one is worse than not asking, since
   * "when is your wedding anniversary?" of someone unmarried invents a marriage.
   *
   * ⚠️ **A date recorded on *either* bearer counts as known.** A wedding lives on
   * the relationship once its other party exists and on the person before that
   * (`MilestoneRebind` is the flow between the two), so checking only one of them
   * would re-ask for a date the user has already given — the single worst thing a
   * collection nudge can do.
   */
  async function undatedOwnPartnerships(): Promise<UndatedPartnership[]> {
    const selfId = (await self.getSelf())?.personId;
    if (selfId === undefined) return []; // nobody has said who they are
    const found: UndatedPartnership[] = [];
    for (const rel of await relationships.listForEntity("person", selfId)) {
      const roles = [rel.aRole, rel.bRole];
      if (!roles.some(isRomanticRole)) continue;
      const other = endpointsOf(rel).find(
        (e) => !(e.type === "person" && e.id === selfId),
      );
      // A pet cannot hold a romantic role, but the guard keeps the narrowing
      // honest rather than relying on that staying true.
      if (other === undefined || other.type !== "person") continue;
      const kind = roles.some((r) => baseRole(r) === "spouse")
        ? "wedding"
        : "first-date";
      const dated = [
        ...(await milestones.listForBearer("relationship", rel.id)),
        ...(await milestones.listForBearer("person", other.id)),
      ].some((m) => m.kind === kind);
      if (dated) continue;
      const partnerLabel = await entities.label(other.type, other.id);
      if (partnerLabel === undefined) continue; // partner gone
      found.push({
        relationshipId: rel.id,
        kind,
        partnerLabel,
        partnerType: "person",
        partnerId: other.id,
      });
    }
    return found;
  }

  /**
   * Which of `planQuestion`'s three shapes a prompt takes — see it in
   * `@leapsake/schema` for why the possessive matters.
   */
  async function planPhrasing(
    bearerType: MilestoneBearerType,
    bearerId: string,
    kind: MilestoneKind,
  ): Promise<{ subjectIsSelf: boolean; shared: boolean }> {
    const isSelf = await milestoneIsSelf(bearerType, bearerId);
    const subjectIsSelf = isSelf && bearerType === "person";
    return {
      subjectIsSelf,
      shared:
        !subjectIsSelf &&
        (kindDefs[kind].prompt?.onlyOwnPartnership === true || isSelf),
    };
  }

  // The composition root for automated (`system`) reminders: the
  // `@leapsake/reminders` engine's ports over the real repos + this core's own
  // `resolveLabel`. Built fresh per call so "today" is re-read each time — the
  // local civil date (a calendar event fires on the user's day). Two consumers:
  // `regenerateSystem` below reconciles the store to it (at boot/focus *and*
  // after every milestone write, so an added / edited / deleted birthday
  // reconciles at once), and `reminders.targets` reads the same walk without
  // writing.
  const systemReminderDeps = (): ReminderEngineDeps => ({
    milestones: {
      listRemindEligible: () => milestones.listRemindEligible(),
    },
    // The milestone's effective staggered schedule: its stored rule rows, or —
    // when untouched — its kind's defaults (schema's `resolveReminderSchedule`,
    // the same resolve the editor loads). The engine mints one reminder per
    // enabled entry.
    // Answers with its source as well as its rules: "no rules of its own" is
    // what mints the prompt, not a diagnostic.
    resolveSchedule: async (m) =>
      resolveReminderSchedule(
        m.kind,
        await reminderRules.listForBearer("milestone", m.id),
      ),
    reminders: {
      getIncludingDeleted: (id) => reminders.getIncludingDeleted(id),
      // The engine writes system reminders through this port (bypassing the
      // `create` wrapper above), so materialize their @mentions here too: the
      // birthday title carries a mention token, re-derived into the same synced
      // backlink. Runs inside the engine's own transaction.
      insert: async (row) => {
        const inserted = await reminders.insert(row);
        await mentions.setEntityMentions(
          "reminder",
          inserted.id,
          mentionTargetsOf(inserted),
        );
        return inserted;
      },
      // A milestone edit moves the date or renames the subject: refresh the
      // still-live reminder's derived fields, then re-derive its @mentions from
      // the new title (the mention token's baked-in name changed on a rename).
      update: async (id, fields) => {
        const changed = await reminders.update(id, fields);
        if (changed) {
          await mentions.setEntityMentions(
            "reminder",
            id,
            mentionTargetsOf(changed),
          );
        }
      },
      listWhere: (query) => reminders.listWhere(query),
      // Pruning a stale system reminder clears its mentions too (mirrors the
      // user-facing softDelete above).
      softDelete: async (id) => {
        await reminders.softDelete(id);
        await mentions.removeAllForBearer("reminder", id);
      },
    },
    // A milestone's bearer, named. `null` means **gone**, and only gone: the
    // engine skips a row it cannot name, so answering `null` for a bearer type
    // that merely had no formatter is how relationship-borne milestones — every
    // wedding anniversary linked to its relationship — silently produced no
    // reminders at all until 2026-09-05.
    resolveLabel: milestoneBearerLabel,
    // Is this milestone about *you*? Flips your own birthday's wish, and your own
    // anniversary's prompt, to their self-directed copy. A relationship you are
    // one end of counts — that is what makes "your own wedding anniversary" ask
    // about itself rather than about the pair.
    isSelf: milestoneIsSelf,
    // Is this milestone about a romantic partnership *the user is in*? Gates the
    // `first-date` prompt, and nothing else (`kindDefs`, `prompt`).
    //
    // Two shapes, because a first date can be recorded either way: borne by the
    // relationship, or borne by the partner while the relationship is only
    // implied. The second is the common one — a milestone is created from a
    // person's page — and it is why this is not simply `isSelf`.
    isOwnPartnership: async (bearerType, bearerId) => {
      const selfId = (await self.getSelf())?.personId;
      if (selfId === undefined) return false; // nobody has said who they are
      if (bearerType === "relationship") {
        const rel = await relationships.get(bearerId);
        if (rel === undefined) return false;
        return (
          endpointsOf(rel).some(
            (e) => e.type === "person" && e.id === selfId,
          ) &&
          (isRomanticRole(rel.aRole) || isRomanticRole(rel.bRole))
        );
      }
      if (bearerType !== "person") return false;
      // Borne by **you**, with the other party not yet in the app at all — a
      // wedding recorded before its spouse exists, which the create form's
      // "unknown" escape exists to allow. Your own occasion is yours whether or
      // not the app knows who else was there, and refusing to ask about it
      // because the record is incomplete is exactly the gate this package does
      // not put in front of people.
      if (bearerId === selfId) return true;
      // Borne by the partner: is there a stored romantic edge between them and
      // you? Read from the milestone's bearer rather than from the self-person,
      // since one person has few relationships and "you" may have many.
      const edges = await relationships.listForEntity("person", bearerId);
      return edges.some(
        (rel) =>
          endpointsOf(rel).some(
            (e) => e.type === "person" && e.id === selfId,
          ) &&
          (isRomanticRole(rel.aRole) || isRomanticRole(rel.bRole)),
      );
    },
    today: todayCivil(),
    transaction: (body) => driver.transaction(body),
    // The first-run signals for the onboarding nudges. `hasAnyEntity` gates the
    // "import your contacts" step and (with `hasAccount`) the account
    // invitation; `hasSelf` gates the "pick yourself" step. All retire (prune)
    // automatically once satisfied — see `@leapsake/reminders` ONBOARDING_STEPS.
    onboarding: {
      // **Besides the self-person**, which is what makes the getting-started and
      // custody steps read an *empty* store rather than merely a small one. A
      // store holding only your own name has nothing in it a personal CRM is
      // for, and counting it would let "tell us about yourself" retire the
      // invitation to import — permanently, by tombstone — for having answered a
      // different question. A pet is never the self-person, so only people are
      // filtered.
      hasAnyEntityBesidesSelf: async () => {
        if ((await pets.list()).length > 0) return true;
        const selfId = (await self.getSelf())?.personId;
        return (await people.list()).some((person) => person.id !== selfId);
      },
      hasSelf: async () => (await self.getSelf()) !== undefined,
      hasAccount: () => deps.hasAccount(),
      // No row is pre-created for a device: `notificationSettings` writes one
      // the first time that device is given a policy or answers the permission
      // prompt, so an empty list is "nobody here has ever been asked" and needs
      // no nullable column to say it.
      //
      // ⚠️ Store-scoped, where the question is really per-device — this core has
      // no ambient "this device" to ask about, deliberately, and the nudge could
      // not use one anyway. The `enable-notifications` step holds the whole
      // argument.
      hasNotificationPolicy: async () =>
        (await notificationSettings.list()).length > 0,
    },
    // Holiday observances — the second dated reminder family. Always supplied
    // here, never conditionally: the engine prunes (and permanently
    // tombstones) every active system reminder absent from the desired set, so
    // a client that omitted this port would silently kill every holiday
    // reminder it had already generated.
    holidays: {
      listCandidates: () => deps.listHolidayCandidates(),
      // Per-observance schedule: stored rules when customised, else the
      // observance defaults — the same "missing rows ⇒ defaults" contract
      // milestones use, which is what keeps an untouched observance free of
      // stored rows and of sync churn.
      resolveSchedule: async (candidate) =>
        resolveObservanceReminderSchedule(
          await reminderRules.listForBearer(
            "observance",
            candidate.observanceId,
          ),
        ),
      resolveLabel: async (bearerType, bearerId) =>
        (await entities.label(bearerType, bearerId)) ?? null,
    },
    // Unresolved duplicate pairs — the fourth family. Always supplied, for the
    // same reason `holidays` is: an omitted port prunes (and tombstones) the
    // nudge the last reconcile minted.
    duplicates: { pairKeys: () => duplicates.unresolvedPairKeys() },
    // The fifth family: the user's own partnerships with no date recorded. See
    // the port's doc-comment for why this one collects rather than reminds, and
    // why it is deliberately narrow.
    partnerships: { undated: undatedOwnPartnerships },
  });

  const regenerateSystem = (): Promise<{
    created: number;
    updated: number;
    removed: number;
  }> => regenerateSystemReminders(systemReminderDeps());

  /**
   * The notification planner's input — a year of reminders, most of which are
   * not rows yet (see the engine's `listNotifiableReminders`). Deliberately
   * *not* folded into `reminders.list()`: that feeds the reminder **list**,
   * which shows only what each action's own `activeDays` says is worth showing
   * today. Two questions, two readers.
   *
   * Returns bare rows, no tags/mentions join — a notification renders plain
   * text, so the joins `reminders.list()` does for the UI would be waste.
   */
  const listNotifiable = (): Promise<Reminder[]> =>
    listNotifiableReminders(systemReminderDeps());

  /**
   * A windowed row with its tags and mentions attached — the join both
   * {@link listInWindow} and {@link getInWindow} end in, and the reason they
   * share one.
   *
   * ⚠️ **The branches are statements on purpose; do not fold them back into a
   * ternary.** Hermes miscompiles a conditional-expression branch holding more
   * than one `await`: the branch's value is thrown away and a leftover register
   * — a plain number, every time we have seen it — is returned in its place.
   * Written as
   * `row.materialized ? { ...row, tags: await …, mentions: await … } : …`, this
   * handed mobile Home a `0` for every *stored* reminder, which
   * `partitionReminders` then filed under completed (`undefined !== null` is
   * true) and the row renderer crashed reading its title. Node and the desktop
   * bundler compile the same source correctly, so **no `vitest` tier can
   * observe it**; `scripts/hermes-await-in-ternary.test.mjs` keeps the
   * shape from coming back instead.
   */
  const withTagsAndMentions = async (
    row: WindowedReminder,
  ): Promise<ReminderInWindow> => {
    if (!row.materialized) return { ...row, tags: [], mentions: [] };
    const rowTags = await tags.listForEntity("reminder", row.id);
    const rowMentions = await resolveMentions(row.id);
    return { ...row, tags: rowTags, mentions: rowMentions };
  };

  /**
   * What the reminder **list** shows — every reminder inside
   * `DISPLAY_WINDOW_DAYS`, each carrying the two dates the stored row cannot
   * say: when it goes on display, and what occasion it counts down to. The
   * clients bucket on those (`bucketReminders` in `@leapsake/view-models`); past
   * due and belated are not distinguishable without them, and *coming* rows are
   * not rows yet at all.
   *
   * A third read rather than a wider `list()`, for the same reason
   * `listNotifiable` is: three questions, three horizons. This one still joins
   * tags and mentions, because it feeds a screen — but only for rows that
   * exist. A preview gets empty arrays: its title already carries the mention
   * token verbatim, so the name renders from the text, and the join only ever
   * supplied *current* labels, which a row with no state has nothing to correct.
   */
  const listInWindow = async (): Promise<ReminderInWindow[]> => {
    const rows = await listRemindersInWindow(
      systemReminderDeps(),
      DISPLAY_WINDOW_DAYS,
    );
    return Promise.all(rows.map(withTagsAndMentions));
  };

  /**
   * One reminder as `listInWindow` sees it — what a **detail** screen reads.
   *
   * The stored row is not the same thing: part of what a reminder says is
   * derived on the engine's walk and never persisted (the belated wording
   * today), so a detail screen reading `get` would word the row differently
   * from the list that linked to it. It also carries the two dates the row
   * cannot say, which is what lets the screen name *which* way it was missed.
   *
   * Falls back to the stored row for an id the walk does not want — a `system`
   * reminder whose window has closed since the link was made. Outside the
   * window there is no derivation to apply, so the plain row is the whole truth
   * about it, and showing it beats showing nothing.
   */
  const getInWindow = async (
    id: string,
  ): Promise<ReminderInWindow | undefined> => {
    const row = await getReminderInWindow(systemReminderDeps(), id);
    if (row === undefined) {
      const stored = await reminders.get(id);
      if (stored === undefined) return undefined;
      return withTagsAndMentions({
        ...stored,
        activeFrom: null,
        occurrenceDate: null,
        countdownDate: stored.dueDate,
        materialized: true,
      });
    }
    return withTagsAndMentions(row);
  };

  return {
    // Reads join each reminder with its #tags (resolved to their tag rows) and
    // its @mentions (resolved to each target's current label), so a client can
    // link the inline hashtags and mention tokens in the text to their pages. The
    // text stays the source of truth for *which* tags/mentions exist (see
    // create/update); this only attaches what they resolve to right now.
    list: async (): Promise<ReminderWithTags[]> => {
      const rows = await reminders.list();
      return Promise.all(
        rows.map(async (r) => ({
          ...r,
          tags: await tags.listForEntity("reminder", r.id),
          mentions: await resolveMentions(r.id),
        })),
      );
    },
    /**
     * What a device should plan **notifications** from — a year ahead, most
     * of it not yet rows. See `listNotifiable` above for why this is a
     * separate read from `list` rather than a wider one.
     */
    listNotifiable,
    /** What the reminder list shows, bucketed by the clients. See above. */
    listInWindow,
    /** One row of that same list — what a detail screen reads. See above. */
    getInWindow,
    get: async (id: string): Promise<ReminderWithTags | undefined> => {
      const reminder = await reminders.get(id);
      if (!reminder) return undefined;
      return {
        ...reminder,
        tags: await tags.listForEntity("reminder", id),
        mentions: await resolveMentions(id),
      };
    },
    // The reminder text is the single source of truth for its #tags AND its
    // @mentions: on every create/update we re-parse both out of title+body and
    // reconcile them under bearer type "reminder" — `#tags` into the shared
    // taggings graph, `@mention` tokens into the synced `mentions` backlink.
    create: (input: CreateReminderInput): Promise<Reminder> =>
      driver.transaction(async () => {
        const reminder = await reminders.create(input);
        await tags.setEntityTags(
          "reminder",
          reminder.id,
          parseHashtags(`${reminder.title ?? ""}\n${reminder.body ?? ""}`),
        );
        await mentions.setEntityMentions(
          "reminder",
          reminder.id,
          mentionTargetsOf(reminder),
        );
        return reminder;
      }),
    update: (
      id: string,
      input: UpdateReminderInput,
    ): Promise<Reminder | undefined> =>
      driver.transaction(async () => {
        // Only user-authored reminders are content-editable: an automatic
        // (`system`) reminder's title/details are owned by the birthday engine,
        // which re-derives them on every reconcile, so a user edit here would be
        // silently overwritten. Completion and deletion aren't routed through
        // this method (setCompleted / softDelete), so they stay open on system
        // reminders. The engine's own drift-repair uses the repo directly, not
        // this guarded wrapper, so it is unaffected.
        const existing = await reminders.get(id);
        if (existing === undefined) return undefined;
        if (!isReminderEditable(existing)) {
          throw new Error("Automatic reminders can't be edited.");
        }
        const reminder = await reminders.update(id, input);
        if (reminder) {
          await tags.setEntityTags(
            "reminder",
            id,
            parseHashtags(`${reminder.title ?? ""}\n${reminder.body ?? ""}`),
          );
          await mentions.setEntityMentions(
            "reminder",
            id,
            mentionTargetsOf(reminder),
          );
        }
        return reminder;
      }),
    // The reverse of an inline `@mention`: every reminder whose text mentions
    // this entity, so its detail page can list "who talks about me". The mirror
    // of `tags.remindersForTag` — read the indexed backlink (scoped to reminder
    // bearers), fan out to `reminders.get`, drop any gone. System (birthday)
    // reminders count: a person's own birthday reminder mentions them. Soft-
    // deleted reminders already fall out (their mentions clear on delete and
    // `reminders.get` skips tombstones), so the filter is just defensive.
    mentioning: async (
      targetType: EntityType,
      targetId: string,
    ): Promise<Reminder[]> => {
      const ids = await mentions.bearerIdsForTarget(
        targetType,
        targetId,
        "reminder",
      );
      const found = await Promise.all(ids.map((id) => reminders.get(id)));
      return found.filter((r): r is Reminder => r !== undefined);
    },
    /**
     * Reversible completion toggle: stamps/clears `completedAt`; text (and so
     * its tags/mentions) is untouched, so no re-derivation needed.
     *
     * **A row that does not exist yet is minted first.** The list shows
     * reminders ahead of their own display window (`listInWindow`'s *coming*
     * rows), and everything can be done early — the window decides when the
     * app prompts you, never what you are allowed to do — so ticking a preview
     * has to create the thing being ticked. One write method either way; the
     * client never has to know which kind of row it had.
     *
     * ⚠️ Completing one early **retires it for the year**: the next reconcile
     * does not want that row yet and prunes it to a tombstone, which is never
     * resurrected. That is the intended reading ("already bought it, stop
     * asking") — see `materializeReminder` — but it is permanent.
     */
    setCompleted: (
      id: string,
      completed: boolean,
    ): Promise<Reminder | undefined> =>
      // Both halves in one transaction: a mint that lands without its
      // completion would leave a row the user thinks they ticked, and the
      // next reconcile would prune it away again.
      driver.transaction(async () => {
        if (completed && (await reminders.get(id)) === undefined)
          await materializeReminder(systemReminderDeps(), id);
        return reminders.setCompleted(id, completed);
      }),
    // "Remind me in `days` days." The caller asks for a day count and this
    // decides the day, from the row as the list shows it, by the one rule the
    // offers are drawn from too (`snoozeTargetOf`) — so no caller can pick a
    // day, or put off a row that rule refuses. A refusal throws rather than
    // quietly writing nothing: every offer already passed the same rule, so
    // reaching it means a stale screen, which should say so.
    //
    // Materializes first, exactly as `setCompleted` does: a `system` row can be
    // on Today before the reconcile that stores it has run.
    //
    // Deliberately skips `isReminderEditable`, the way `setCompleted` does:
    // snoozing is not a content edit, so it stays open on `system` rows. Text
    // is untouched, so no tags/mentions to re-derive.
    snooze: (id: string, days: number): Promise<Reminder | undefined> =>
      driver.transaction(async () => {
        const row = await getInWindow(id);
        if (row === undefined) return undefined;
        const until = snoozeTargetOf(row, days, Date.now());
        if (until === null)
          throw new Error(`reminder ${id} cannot be put off ${days} days`);
        if ((await reminders.get(id)) === undefined)
          await materializeReminder(systemReminderDeps(), id);
        return reminders.snooze(id, until);
      }),
    softDelete: (id: string): Promise<void> =>
      driver.transaction(async () => {
        await reminders.softDelete(id);
        await tags.removeAllForEntity("reminder", id);
        await mentions.removeAllForBearer("reminder", id);
      }),
    // Reconcile today's automated (`system`) reminders. Runs at boot/focus (a
    // new local day can bring a birthday into range) — clients call this one and
    // kick the refresh/sync path when a count is non-zero. Milestone writes
    // reconcile on their own (see `milestones`), so this needn't be called after
    // them. See {@link regenerateSystem}.
    regenerateSystem,
    /**
     * Everything today's automated reminders are *about*, in **one** walk.
     *
     * Three affordances read the same desired-set walk to answer three
     * questions — which rows are gifts, which are prompts, which are wishes
     * about a person — and they used to be three exported reads, which meant a
     * screen wanting two of them ran the whole engine walk twice. The reminder
     * detail screen wanted all three, and with `getInWindow` beside them that
     * was four walks to draw one row.
     *
     * So it is one read answering all three. They were always one walk's worth
     * of work: `listSystemReminderTargets` is the walk, and each of these is a
     * filter over its output. Splitting them again would reintroduce both the
     * cost and the drift risk — a second implementation of the id derivation or
     * the window filter would silently drop every affordance the day either
     * changed.
     */
    targets: async (): Promise<SystemReminderTargets> => {
      const targets = await listSystemReminderTargets(systemReminderDeps());

      // ⚠️ `get:gift` exactly, not any `get`. Its sibling `get:card` is a shop
      // trip on the same clock but it is not a *present*, so it has nothing to
      // record against the recipient's gift history. Covers both dated
      // families (a birthday's gift rule and a holiday observance's), since
      // both mint the same action.
      // ⚠️ A relationship is excluded, and not merely for the types' sake: a
      // gift is recorded against whoever received it, and "Harry & Tilly" is not
      // a recipient the gift history can hold. A relationship-borne `get:gift`
      // still shows as a reminder; it just records nothing when ticked.
      const gifts: GiftReminderTarget[] = targets
        .filter((t) => t.action === "get:gift")
        .flatMap((t) =>
          t.bearerType === "relationship"
            ? []
            : [
                {
                  reminderId: t.id,
                  recipientType: t.bearerType,
                  recipientId: t.bearerId,
                },
              ],
        );

      // The offers are what the question can still offer **today**
      // (`planOffers`): the kind's set, pre-ticked from any earlier answer — a
      // question asked again after a partial one shows what was chosen — and
      // filtered to what still fits, so a question answered five days out
      // never offers to post a card. The engine reads the same function to
      // decide whether to ask at all, so the row and this screen cannot
      // disagree about whether there is a question.
      //
      // Two reads per outstanding prompt, its label and its stored rules.
      // There are only ever a handful — a prompt stands for weeks per
      // occasion, once a year at most — so this stays cheap even though the
      // label may be an encrypted read.
      const plans: PlanReminderTarget[] = await Promise.all(
        targets
          .filter((t) => t.action === "plan" && t.milestone !== undefined)
          .map(async (t) => ({
            reminderId: t.id,
            milestoneId: t.milestone!.id,
            milestoneKind: t.milestone!.kind,
            bearerType: t.bearerType,
            bearerId: t.bearerId,
            subject:
              (await milestoneBearerLabel(t.bearerType, t.bearerId)) ?? "",
            // The same two facts the engine's copy layer branches on, so the
            // screen that answers a prompt and the row that sent the user
            // there can never word the question differently.
            ...(await planPhrasing(
              t.bearerType,
              t.bearerId,
              t.milestone!.kind,
            )),
            occurrenceDate: t.occurrenceDate ?? null,
            offers: await (async () => {
              const kind = t.milestone!.kind;
              const { rules } = resolveReminderSchedule(
                kind,
                await reminderRules.listForBearer("milestone", t.milestone!.id),
              );
              // A plan row always carries its occasion; without one there is
              // no distance to filter by, and the whole set is the honest answer.
              return t.occurrenceDate == null
                ? planOffers(kind, rules, Number.POSITIVE_INFINITY)
                : planOffers(
                    kind,
                    rules,
                    daysUntil(todayCivil(), civilFromDueMs(t.occurrenceDate)),
                  );
            })(),
          })),
      );

      // The `wish` rows, with the ways their person can actually be reached —
      // what turns "Wish @Violet a happy birthday" from a note into something
      // you can act on without leaving the screen, and what asks for a way in
      // when there is none.
      //
      // ⚠️ **`wish` only, and people only.** `wish` is the acknowledgment, and
      // the one action whose whole content is *reach them somehow*; a gift or a
      // card is an errand you run in a shop, and buttons to text someone would
      // be noise on it. A pet cannot own a contact method at all
      // (`contactOwnerTypeSchema` is person/household), so a pet's birthday
      // gets neither buttons nor a request for a number the app could not
      // store.
      const wishes = targets.filter(
        (t) => verbOf(t.action) === "wish" && t.bearerType === "person",
      );
      const contacts: ContactReminderTarget[] = await Promise.all(
        wishes.map(async (t) => ({
          reminderId: t.id,
          personId: t.bearerId,
          // `wishes` is filtered to people above, so the bearer is one.
          subject: (await entities.label("person", t.bearerId)) ?? "",
          methods: reachableMethods(
            await listContactMethods(contactMethods, {
              type: "person",
              id: t.bearerId,
            }),
          ),
        })),
      );

      // The partnership questions, paired with the rows they minted. Read from
      // core's own data rather than filtered out of `targets`: these rows have
      // no person/pet bearer, so they carry no engine target — see
      // {@link PartnershipReminderTarget}.
      const partnerships: PartnershipReminderTarget[] = (
        await undatedOwnPartnerships()
      ).map((p) => ({
        reminderId: partnershipNudgeId(p.relationshipId, p.kind),
        relationshipId: p.relationshipId,
        milestoneKind: p.kind,
        partnerId: p.partnerId,
      }));

      // Weddings stored on a person with their other party unknown. No query:
      // a wedding whose bearer is a person *is* unbound, since its preferred
      // bearer is the relationship and "unknown" is the only way it gets here.
      const selfPersonId = (await self.getSelf())?.personId;
      const linkPartners: LinkPartnerReminderTarget[] = targets.flatMap((t) =>
        t.milestone?.kind === "wedding" && t.bearerType === "person"
          ? [
              {
                reminderId: t.id,
                milestoneId: t.milestone.id,
                personId: t.bearerId,
                isSelf: t.bearerId === selfPersonId,
              },
            ]
          : [],
      );

      return { gifts, plans, contacts, partnerships, linkPartners };
    },
  };
}
