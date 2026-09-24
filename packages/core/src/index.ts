import {
  type DuplicateCandidate,
  type GenderResult,
  type RelationshipService,
  type SqliteDriver,
  type TagListItem,
  createContactMethodsRepo,
  createDeviceContactLinksRepo,
  createDismissalsRepo,
  createDuplicateService,
  createEntityService,
  createHiddenHolidaysRepo,
  createHolidaysRepo,
  createKinshipService,
  createMentionsRepo,
  createObservancesRepo,
  createMilestonesRepo,
  createNotADuplicateRepo,
  createNotificationSettingsRepo,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipService,
  createRelationshipsRepo,
  createGiftIdeasRepo,
  createGiftRecipientsRepo,
  createReminderRulesRepo,
  createRemindersRepo,
  createSearchService,
  createSelfPersonRepo,
  createSyncStateRepo,
  createTagsRepo,
  listContactMethods,
  listTimelineForEntity,
  promotes,
  runMigrations,
} from "@leapsake/data";
import type {
  ContactMethod,
  ContactOwnerType,
  CreateEmailInput,
  CreateMilestoneInput,
  CreatePersonInput,
  CreatePetInput,
  CreatePhoneInput,
  CreatePostalInput,
  CreateSocialInput,
  CreateRelationshipInput,
  EmailAddress,
  EntityType,
  Milestone,
  MilestoneBearerType,
  MilestoneTimelineEntry,
  Person,
  Pet,
  PhoneNumber,
  PostalAddress,
  SocialProfile,
  MilestoneKind,
  NotificationMode,
  NotificationSettings,
  ObservanceBearerType,
  Relationship,
  RelationshipNeighbor,
  RelationshipRole,
  Reminder,
  ReminderRuleInput,
  SearchHit,
  SelfPerson,
  GiftIdea,
  Tag,
  UpdateEmailInput,
  UpdateMilestoneInput,
  UpdatePersonInput,
  UpdatePetInput,
  UpdatePhoneInput,
  UpdatePostalInput,
  UpdateSocialInput,
  UpdateRelationshipInput,
} from "@leapsake/schema";
import {
  isPublished,
  isRomanticRole,
  kindDefs,
  resolveReminderSchedule,
  todayCivil,
} from "@leapsake/schema";
import { duplicatesReminderId } from "@leapsake/reminders";
import { createRemindersApi } from "@leapsake/reminders/api";
// Re-exported so a client can map a Home reminder's id to its CTA route
// without depending on `@leapsake/reminders` directly.
export { ONBOARDING_REMINDERS, onboardingRouteOf } from "@leapsake/reminders";
export type { OnboardingReminder, OnboardingRoute } from "@leapsake/reminders";

// The reminder shapes a client types its screens against.
export type {
  ContactReminderTarget,
  GiftReminderTarget,
  LinkPartnerReminderTarget,
  PartnershipReminderTarget,
  PlanReminderTarget,
  ReminderInWindow,
  SystemReminderTargets,
} from "@leapsake/reminders/api";
import {
  type ExportArchive,
  type ExportPorts,
  buildArchive,
} from "@leapsake/export";
import { getSyncStatus } from "@leapsake/key-custody";
import {
  type ObserverDecision,
  createHolidaysApi,
  holidayReminderCandidates,
} from "@leapsake/holidays";
import { createGiftsApi } from "@leapsake/gifts";
import { createImportApi } from "@leapsake/contact-import";
import { createViews } from "./views.js";

// Re-exported so apps can wire everything from one entry point: construct a
// concrete SqliteDriver, run migrations, then build the core.
export { runMigrations, type SqliteDriver, type GenderResult };

// Duplicate-detection results, so every client renders candidates against one
// contract.
export type {
  DuplicateCandidate,
  DuplicateCandidatePerson,
  DuplicateMatch,
} from "@leapsake/data";

// The tag catalog's row shape, re-exported so a client's tag list binds to the
// same contract `tags.list` returns.
export type { TagListItem } from "@leapsake/data";

// The gift shapes a client types its screens against.
export type {
  GiftForIdea,
  GiftForRecipient,
  GiftIdeaOverview,
} from "@leapsake/gifts";

// Contact-import shapes, re-exported so the desktop boundary parser and the
// review UI bind to the same contract the ingest engine consumes.
export type {
  ImportDecision,
  ImportError,
  ImportResult,
  ParsedContact,
} from "@leapsake/vcard";
export type { AlreadyStored } from "@leapsake/contact-import";

// What an export run produced, re-exported so a client can type the bytes it
// writes and the counts it shows without depending on `@leapsake/export`.
export type { ExportArchive } from "@leapsake/export";
// The archive's `data.json` shape, for a client or test that reads one back.
export { exportDataSchema } from "@leapsake/export";
export type { ExportData } from "@leapsake/export";

