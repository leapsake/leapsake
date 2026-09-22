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

/** A reminder as the list reads it: the joined row plus the engine's timing
 *  facts. */
export type ReminderInWindow = ReminderWithTags & ReminderWindowFacts;

/** A `get:gift` reminder paired with its recipient, so a client can link it to
 *  their gifts. */
export interface GiftReminderTarget {
  reminderId: string;
  recipientType: GiftPartyType;
  recipientId: string;
}

/** A `wish` reminder with the ways its person can be reached: buttons when
 *  there are methods, a prompt to add one when there are none. */
export interface ContactReminderTarget {
  /** Not unique: a couple's wish has one target per partner. */
  reminderId: string;
  /** Always a person: a pet owns no contact methods. */
  personId: string;
  /** Their label, for copy that names them (the confirmation before a call). */
  subject: string;
  /** Their reachable methods, postal excluded ({@link reachableMethods}). */
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

/** A wedding reminder with nobody on the other side yet: it knows the date and
 *  wants the couple. An affordance on an existing row, not a row of its own. */
export interface LinkPartnerReminderTarget {
  reminderId: string;
  milestoneId: string;
  personId: string;
  /** Whether it is the user's own wedding — a wording difference only. */
  isSelf: boolean;
}

/** One partnership question on today's list. The row has no person/pet bearer,
 *  so its id is recomputed from the data that minted it. */
export interface PartnershipReminderTarget {
  reminderId: string;
  relationshipId: string;
  /** Which date is missing — and so which kind the form should open on. */
  milestoneKind: "wedding" | "first-date";
  /** The partner, for a client that would rather route via their page. */
  partnerId: string;
}

/** The contact methods offered on a reminder: all but postal, since posting
 *  has its own earlier errand, `send:card`. */
function reachableMethods(methods: ContactMethod[]): ContactMethod[] {
  return methods.filter((entry) => entry.kind !== "postal");
}

/** A `plan` prompt and everything needed to answer it, including the offer set:
 *  an answer writes the full set, unticked actions as disabled rules. */
export interface PlanReminderTarget {
  reminderId: string;
  milestoneId: string;
  /** Named for what it is: a reminder CTA discriminates on `kind`, so the
   *  view-model this feeds keeps the two apart. */
  milestoneKind: MilestoneKind;
  /** Who the occasion belongs to: a person, a pet or a relationship. */
  bearerType: MilestoneBearerType;
  bearerId: string;
  /** That bearer's display label, so the screen can name who it is asking
   *  about. */
  subject: string;
  /** Which `planQuestion` shape the question takes, carried so the row and the
   *  answering screen word it the same. */
  subjectIsSelf: boolean;
  shared: boolean;
  /** The occasion itself, not the row's decide-by `dueDate`, so the screen can
   *  say when the occasion is. */
  occurrenceDate: number | null;
  /** Every action offered, `enabled` carrying which arrive pre-ticked. */
  offers: ReminderRuleInput[];
}

// The `@mention` targets in a reminder's title and body, which the `mentions`
// join is reconciled to on every write.
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
  /** A relationship's display label; `null` means gone. */
  relationshipLabel: (id: string) => Promise<string | null>;
  /** Whether this store has an account, for the account-invitation nudge. */
  hasAccount: () => Promise<boolean>;
  /** Today's holiday-observance candidates. */
  listHolidayCandidates: () => Promise<HolidayOccurrenceCandidate[]>;
}

