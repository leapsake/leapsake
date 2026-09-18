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
  resolveReminderSchedule,
  todayCivil,
} from "@leapsake/schema";
import { duplicatesReminderId } from "@leapsake/reminders";
import { createRemindersApi } from "@leapsake/reminders/api";
// The onboarding-nudge id-convention, surfaced through core (the apps' single
// entry point) so a client can map a Home reminder's id to its CTA route without
// depending on `@leapsake/reminders` directly.
export { ONBOARDING_REMINDERS, onboardingRouteOf } from "@leapsake/reminders";
export type { OnboardingReminder, OnboardingRoute } from "@leapsake/reminders";

/**
 * The reminder shapes a client types its screens against, surfaced through core
 * — the apps' single entry point — like the onboarding route above.
 */
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

// Duplicate-detection result shapes (reconciliation Increment B), re-exported
// from the data layer so every client renders candidates against one contract.
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
// The shape of the archive's `data.json`, for a client (or a test) that reads
// one back. Re-exported here for the same reason `ExportArchive` is: core is the
// composition root every client wires against, and nothing else should have to
// take a direct dependency on `@leapsake/export` to understand its output.
export { exportDataSchema } from "@leapsake/export";
export type { ExportData } from "@leapsake/export";

// The local-notification policy row shape (`plans/v0-1_08_local-notifications.md`,
// migration 29), re-exported so the settings UI can type what `notificationSettings`
// reads and writes.
export type { NotificationMode, NotificationSettings } from "@leapsake/schema";

// The custody Phase 0 bootstrap: the first KeyStore consumer, run between
// migrations and createCore to make the device's master key available. Plus the
// Phase-1/2 password unlock door: enable sync (add the password + recovery
// wrappings of MK) and unlock the master key from the password / recovery key
// alone, with no enclave involved. And the relinquish half (@leapsake/key-custody):
// `lockThisDevice` is sign out — forget the two secrets that open this device's
// store so the next open must pass the password gate.
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
  type BootKeySession,
  type AdoptionDoor,
  type RecoveryDoorWriter,
  type KeySession,
  type UnlockedMasterKey,
  type SyncStatus,
  type AccountBootstrap,
  type AccountBootstrapChannel,
  type RecoveryChannel,
} from "@leapsake/key-custody";

// The production sync-engine assembly: the canonical syncable allowlist plus a
// one-call cycle for an enabled account, so each client drives sync the same way
// (desktop now; mobile in Phase C) instead of hand-rolling the repo registry.
export {
  syncableRepos,
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
  type JoinReconcileResult,
  type PasswordDoorWriter,
  getAutoSync,
  setAutoSync,
} from "./sync.js";

// The bundled holiday catalog's seed, applied at store open once per bundle
// version. Re-exported so a client never depends on `@leapsake/holidays`
// directly, the same way the reminders engine is kept behind this surface.
export { seedHolidayCatalog, createHolidaysApi } from "@leapsake/holidays";
export type {
  BearerHolidayCandidate,
  HolidayDetail,
  HolidayListItem,
  HolidayObserverCandidate,
  HolidaysApiDeps,
  ObserverDecision,
} from "@leapsake/holidays";

// The scheduling layer that turns the manual one-shot sync into seamless
// background sync: a debounced, single-flight scheduler plus a CoreApi wrapper
// that kicks a sync after every local write. Each client wires the platform
// triggers (focus/foreground) to it.
export {
  createSyncScheduler,
  withSyncKick,
  SYNC_INTERVAL_MS,
  SYNC_KICK_DEBOUNCE_MS,
  type SyncScheduler,
} from "@leapsake/sync";

// Whether the relay claims to keep a durable copy of the account's data — the
// check that words the "Forget account" confirmation (@leapsake/key-custody). Silence
// means "no copy", so a client that never reaches its relay still warns honestly.
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