// The local-notification policy row shape, re-exported so the settings UI can
// type what `notificationSettings` reads and writes.
export type { NotificationMode, NotificationSettings } from "@leapsake/schema";

// Key custody: the device master key, the password and recovery doors, and
// `lockThisDevice` (sign out).
export {
  ensureDeviceMasterKey,
  ensureLocalDeviceId,
  createLocalAccount,
  bindRelayToAccount,
  sealPasswordDoor,
  enableSync,
  joinAccount,
  recoverAccount,
  reauthenticate,
  unlockWithPassword,
  unlockWithRecoveryKey,
  getSyncStatus,
  clearLocalAccount,
  lockThisDevice,
  STORE_DOOR_SECRET_IDS,
  KEYSTORE_SECRET_IDS,
  MIN_PASSWORD_LENGTH,
  adoptAccountMasterKey,
  adoptRecoveryKey,
  rotateRecoveryPhrase,
  establishKeySession,
  resyncAfterMasterKeyRepair,
  unlockStore,
  type BootKeySession,
  type AdoptionDoor,
  type RecoveryDoorWriter,
  type KeySession,
  type UnlockedMasterKey,
  type SyncStatus,
  type AccountBootstrap,
  type AccountBootstrapChannel,
  type RecoveryChannel,
  type StoreDoorSidecars,
  type UnlockAnswer,
  type UnlockRequest,
} from "@leapsake/key-custody";

// The syncable allowlist plus a one-call cycle for an enabled account, so each
// client drives sync the same way.
export { syncableRepos } from "./sync.js";
export {
  createAccountSyncEngine,
  lookupAccount,
  lookupAccountId,
  registerAccountWithRelay,
  joinAccountViaRelay,
  recoverAccountViaRelay,
  reauthenticateViaRelay,
  isRelayAuthError,
  isUsernameTakenError,
  runAccountSync,
  rotateRecoveryPhraseForAccount,
  flushPendingRecoveryEscrow,
  convergeRecoveryKey,
  reconcileOnJoin,
  selectJoinDuplicates,
  getAutoSync,
  setAutoSync,
  type JoinReconcileResult,
  type PasswordDoorWriter,
} from "@leapsake/sync";

// The bundled holiday catalog's seed, applied at store open once per bundle
// version, and the holidays API.
export { seedHolidayCatalog, createHolidaysApi } from "@leapsake/holidays";
export type {
  BearerHolidayCandidate,
  HolidayDetail,
  HolidayListItem,
  HolidayObserverCandidate,
  HolidaysApiDeps,
  ObserverDecision,
} from "@leapsake/holidays";

// Background sync: a debounced, single-flight scheduler and a CoreApi wrapper
// that kicks a sync after every local write. Clients wire focus/foreground in.
export {
  createSyncScheduler,
  withSyncKick,
  SYNC_INTERVAL_MS,
  SYNC_KICK_DEBOUNCE_MS,
  type SyncScheduler,
} from "@leapsake/sync";

// Whether the relay claims a durable copy of the account's data, which words
// the "Forget account" warning. Silence means "no copy".
export {
  fetchRelayCapabilities,
  NO_DURABLE_BACKUP,
  type RelayCapabilities,
} from "@leapsake/sync";

// The view-model contracts the `views` builders return, re-exported so every
// client renders against the same shapes carried out via `CoreApi`.
export type {
  EntityRow,
  EntityRef,
  RelationshipCandidate,
  MilestoneBearer,
  RelationshipViewPartner,
  RelationshipPartner,
  PersonView,
  PetView,
  RelationshipNewView,
  RelationshipView,
  RelationshipPartnersView,
  RelationshipForSubjectView,
  DerivedRelationshipView,
  MilestoneNewView,
} from "./views.js";

/** The client-agnostic application surface every client wires against. */
export type CoreApi = ReturnType<typeof createCore>;

/**
 * Wire the repositories over a {@link SqliteDriver} into a {@link CoreApi}; run
 * {@link runMigrations} on it first. Trust boundaries parse before calling in.
 */
/** Who a person's milestone is with, for `milestones.linkPartner`. */
export interface PartnerLink {
  milestoneId: string;
  personId: string;
  partner: { personId: string } | { name: string };
  reminderSchedule?: ReminderRuleInput[];
}

/** The role a new partner is recorded in, by the occasion that named them. */
const PARTNER_ROLE: Partial<Record<MilestoneKind, RelationshipRole>> = {
  wedding: "spouse",
  "first-date": "partner",
};