/** The repo-backed Reminders surface: client reads, writes that keep #tags and
 *  @mentions in step with the text, and the engine's ports over real repos. */
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

  // A reminder's @mention targets, each with the label it goes by now.
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

  /** Whether a milestone is about you: the self-person, or a relationship they
   *  are one end of. */
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

  /** Who a wish on this bearer is for: the person, or a couple's partners but
   *  you. A pet can own no contact method, so it is nobody here. */
  async function wishRecipients(
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<string[]> {
    if (bearerType === "person") return [bearerId];
    if (bearerType !== "relationship") return [];
    const selfId = (await self.getSelf())?.personId;
    return endpointsOf(await relationships.get(bearerId))
      .filter((e) => e.type === "person" && e.id !== selfId)
      .map((e) => e.id);
  }

  /** Any milestone bearer, named. Shared by the engine and `targets`, so a
   *  relationship is named the same in the text and on the answering screen. */
  async function milestoneBearerLabel(
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<string | null> {
    return bearerType === "relationship"
      ? relationshipLabel(bearerId)
      : ((await entities.label(bearerType, bearerId)) ?? null);
  }

  /** The user's own romantic partnerships with no date yet. A date on either
   *  bearer, relationship or partner, counts as known. */
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

  /** Which of `planQuestion`'s three shapes a prompt takes. */
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

  // The engine's ports over the real repos, built per call so `today` is
  // re-read each time.
  const systemReminderDeps = (): ReminderEngineDeps => ({
    milestones: {
      listRemindEligible: () => milestones.listRemindEligible(),
    },
    // Stored rules, else the kind's defaults; the source is what mints a
    // prompt.
    resolveSchedule: async (m) =>
      resolveReminderSchedule(
        m.kind,
        await reminderRules.listForBearer("milestone", m.id),
      ),
    reminders: {
      getIncludingDeleted: (id) => reminders.getIncludingDeleted(id),
      // The engine bypasses `create`, so materialize the title's @mentions
      // here.
      insert: async (row) => {
        const inserted = await reminders.insert(row);
        await mentions.setEntityMentions(
          "reminder",
          inserted.id,
          mentionTargetsOf(inserted),
        );
        return inserted;
      },
      // Re-derive @mentions: a rename changes the name baked into the token.
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
      // Pruning a system reminder clears its mentions too.
      softDelete: async (id) => {
        await reminders.softDelete(id);
        await mentions.removeAllForBearer("reminder", id);
      },
    },
    // `null` means gone, and only gone: the engine skips a row it cannot name.
    resolveLabel: milestoneBearerLabel,
    isSelf: milestoneIsSelf,
    // Borne by the relationship, or by the partner with the relationship only
    // implied. The second is the common one, which is why this is not `isSelf`.
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
      // Borne by you with the other party unknown: still your own occasion.
      if (bearerId === selfId) return true;
      // Read from the bearer's edges: one person has few, "you" may have many.
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
    onboarding: {
      // A pet is never the self-person, so only people are filtered.
      hasAnyEntityBesidesSelf: async () => {
        if ((await pets.list()).length > 0) return true;
        const selfId = (await self.getSelf())?.personId;
        return (await people.list()).some((person) => person.id !== selfId);
      },
      hasSelf: async () => (await self.getSelf()) !== undefined,
      hasAccount: () => deps.hasAccount(),
      // A device's row is written when it is first given a policy or answers
      // the OS prompt, so no rows means nobody has been asked.
      hasNotificationPolicy: async () =>
        (await notificationSettings.list()).length > 0,
    },
    // Always supplied: an omitted port prunes every holiday reminder.
    holidays: {
      listCandidates: () => deps.listHolidayCandidates(),
      // Stored rules, else the observance defaults, as for milestones.
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
    // Always supplied, for the same reason as `holidays`.
    duplicates: { pairKeys: () => duplicates.unresolvedPairKeys() },
    partnerships: { undated: undatedOwnPartnerships },
  });

  const regenerateSystem = (): Promise<{
    created: number;
    updated: number;
    removed: number;
  }> => regenerateSystemReminders(systemReminderDeps());

  /** The notification planner's input: a year of reminders, as bare rows, since
   *  a notification renders plain text. */
  const listNotifiable = (): Promise<Reminder[]> =>
    listNotifiableReminders(systemReminderDeps());

  /**
   * With tags and mentions attached. ⚠️ Statements, not a ternary: Hermes
   * miscompiles a branch holding two `await`s and returns a stray number.
   */
  const withTagsAndMentions = async (
    row: WindowedReminder,
  ): Promise<ReminderInWindow> => {
    if (!row.materialized) return { ...row, tags: [], mentions: [] };
    const rowTags = await tags.listForEntity("reminder", row.id);
    const rowMentions = await resolveMentions(row.id);
    return { ...row, tags: rowTags, mentions: rowMentions };
  };

  /** What the reminder list shows: every reminder inside `DISPLAY_WINDOW_DAYS`.
   *  A preview gets no joins; its title already carries the mention token. */
  const listInWindow = async (): Promise<ReminderInWindow[]> => {
    const rows = await listRemindersInWindow(
      systemReminderDeps(),
      DISPLAY_WINDOW_DAYS,
    );
    return Promise.all(rows.map(withTagsAndMentions));
  };

  /** One reminder as `listInWindow` sees it, for a detail screen. Falls back to
   *  the stored row once the walk no longer wants it. */
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
    // Reads attach what each reminder's #tags and @mentions resolve to now; the
    // text stays the source of truth for which exist.
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
    /** What a device should plan notifications from — a year ahead. */
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
    // The text is the source of truth for #tags and @mentions: every create and
    // update re-parses both from title and body.
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
        // A `system` reminder's text is re-derived on every reconcile, so only
        // user reminders are editable. Completion and deletion stay open.
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
    // Every reminder whose text mentions this entity, system ones included.
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
    /** Reversible completion toggle. A previewed row is minted first, and
     *  completing one early retires it for the year. */
    setCompleted: (
      id: string,
      completed: boolean,
    ): Promise<Reminder | undefined> =>
      // One transaction, or a mint without its completion is pruned again.
      driver.transaction(async () => {
        if (completed && (await reminders.get(id)) === undefined)
          await materializeReminder(systemReminderDeps(), id);
        return reminders.setCompleted(id, completed);
      }),
    // "Remind me in `days` days", checked against `snoozeTargetOf`; a refusal
    // throws, since every offer already passed it. Open on `system` rows.
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
    // Reconcile today's `system` reminders; clients run it at boot and focus.
    regenerateSystem,
    /** Everything today's automated reminders are about, in one walk; each
     *  field is a filter over it. */
    targets: async (): Promise<SystemReminderTargets> => {
      const targets = await listSystemReminderTargets(systemReminderDeps());

      // ⚠️ `get:gift` exactly: a card is not a present. A relationship is no
      // gift recipient, so its `get:gift` records nothing.
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

      // Offers are what the question can still offer today (`planOffers`), the
      // same function the engine asks with, so the row and screen agree.
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
            // The same two facts the engine's copy layer branches on.
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
              // Without an occasion there is no distance, so offer the whole
              // set.
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

      // ⚠️ `wish` only: an errand wants no call buttons. A couple's wish has
      // one entry per partner, in the relationship's own order.
      const contacts: ContactReminderTarget[] = [];
      for (const t of targets.filter((w) => verbOf(w.action) === "wish"))
        for (const personId of await wishRecipients(t.bearerType, t.bearerId))
          contacts.push({
            reminderId: t.id,
            personId,
            subject: (await entities.label("person", personId)) ?? "",
            methods: reachableMethods(
              await listContactMethods(contactMethods, {
                type: "person",
                id: personId,
              }),
            ),
          });

      // Read from the data, not `targets`: these rows carry no engine target.
      const partnerships: PartnershipReminderTarget[] = (
        await undatedOwnPartnerships()
      ).map((p) => ({
        reminderId: partnershipNudgeId(p.relationshipId, p.kind),
        relationshipId: p.relationshipId,
        milestoneKind: p.kind,
        partnerId: p.partnerId,
      }));

      // Weddings on a person: the other party is unknown, since a bound wedding
      // lives on the relationship.
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