/**
 * The client-agnostic application surface. Every operation is a composition over
 * the repositories in `@leapsake/data` — transactional writes, cascade deletes,
 * relationship orientation, label resolution, and the cross-repo read services.
 * It is deliberately free of any transport (Electron IPC) or UI concern, so each
 * client uses it the same way:
 *
 * - **Desktop** builds the core in the Electron main process and forwards each
 *   method over typed IPC (`window.api`).
 * - **Mobile (Expo/RN)** builds the core in-process and calls it directly.
 *
 * The shape mirrors what the desktop renderer already consumes as `window.api`,
 * so the desktop preload can derive its type from {@link CoreApi}.
 */
export type CoreApi = ReturnType<typeof createCore>;

/**
 * Wire the repositories and services over a {@link SqliteDriver} and return the
 * composed {@link CoreApi}. Synchronous wiring only — run {@link runMigrations}
 * against the same driver before issuing any query.
 *
 * Inputs are passed straight to the repositories, which validate them with their
 * Zod schemas internally. A client that accepts untrusted input (e.g. the desktop
 * IPC boundary) should additionally parse at its trust boundary before calling in.
 */
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
  const regenerateSystem = remindersApi.regenerateSystem;

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
        // Reconcile after commit so the getting-started onboarding nudge
        // retires promptly (its `hasAnyEntity` signal just flipped true) rather
        // than waiting for the next boot/focus. Its own transaction — BEGIN/COMMIT
        // doesn't nest — and a sync-kicking write, so the pruned row rides the kick.
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
        // A rename can create (or dissolve) a duplicate pair — the scorer keys on
        // the folded name — so reconcile for the Home nudge's sake, the same way
        // create/merge/delete do. Contact-method edits can move the pair set too;
        // those are left to the boot/focus reconcile rather than threading this
        // call through every contact write.
        await regenerateSystem();
        return person;
      },
      // The cascade removes their milestones, so reconcile afterwards to prune
      // any now-orphaned birthday reminder at once (same reason a milestone
      // delete does — see `milestones.softDelete`), rather than leaving it until
      // boot/focus.
      softDelete: async (id: string): Promise<void> => {
        await driver.transaction(() =>
          entities.softDeleteCascade("person", id),
        );
        await regenerateSystem();
      },
      // The loser's birthday milestone now bears the survivor, but its reminder
      // still carries the loser's baked-in name + @mention (now a dead link, the
      // loser being tombstoned). Reconcile so it re-titles onto the survivor and
      // re-points its mention backlink — same drift-repair a rename triggers.
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
        // Reconcile after commit so the getting-started onboarding nudge
        // retires promptly (a pet also satisfies `hasAnyEntity`) — see the mirror
        // in `people.create`.
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
      // Cascade-delete the pet's facts, then reconcile so its birthday reminder is
      // pruned at once (see the Person `softDelete` above for the rationale).
      softDelete: async (id: string): Promise<void> => {
        await driver.transaction(() => entities.softDeleteCascade("pet", id));
        await regenerateSystem();
      },
    },

    tags: {
      // The tag catalog: every tag alphabetically, with its usage count. Unlike
      // the `…ForTag` reads below it answers "what tags exist at all", which no
      // per-entity screen can reconstruct.
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
      // Reminders carry tags too (parsed inline from their text under bearer type
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

    // Holidays. The catalog itself is read-only — a catalog row is immutable by
    // design (`@leapsake/holidays` README, read-only catalog rows) — so the user's levers are all
    // *around* it: who observes, what each observance reminds about, and whether
    // the holiday is suppressed entirely.
    //
    // Every one of those is an input to the reminder engine, so each write
    // reconciles afterwards rather than waiting for the next boot/focus. Without
    // this, saying "Violet celebrates Christmas" would sit inert until the app
    // was restarted — the same reason a person/milestone write reconciles above.
    // Each runs in its own transaction (BEGIN/COMMIT doesn't nest) and rides the
    // sync kick as a normal write.
    holidays: {
      ...holidaysApi,
      setObservers: async (
        holidayId: string,
        decisions: readonly ObserverDecision[],
      ): Promise<void> => {
        await holidaysApi.setObservers(holidayId, decisions);
        // Which holidays someone keeps is a fact about them. Only the bearers
        // being *given* the observance promote — clearing one says nothing new
        // about anybody.
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
      // Each write reconciles afterwards, because a relationship is now an input
      // to the reminder engine: recording a spouse is what raises "when is your
      // anniversary?", editing the role is what changes which date it asks for
      // (a partnership that becomes a marriage), and deleting the edge is what
      // retires the question. Without this the row would appear only at the next
      // boot or focus, which reads as the app not having noticed.
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
      // Removing the edge removes anyone who was only on the other end of it.
      // For two published people this unlinks two records that both carry on
      // existing; when one end is unpublished, that edge was the entire reason
      // they were in the database, so the row goes with it rather than becoming
      // unreachable. The UI says which of the two is about to happen.
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
      // Write a relationship from a subject's perspective, implying the subject's
      // own role from the chosen other role.
      //
      // These three reconcile afterwards for the same reason `create`/`update`
      // above do — and they are the ones that matter in practice, since this is
      // the path a relationship is actually added by, from a person's own page.
      // Wrapped here rather than inside each helper because the milestone
      // "with whom?" flow calls them mid-write and reconciles once, after its
      // own commit.
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
      // Own milestones merged with those of each explicit relationship the entity
      // is in, resolved read-only and annotated with the partner's label.
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
      // Each milestone write reconciles the automated birthday reminders right
      // after it commits, so adding / editing / deleting a birthday updates the
      // Home list at once (a new reminder appears, an edited date re-dates its
      // reminder, a deleted birthday prunes it) rather than waiting for the next
      // boot/focus. The reconcile is its own transaction (the driver's BEGIN/COMMIT
      // doesn't nest), and this is a sync-kicking `create/update/softDelete`, so
      // the reconciled reminder rows ride the same post-write sync kick.
      // The effective staggered-reminder schedule to show/edit for a milestone:
      // its stored rules if it's been customised, else its kind's defaults
      // (schema `resolveReminderSchedule`). The editor loads this when opening an
      // existing milestone; a brand-new milestone's defaults come straight from
      // the kind, so create needs no read.
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
      // A milestone's write and its reminder schedule commit in one transaction,
      // so the two never diverge. `reminderSchedule` (when the form sends it)
      // replaces the milestone's whole rule set; omitting it leaves the stored
      // rules untouched (an untouched milestone keeps riding its kind defaults).
      // The automated birthday reminders reconcile right after commit, as before.
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

    reminders: remindersApi,

    // Who "you" are — a pointer at the Person that is the self.
    // `get` reads the singleton (undefined when unset); `set` points
    // it at an existing Person and reconciles the automated reminders, so your
    // own birthday's wish flips to its self-directed copy at once (rather than
    // waiting for the next boot/focus reconcile); `clear` un-picks it.
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

    // Local-notification policy (`plans/v0-1_08_local-notifications.md`), Inc 1:
    // the substrate only — no planner, no OS calls. Every method is scoped by
    // an explicit deviceId rather than an ambient "this device", so a
    // cross-device settings UI can read/edit any device's row, exactly like
    // `reminders.snooze(id, days)` takes an explicit id.
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

    // Gifts. An idea is a thing in the world (person-agnostic); a recipient link
    // pairs an idea with a person or pet and says whether they have been given
    // it. Two tables, not the three this had while a giving carried a date — see
    // `gift-recipient.ts`.
    contactMethods: {
      // Merged read fans out across the four typed tables; writes target one
      // typed sub-repo each.
      listForOwner: (
        type: ContactOwnerType,
        id: string,
      ): Promise<ContactMethod[]> =>
        listContactMethods(contactMethods, { type, id }),
      // Each `create` publishes an unpublished owner: an address or a number is a
      // fact about that person, not about whoever they are attached to.
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

    // Duplicate detection (reconciliation Increment B): propose merges and
    // remember rejected pairs. Detection only — an actual merge goes through
    // `people.merge` (Increment A); `reject` records the "not a duplicate" memory
    // (which syncs, so no other device re-nags the pair).
    duplicates: {
      findCandidates: duplicates.unresolvedCandidates,
      /**
       * The candidates involving one person — what the review screen shows when
       * it is scoped to a just-created person, and what a person's own page asks
       * before deciding whether to warn. A filter over the full scan rather than
       * its own query: the scan is the same O(n²) in-memory pass either way at
       * personal-CRM scale, and reusing it keeps the `not_a_duplicate` memory and
       * the tier/sort rules in exactly one place.
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
       * The id of the Home nudge for today's outstanding pairs, or `null` when
       * there are none. Clients match it against the reminder list to hang the
       * "Review" CTA on that row — the id-convention, but recomputed rather than
       * static because the nudge is content-addressed on the pair set (see
       * `duplicatesReminderId`).
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

    /**
     * **Export** — the whole store as one archive the user keeps. The mirror of
     * `import` below, and the answer to the fact that v0.1 is single-device, so
     * the app container is the only place a user's data exists.
     *
     * Read-only, so unlike `import.commit` there is no `driver.transaction`
     * around it: an export is a snapshot, and a store being written mid-export
     * yields a slightly newer or older card, never a broken file.
     *
     * **Every read here already excludes soft-deleted rows**, structurally
     * rather than by a predicate spelled at each call site. Three mechanisms,
     * no per-call-site predicate: `createEntityRepo` bakes `deleted_at IS NULL`
     * into `listWhere`/`get` (so every `list()` below is filtered),
     * `listForEntity` filters both the tagging and the tag, and `listActive()`
     * covers the three `data.json` tables that have no entity repo — `mentions`,
     * `not_a_duplicate` and `relationship_dismissals`. **Those three are the
     * ones to be careful with**: their other whole-table read,
     * `listChangedSince(0)`, deliberately carries tombstones because sync must
     * propagate them, and reaching for it here would put rows the user deleted
     * into the one artifact that leaves the device. Filtering everywhere is also
     * what makes the exclusion transitive for free: no read available here can
     * produce a relationship, tagging or observance pointing at a row the file
     * leaves out.
     *
     * `people.list()` and `pets.list()` likewise answer only *published*
     * entities (`PUBLISHED_SQL`). An unpublished person reaches the file only as
     * a `RELATED` on the card of the one person they hang off, which is what
     * their standing means — and `orientedNeighbors` is the only door they come
     * through.
     *
     * `neighborsFor` is wired to `orientedNeighbors`, **not** to
     * `kinship.neighborsFor`. The two return the same shape, but the kinship
     * service also computes the inference engine's derived edges, which the
     * export must never write (they have no stored row, and persisting an
     * inference would stop it being live). `orientedNeighbors` reads the stored
     * rows and stamps `origin: "explicit"` by construction, so nothing needs
     * filtering and the walk never runs per entity.
     *
     * The fan-out is roughly `3 + 4(N + P) + E` queries for N people, P pets and
     * E relationships, plus 11 whole-table reads for `data.json` and one more
     * per reminder and gift idea for its tags. Fine at v0.1 sizes. If it ever
     * bites, the fix is bulk reads behind `ExportPorts` — not caching in
     * whichever client called.
     */
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
            // The three with no entity repo, and so no `list()`. `listActive()`
            // is their filtered read — see the port's doc, and never
            // `listChangedSince(0)`, which carries tombstones on purpose.
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

    // Contact import (e.g. a dropped vCard). The pure parse + format detection run
    // client-side (`@leapsake/vcard`); this is the write half — take the
    // reviewed `ParsedContact`s and commit them through the same repos manual
    // creation uses. `preview` is the read half: flag likely-existing people so
    // the review can offer skip/merge before anything is written.
    // Keeping People in step with the phone's address book (mobile). The import
    // itself goes through `import.commit` with a `sourceId` on each decision;
    // this is the bookkeeping around it, all of it device-local.
    deviceContacts: {
      /** Every address-book id this device has already seen — including those
       *  whose person was since deleted, which is what keeps them deleted. */
      linkedIds: (): Promise<string[]> => deviceContactLinks.listContactIds(),
      /** Whether new phone contacts are brought in at boot and on foreground. */
      getSyncEnabled: (): Promise<boolean> =>
        deviceContactsState.getDeviceContactsSync(),
      setSyncEnabled: (enabled: boolean): Promise<void> =>
        deviceContactsState.setDeviceContactsSync(enabled),
    },

    // Read-and-compose view-model builders: portable fan-outs, label resolution,
    // candidate lists, and relationship-orientation reads that return plain data.
    views,
  };
}