export function createCore(driver: SqliteDriver) {
  const people = createPeopleRepo(driver);
  const pets = createPetsRepo(driver);
  const tags = createTagsRepo(driver);
  const relationships = createRelationshipsRepo(driver);
  const dismissals = createDismissalsRepo(driver);
  const notADuplicate = createNotADuplicateRepo(driver);
  const milestones = createMilestonesRepo(driver);
  const reminderRules = createReminderRulesRepo(driver);
  const reminders = createRemindersRepo(driver);
  const self = createSelfPersonRepo(driver);
  // Both device-local: which phone contacts this device has brought in, and
  // whether it keeps doing so (`deviceContacts` below).
  const deviceContactLinks = createDeviceContactLinksRepo(driver);
  const deviceContactsState = createSyncStateRepo(driver);
  const notificationSettings = createNotificationSettingsRepo(driver);
  const giftIdeas = createGiftIdeasRepo(driver);
  const giftRecipients = createGiftRecipientsRepo(driver);
  const mentions = createMentionsRepo(driver);
  const holidays = createHolidaysRepo(driver);
  const observances = createObservancesRepo(driver);
  const hiddenHolidays = createHiddenHolidaysRepo(driver);
  const holidaysApi = createHolidaysApi({
    holidays,
    observances,
    hiddenHolidays,
    people,
    pets,
    reminderRules,
    driver,
  });

  const contactMethods = createContactMethodsRepo(driver);
  const kinship = createKinshipService(driver, {
    people,
    pets,
    relationships,
    dismissals,
  });
  const search = createSearchService(driver);
  const duplicates = createDuplicateService(driver, { notADuplicate });
  const entities = createEntityService({
    people,
    pets,
    tags,
    relationships,
    dismissals,
    milestones,
    contactMethods,
    observances,
    giftRecipients,
    notADuplicate,
    driver,
  });
  const relationshipsSvc = createRelationshipService({
    people,
    pets,
    relationships,
    self,
    entities,
    driver,
  });
  const importApi = createImportApi({
    people,
    pets,
    tags,
    milestones,
    relationships,
    contactMethods,
    self,
    deviceContactLinks,
    entities,
    duplicates,
    driver,
    regenerateSystem: () => regenerateSystem(),
  });
  const giftsApi = createGiftsApi({
    giftIdeas,
    giftRecipients,
    tags,
    entities,
    driver,
  });
  const remindersApi = createRemindersApi({
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
    relationshipLabel: (id: string) => relationshipsSvc.label(id),
    // The two ports `@leapsake/reminders` cannot reach for itself: the account
    // question lives in key-custody, and holidays already depends on reminders.
    hasAccount: async () => (await getSyncStatus({ driver })).hasAccount,
    listHolidayCandidates: () =>
      holidayReminderCandidates({
        holidays,
        observances,
        hiddenHolidays,
        reminderRules,
        today: todayCivil(),
      }),
  });
  // A couple's occasion on your partner was with you, so it is linked before
  // any reconcile rather than asked about.
  const regenerateSystem = async () => {
    await linkOwnCoupledOccasions();
    return remindersApi.regenerateSystem();
  };

  /** Moves a milestone held by one person onto their relationship with a
   *  partner, absorbing same-day copies there or on the partner. */
  async function moveOntoPartnership(input: PartnerLink): Promise<void> {
    const { milestoneId, personId, partner, reminderSchedule } = input;
    const linked = (await milestones.listForBearer("person", personId)).find(
      (m) => m.id === milestoneId,
    );
    if (linked === undefined) return;
    const role = PARTNER_ROLE[linked.kind] ?? "spouse";
    // The partner first, in its own transaction: a failed move leaves a true
    // relationship behind, which the retry finds and reuses.
    const relationshipId =
      "name" in partner
        ? (
            await relationshipsSvc.createWithNewOther({
              subjectType: "person",
              subjectId: personId,
              otherType: "person",
              otherName: partner.name,
              otherRole: role,
            })
          ).relationship.id
        : await partnerEdge(personId, partner.personId, role);
    await driver.transaction(async () => {
      const candidates = await milestones.listForBearer(
        "relationship",
        relationshipId,
      );
      if ("personId" in partner)
        candidates.push(
          ...(await milestones.listForBearer("person", partner.personId)),
        );
      const copies = sameDayCopies(linked, candidates);
      const year =
        linked.year ?? copies.find((c) => c.year !== null)?.year ?? null;
      await milestones.update(milestoneId, {
        bearerType: "relationship",
        bearerId: relationshipId,
        ...(year === null ? {} : { year }),
      });
      for (const copy of copies) {
        await milestones.softDelete(copy.id);
        await reminderRules.removeAllForBearer("milestone", copy.id);
      }
      if (reminderSchedule !== undefined)
        await reminderRules.replaceForBearer(
          "milestone",
          milestoneId,
          reminderSchedule,
        );
    });
  }

  /** Links every couple's occasion held by the user's romantic partner to
   *  their relationship. */
  async function linkOwnCoupledOccasions(): Promise<void> {
    const selfId = (await self.getSelf())?.personId;
    if (selfId === undefined) return;
    for (const m of await milestones.listRemindEligible()) {
      if (kindDefs[m.kind].coupled !== true || m.bearerType !== "person")
        continue;
      if (m.bearerId === selfId) continue;
      const romantic = (
        await relationshipsSvc.orientedNeighbors("person", m.bearerId)
      ).some(
        (n) =>
          n.origin === "explicit" &&
          n.otherType === "person" &&
          n.otherId === selfId &&
          isRomanticRole(n.otherRole),
      );
      if (romantic)
        await moveOntoPartnership({
          milestoneId: m.id,
          personId: m.bearerId,
          partner: { personId: selfId },
        });
    }
  }

  /** The occasions among `others` that are `milestone` recorded again: same
   *  kind, month and day. The partner's own card often carries it. */
  function sameDayCopies(milestone: Milestone, others: Milestone[]) {
    if (milestone.month === null || milestone.day === null) return [];
    return others.filter(
      (m) =>
        m.id !== milestone.id &&
        m.kind === milestone.kind &&
        m.month === milestone.month &&
        m.day === milestone.day,
    );
  }

  /** The edge between two people a shared milestone belongs on: a romantic one
   *  if there is one, else any, else a new one in `role`. */
  async function partnerEdge(
    personId: string,
    otherId: string,
    role: RelationshipRole,
  ) {
    const edges = (
      await relationshipsSvc.orientedNeighbors("person", personId)
    ).filter(
      (n) =>
        n.origin === "explicit" &&
        n.otherType === "person" &&
        n.otherId === otherId,
    );
    const found = edges.find((n) => isRomanticRole(n.otherRole)) ?? edges[0];
    if (found !== undefined) return found.relationshipId;
    const created = await relationshipsSvc.createFromSubject({
      subjectType: "person",
      subjectId: personId,
      otherType: "person",
      otherId,
      otherRole: role,
    });
    return created.id;
  }

  const views = createViews({
    people: { list: () => people.list(), get: (id) => people.get(id) },
    pets: { list: () => pets.list(), get: (id) => pets.get(id) },
    listTags: (type, id) => tags.listForEntity(type, id),
    getRelationship: (id) => relationships.get(id),
    listMilestones: (type, id) => milestones.listForBearer(type, id),
    orientedNeighbors: (type, id) =>
      relationshipsSvc.orientedNeighbors(type, id),
    neighborsFor: (type, id) => kinship.neighborsFor(type, id),
    genderFor: (type, id) => kinship.genderFor(type, id),
    timelineFor: (type, id) =>
      listTimelineForEntity(
        milestones,
        relationships,
        entities.label,
        type,
        id,
      ),
    listContactMethods: (type, id) =>
      listContactMethods(contactMethods, { type, id }),
    resolveLabel: entities.label,
  });

  return {
    people: {
      list: (): Promise<Person[]> => people.list(),
      get: (id: string): Promise<Person | undefined> => people.get(id),
      // A Person's write and its tag changes commit in one transaction, so a
      // partial failure rolls back both.
      create: async (
        input: CreatePersonInput,
        tagNames: string[],
      ): Promise<Person> => {
        const person = await driver.transaction(async () => {
          const created = await people.create(input);
          await tags.setEntityTags("person", created.id, tagNames);
          return created;
        });
        // `hasAnyEntity` just flipped, so the onboarding nudge retires now
        // rather than at the next boot/focus.
        await regenerateSystem();
        return person;
      },
      update: async (
        id: string,
        input: UpdatePersonInput,
        tagNames: string[],
      ): Promise<Person | undefined> => {
        const person = await driver.transaction(async () => {
          const updated = await people.update(id, input);
          if (updated) {
            await tags.setEntityTags("person", id, tagNames);
            if (
              promotes(input, ["firstName", "middleName", "lastName"], tagNames)
            ) {
              await entities.publishIfUnpublished("person", id);
            }
          }
          return updated;
        });
        // A rename can create or dissolve a duplicate pair. Contact-method
        // edits can too, but those wait for the boot/focus reconcile.
        await regenerateSystem();
        return person;
      },
      // Reconcile so the cascade's orphaned birthday reminder goes at once.
      softDelete: async (id: string): Promise<void> => {
        await driver.transaction(() =>
          entities.softDeleteCascade("person", id),
        );
        await regenerateSystem();
      },
      // Reconcile so the loser's birthday reminder re-titles onto the survivor
      // and re-points its @mention.
      merge: async (survivorId: string, loserId: string): Promise<void> => {
        await entities.mergePeople(survivorId, loserId);
        await regenerateSystem();
      },
    },

    pets: {
      list: (): Promise<Pet[]> => pets.list(),
      get: (id: string): Promise<Pet | undefined> => pets.get(id),
      create: async (
        input: CreatePetInput,
        tagNames: string[],
      ): Promise<Pet> => {
        const pet = await driver.transaction(async () => {
          const created = await pets.create(input);
          await tags.setEntityTags("pet", created.id, tagNames);
          return created;
        });
        // A pet also satisfies `hasAnyEntity`; see `people.create`.
        await regenerateSystem();
        return pet;
      },
      update: (
        id: string,
        input: UpdatePetInput,
        tagNames: string[],
      ): Promise<Pet | undefined> =>
        driver.transaction(async () => {
          const pet = await pets.update(id, input);
          if (pet) {
            await tags.setEntityTags("pet", id, tagNames);
            if (promotes(input, ["name"], tagNames)) {
              await entities.publishIfUnpublished("pet", id);
            }
          }
          return pet;
        }),
      // Reconcile so the cascade's orphaned birthday reminder goes at once.
      softDelete: async (id: string): Promise<void> => {
        await driver.transaction(() => entities.softDeleteCascade("pet", id));
        await regenerateSystem();
      },
    },

    tags: {
      // Every tag with its usage count: "what tags exist at all", which no
      // per-entity read can reconstruct.
      list: (): Promise<TagListItem[]> => tags.list(),
      get: (id: string): Promise<Tag | undefined> => tags.get(id),
      softDelete: (id: string): Promise<void> =>
        driver.transaction(() => tags.softDelete(id)),
      listForPerson: (personId: string): Promise<Tag[]> =>
        tags.listForEntity("person", personId),
      listForPet: (petId: string): Promise<Tag[]> =>
        tags.listForEntity("pet", petId),
      listForGiftIdea: (ideaId: string): Promise<Tag[]> =>
        tags.listForEntity("gift_idea", ideaId),
      peopleForTag: async (tagId: string): Promise<Person[]> => {
        const ids = await tags.entityIdsForTag(tagId, "person");
        const found = await Promise.all(ids.map((id) => people.get(id)));
        return found.filter((p): p is Person => p !== undefined);
      },
      petsForTag: async (tagId: string): Promise<Pet[]> => {
        const ids = await tags.entityIdsForTag(tagId, "pet");
        const found = await Promise.all(ids.map((id) => pets.get(id)));
        return found.filter((p): p is Pet => p !== undefined);
      },
      // Reminders carry tags too (parsed from their text, bearer type
      // "reminder"), so they list on a tag's page alongside people and pets.
      remindersForTag: async (tagId: string): Promise<Reminder[]> => {
        const ids = await tags.entityIdsForTag(tagId, "reminder");
        const found = await Promise.all(ids.map((id) => reminders.get(id)));
        return found.filter((r): r is Reminder => r !== undefined);
      },
      // As do gift ideas — a "#books" or "#kitchen" tag is how an idea list
      // stays browsable once it's long.
      giftIdeasForTag: async (tagId: string): Promise<GiftIdea[]> => {
        const ids = await tags.entityIdsForTag(tagId, "gift_idea");
        const found = await Promise.all(ids.map((id) => giftIdeas.get(id)));
        return found.filter((i): i is GiftIdea => i !== undefined);
      },
    },

    // The catalog is read-only; the levers are who observes, what each
    // observance reminds about, and whether a holiday is hidden.
    holidays: {
      ...holidaysApi,
      setObservers: async (
        holidayId: string,
        decisions: readonly ObserverDecision[],
      ): Promise<void> => {
        await holidaysApi.setObservers(holidayId, decisions);
        // Only the bearers being *given* the observance promote; clearing one
        // says nothing new about anybody.
        for (const decision of decisions) {
          if (!decision.observes) continue;
          await entities.publishBearerIfUnpublished(
            decision.bearerType,
            decision.bearerId,
          );
        }
        await regenerateSystem();
      },
      setHidden: async (holidayId: string, hidden: boolean): Promise<void> => {
        await holidaysApi.setHidden(holidayId, hidden);
        await regenerateSystem();
      },
      setObservanceSchedule: async (
        holidayId: string,
        bearerType: ObservanceBearerType,
        bearerId: string,
        rules: ReminderRuleInput[],
      ): Promise<void> => {
        await holidaysApi.setObservanceSchedule(
          holidayId,
          bearerType,
          bearerId,
          rules,
        );
        await regenerateSystem();
      },
    },

    relationships: {
      get: (id: string): Promise<Relationship | undefined> =>
        relationships.get(id),
      // A spouse raises "when is your anniversary?", a role change changes
      // which date it asks for, and deleting the edge retires it.
      create: async (input: CreateRelationshipInput): Promise<Relationship> => {
        const created = await driver.transaction(() =>
          relationships.create(input),
        );
        await regenerateSystem();
        return created;
      },
      update: async (
        id: string,
        input: UpdateRelationshipInput,
      ): Promise<Relationship | undefined> => {
        const updated = await driver.transaction(() =>
          relationships.update(id, input),
        );
        await regenerateSystem();
        return updated;
      },
      // An unpublished end goes with the edge, its only reason to exist; two
      // published people are just unlinked.
      softDelete: async (id: string): Promise<void> => {
        await driver.transaction(async () => {
          const rel = await relationships.get(id);
          await relationships.softDelete(id);
          if (rel === undefined) return;
          for (const end of [
            { type: rel.aType, id: rel.aId },
            { type: rel.bType, id: rel.bId },
          ]) {
            const entity = await entities.resolve(end.type, end.id);
            if (entity === undefined || isPublished(entity.standing)) continue;
            await entities.softDelete(end.type, end.id);
            await entities.removeFacts(end.type, end.id);
          }
        });
        await regenerateSystem();
      },
      // Orient each stored row to the subject and resolve the *other* end's
      // label + role, so the caller never sees the raw a/b endpoints.
      listForEntity: (
        type: EntityType,
        id: string,
      ): Promise<RelationshipNeighbor[]> =>
        relationshipsSvc.orientedNeighbors(type, id),
      // Reconciled here, not in the service, because the milestone "with whom?"
      // flow calls these mid-write and reconciles once after its own commit.
      createFromSubject: async (
        ...args: Parameters<RelationshipService["createFromSubject"]>
      ): Promise<Relationship> => {
        const created = await relationshipsSvc.createFromSubject(...args);
        await regenerateSystem();
        return created;
      },
      // The same, for an other end that doesn't exist yet: creates them
      // unpublished alongside the edge.
      createWithNewOther: async (
        ...args: Parameters<RelationshipService["createWithNewOther"]>
      ): Promise<{ other: Person | Pet; relationship: Relationship }> => {
        const created = await relationshipsSvc.createWithNewOther(...args);
        await regenerateSystem();
        return created;
      },
      // Edit a subject-scoped relationship, re-deriving the subject's own role.
      editFromSubject: async (
        ...args: Parameters<RelationshipService["editFromSubject"]>
      ): Promise<Relationship | undefined> => {
        const updated = await relationshipsSvc.editFromSubject(...args);
        await regenerateSystem();
        return updated;
      },
    },

    milestones: {
      listForBearer: (
        type: MilestoneBearerType,
        id: string,
      ): Promise<Milestone[]> => milestones.listForBearer(type, id),
      // Own milestones merged with those of each relationship the entity is in,
      // annotated with the partner's label.
      timelineFor: (
        type: EntityType,
        id: string,
      ): Promise<MilestoneTimelineEntry[]> =>
        listTimelineForEntity(
          milestones,
          relationships,
          entities.label,
          type,
          id,
        ),
      // The stored rules if customised, else the kind's defaults. A new
      // milestone takes the kind's defaults directly, so create needs no read.
      reminderSchedule: async (
        milestoneId: string,
        kind: MilestoneKind,
      ): Promise<ReminderRuleInput[]> => {
        const stored = await reminderRules.listForBearer(
          "milestone",
          milestoneId,
        );
        // The editor renders rules; which level supplied them is the engine's
        // business, so this keeps its narrower shape.
        return resolveReminderSchedule(kind, stored).rules;
      },
      // Milestone and schedule commit together. A sent `reminderSchedule`
      // replaces the whole rule set; an omitted one leaves it as it is.
      create: async (input: CreateMilestoneInput): Promise<Milestone> => {
        const { reminderSchedule, ...milestoneInput } = input;
        const milestone = await driver.transaction(async () => {
          const created = await milestones.create(milestoneInput);
          if (reminderSchedule !== undefined) {
            await reminderRules.replaceForBearer(
              "milestone",
              created.id,
              reminderSchedule,
            );
          }
          // A birthday is the likeliest first thing anyone records about a
          // person they had only named, and it is a fact of that person's own.
          await entities.publishBearerIfUnpublished(
            milestoneInput.bearerType,
            milestoneInput.bearerId,
          );
          return created;
        });
        await regenerateSystem();
        return milestone;
      },
      update: async (
        id: string,
        input: UpdateMilestoneInput,
      ): Promise<Milestone | undefined> => {
        const { reminderSchedule, ...milestoneInput } = input;
        const milestone = await driver.transaction(async () => {
          const updated = await milestones.update(id, milestoneInput);
          // Only touch rules for a milestone that still exists (update returns
          // undefined for a gone/tombstoned row).
          if (updated !== undefined && reminderSchedule !== undefined) {
            await reminderRules.replaceForBearer(
              "milestone",
              id,
              reminderSchedule,
            );
          }
          return updated;
        });
        await regenerateSystem();
        return milestone;
      },
      // Move a person's milestone onto their relationship with a partner.
      linkPartner: async (input: PartnerLink): Promise<void> => {
        await moveOntoPartnership(input);
        await regenerateSystem();
      },
      softDelete: async (id: string): Promise<void> => {
        await driver.transaction(async () => {
          await milestones.softDelete(id);
          // Drop the milestone's reminder rules with it — nothing references a
          // deleted milestone's schedule.
          await reminderRules.removeAllForBearer("milestone", id);
        });
        await regenerateSystem();
      },
    },

    import: importApi,

    gifts: giftsApi,

    reminders: { ...remindersApi, regenerateSystem },

    // Who "you" are: a pointer at a Person. Reconciling flips your own
    // birthday's reminder to its self-directed copy at once.
    self: {
      get: (): Promise<SelfPerson | undefined> => self.getSelf(),
      set: async (personId: string): Promise<SelfPerson> => {
        const row = await self.setSelf(personId);
        await regenerateSystem();
        return row;
      },
      clear: async (): Promise<void> => {
        await self.clearSelf();
        await regenerateSystem();
      },
    },

    // Per-device notification policy. Every method takes an explicit deviceId,
    // so a settings UI can read or edit any device's row.
    notificationSettings: {
      get: (deviceId: string): Promise<NotificationSettings | undefined> =>
        notificationSettings.get(deviceId),
      list: (): Promise<NotificationSettings[]> => notificationSettings.list(),
      setPolicy: (
        deviceId: string,
        patch: Partial<{
          mode: NotificationMode;
          deliveryMinute: number;
          label: string | null;
          platform: string | null;
        }>,
      ): Promise<NotificationSettings> =>
        notificationSettings.setPolicy(deviceId, patch),
      setPermissionState: (
        deviceId: string,
        state: string | null,
      ): Promise<NotificationSettings> =>
        notificationSettings.setPermissionState(deviceId, state),
    },

    contactMethods: {
      // Merged read fans out across the four typed tables; writes target one
      // typed sub-repo each.
      listForOwner: (
        type: ContactOwnerType,
        id: string,
      ): Promise<ContactMethod[]> =>
        listContactMethods(contactMethods, { type, id }),
      // `create` publishes an unpublished owner: a contact method is a fact
      // about that person, not about whoever they are attached to.
      emails: {
        create: (input: CreateEmailInput): Promise<EmailAddress> =>
          driver.transaction(async () => {
            const created = await contactMethods.emails.create(input);
            await entities.publishBearerIfUnpublished(
              input.ownerType,
              input.ownerId,
            );
            return created;
          }),
        update: (
          id: string,
          input: UpdateEmailInput,
        ): Promise<EmailAddress | undefined> =>
          driver.transaction(() => contactMethods.emails.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => contactMethods.emails.softDelete(id)),
      },
      phones: {
        create: (input: CreatePhoneInput): Promise<PhoneNumber> =>
          driver.transaction(async () => {
            const created = await contactMethods.phones.create(input);
            await entities.publishBearerIfUnpublished(
              input.ownerType,
              input.ownerId,
            );
            return created;
          }),
        update: (
          id: string,
          input: UpdatePhoneInput,
        ): Promise<PhoneNumber | undefined> =>
          driver.transaction(() => contactMethods.phones.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => contactMethods.phones.softDelete(id)),
      },
      postals: {
        create: (input: CreatePostalInput): Promise<PostalAddress> =>
          driver.transaction(async () => {
            const created = await contactMethods.postals.create(input);
            await entities.publishBearerIfUnpublished(
              input.ownerType,
              input.ownerId,
            );
            return created;
          }),
        update: (
          id: string,
          input: UpdatePostalInput,
        ): Promise<PostalAddress | undefined> =>
          driver.transaction(() => contactMethods.postals.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => contactMethods.postals.softDelete(id)),
      },
      socials: {
        create: (input: CreateSocialInput): Promise<SocialProfile> =>
          driver.transaction(async () => {
            const created = await contactMethods.socials.create(input);
            await entities.publishBearerIfUnpublished(
              input.ownerType,
              input.ownerId,
            );
            return created;
          }),
        update: (
          id: string,
          input: UpdateSocialInput,
        ): Promise<SocialProfile | undefined> =>
          driver.transaction(() => contactMethods.socials.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => contactMethods.socials.softDelete(id)),
      },
    },

    kinship: {
      neighborsFor: (
        type: EntityType,
        id: string,
      ): Promise<RelationshipNeighbor[]> => kinship.neighborsFor(type, id),
      genderFor: (type: EntityType, id: string): Promise<GenderResult> =>
        kinship.genderFor(type, id),
      dismiss: (
        subjectType: EntityType,
        subjectId: string,
        otherType: EntityType,
        otherId: string,
        role: RelationshipRole | null,
      ): Promise<void> =>
        driver.transaction(async () => {
          await dismissals.create(
            { type: subjectType, id: subjectId },
            { type: otherType, id: otherId },
            role,
          );
        }),
      undismiss: (id: string): Promise<void> =>
        driver.transaction(() => dismissals.softDelete(id)),
    },

    search: {
      query: (term: string): Promise<SearchHit[]> => search.query(term),
    },

    // Detection and the "not a duplicate" memory, which syncs; the merge itself
    // is `people.merge`.
    duplicates: {
      findCandidates: duplicates.unresolvedCandidates,
      /**
       * The candidates involving one person. A filter over the full scan, so
       * the `not_a_duplicate` memory and tier/sort rules stay in one place.
       */
      findFor: async (personId: string): Promise<DuplicateCandidate[]> =>
        (await duplicates.unresolvedCandidates()).filter(
          (c) => c.a.id === personId || c.b.id === personId,
        ),
      /** How many pairs are outstanding — the count the clients gate their
       *  "N possible duplicates" links on, without shipping the whole list. */
      count: async (): Promise<number> =>
        (await duplicates.unresolvedCandidates()).length,
      /**
       * The Home nudge's id for today's outstanding pairs, or `null` if none.
       * Recomputed, because the nudge is content-addressed on the pair set.
       */
      nudgeId: async (): Promise<string | null> => {
        const keys = await duplicates.unresolvedPairKeys();
        return keys.length === 0 ? null : duplicatesReminderId(keys);
      },
      reject: async (idA: string, idB: string): Promise<void> => {
        await driver.transaction(() => notADuplicate.record(idA, idB));
        // The rejected pair leaves the candidate set, so the Home nudge's
        // content-addressed id changes (or the nudge goes away entirely).
        await regenerateSystem();
      },
    },

    /** The whole store as one archive; see `@leapsake/export`'s README. */
    export: {
      archive: (opts: { appVersion: string }): Promise<ExportArchive> => {
        const ports: ExportPorts = {
          listPeople: () => people.list(),
          listPets: () => pets.list(),
          contactMethodsFor: (personId) =>
            listContactMethods(contactMethods, {
              type: "person",
              id: personId,
            }),
          milestonesFor: (bearerType, bearerId) =>
            milestones.listForBearer(bearerType, bearerId),
          tagsFor: (type, id) => tags.listForEntity(type, id),
          // Stored edges only: kinship's derived ones must never be exported.
          neighborsFor: (type, id) =>
            relationshipsSvc.orientedNeighbors(type, id),
          selfPersonId: async () => (await self.getSelf())?.personId ?? null,
          data: {
            listReminders: () => reminders.list(),
            listReminderRules: () => reminderRules.list(),
            listGiftIdeas: () => giftIdeas.list(),
            listGiftRecipients: () => giftRecipients.list(),
            listHolidays: () => holidays.list(),
            listObservances: () => observances.list(),
            listHiddenHolidays: () => hiddenHolidays.list(),
            listNotificationSettings: () => notificationSettings.list(),
            // No entity repo, so `listActive()`; never `listChangedSince(0)`,
            // which carries tombstones.
            listMentions: () => mentions.listActive(),
            listNotADuplicate: () => notADuplicate.listActive(),
            listRelationshipDismissals: () => dismissals.listActive(),
          },
        };
        return buildArchive(ports, {
          appVersion: opts.appVersion,
          now: new Date(),
        });
      },
    },

    // Device-local bookkeeping for keeping People in step with the phone's
    // address book; the import itself is `import.commit` with a `sourceId`.
    deviceContacts: {
      /** Every address-book id this device has already seen — including those
       *  whose person was since deleted, which is what keeps them deleted. */
      linkedIds: (): Promise<string[]> => deviceContactLinks.listContactIds(),
      /** Whether new phone contacts come in at boot and on foreground. */
      getSyncEnabled: (): Promise<boolean> =>
        deviceContactsState.getDeviceContactsSync(),
      setSyncEnabled: (enabled: boolean): Promise<void> =>
        deviceContactsState.setDeviceContactsSync(enabled),
    },

    // Read-and-compose view-model builders that return plain data.
    views,
  };
}
