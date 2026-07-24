import {
  type DuplicateCandidate,
  type DuplicateMatch,
  type GenderResult,
  type SqliteDriver,
  createContactMethodsRepo,
  createContentCipher,
  createDismissalsRepo,
  createDuplicateService,
  createHiddenHolidaysRepo,
  createHolidaysRepo,
  createKinshipService,
  createMentionsRepo,
  createObservancesRepo,
  createMilestonesRepo,
  createNotADuplicateRepo,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipsRepo,
  createGiftIdeasRepo,
  createGiftSuggestionsRepo,
  createGiftsRepo,
  createReminderRulesRepo,
  createRemindersRepo,
  createSearchService,
  createSelfPersonRepo,
  createTagsRepo,
  listContactMethods,
  listTimelineForEntity,
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
  CreateReminderInput,
  CreateRelationshipInput,
  CreateGiftIdeaInput,
  CreateGiftSuggestionInput,
  CreateGiftInput,
  EmailAddress,
  EntityType,
  Milestone,
  MilestoneBearerType,
  MilestoneTimelineEntry,
  Person,
  Pet,
  PhoneNumber,
  PostalAddress,
  MilestoneKind,
  ObservanceBearerType,
  Relationship,
  RelationshipNeighbor,
  RelationshipRole,
  Reminder,
  ReminderRuleInput,
  ReminderWithTags,
  ResolvedMention,
  SearchHit,
  SelfPerson,
  GiftIdea,
  GiftPartyType,
  GiftSuggestion,
  Gift,
  SuggestForEntry,
  Tag,
  UpdateEmailInput,
  UpdateMilestoneInput,
  UpdatePersonInput,
  UpdatePetInput,
  UpdatePhoneInput,
  UpdatePostalInput,
  UpdateReminderInput,
  UpdateRelationshipInput,
  UpdateGiftIdeaInput,
  UpdateGiftSuggestionInput,
  UpdateGiftInput,
} from "@leapsake/schema";
import {
  entityLabel,
  genderedVariant,
  impliedGender,
  inverseRole,
  isReminderEditable,
  milestoneLabel,
  parseHashtags,
  parseMentions,
  resolveObservanceReminderSchedule,
  resolveReminderSchedule,
  roleDefs,
  todayCivil,
} from "@leapsake/schema";
import { regenerateSystemReminders } from "@leapsake/reminders";
// The onboarding-nudge id-convention, surfaced through core (the apps' single
// entry point) so a client can map a Home reminder's id to its CTA route without
// depending on `@leapsake/reminders` directly.
export { ONBOARDING_REMINDERS, onboardingRouteOf } from "@leapsake/reminders";
export type { OnboardingReminder, OnboardingRoute } from "@leapsake/reminders";
import {
  type ImportDecision,
  type ImportPorts,
  type ImportResult,
  type ParsedContact,
  ingestContacts,
} from "@leapsake/contact-import";
import { getSyncStatus } from "@leapsake/key-custody";
import type { KeySession } from "@leapsake/key-custody";
import {
  type ObserverDecision,
  createHolidaysApi,
  holidayReminderCandidates,
} from "./holidays.js";
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

// Contact-import shapes, re-exported so the desktop boundary parser and the
// review UI bind to the same contract the ingest engine consumes.
export type {
  ImportDecision,
  ImportError,
  ImportResult,
  ParsedContact,
} from "@leapsake/contact-import";

// The custody Phase 0 bootstrap: the first KeyStore consumer, run between
// migrations and createCore to make the device's master key available. Plus the
// Phase-1/2 password unlock door: enable sync (add the password + recovery
// wrappings of MK) and unlock the master key from the password / recovery key
// alone, with no enclave involved.
export {
  ensureDeviceMasterKey,
  enableSync,
  joinAccount,
  recoverAccount,
  reauthenticate,
  unlockWithPassword,
  unlockWithRecoveryKey,
  getSyncStatus,
  clearLocalAccount,
  KEYSTORE_SECRET_IDS,
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
  registerAccountWithRelay,
  joinAccountViaRelay,
  recoverAccountViaRelay,
  reauthenticateViaRelay,
  isRelayAuthError,
  runAccountSync,
  reconcileOnJoin,
  selectJoinDuplicates,
  type JoinReconcileResult,
  getAutoSync,
  setAutoSync,
} from "./sync.js";

// The bundled holiday catalog's seed, applied at store open once per bundle
// version. Re-exported so a client never depends on `@leapsake/holidays`
// directly, the same way the reminders engine is kept behind this surface.
export { seedHolidayCatalog } from "./holiday-seed.js";
export { createHolidaysApi } from "./holidays.js";
export type {
  BearerHolidayCandidate,
  HolidayDetail,
  HolidayListItem,
  HolidayObserverCandidate,
  HolidaysApiDeps,
  ObserverDecision,
} from "./holidays.js";

/**
 * A gift suggestion joined for the recipient's "Gift ideas" section: the row plus
 * its idea's title/url and its occasion's resolved label. The idea is always live
 * (deleting an idea cascades to its suggestions), so the title is non-null.
 */
export type GiftSuggestionForRecipient = GiftSuggestion & {
  ideaTitle: string;
  ideaUrl: string | null;
  occasionLabel: string | null;
};

/**
 * A gift suggestion joined for an idea's "Suggested for" section: the row plus its
 * recipient's display label and its occasion's resolved label. A suggestion whose
 * recipient is gone is dropped by the reader, so the label is non-null.
 */
export type GiftSuggestionForIdea = GiftSuggestion & {
  recipientLabel: string;
  occasionLabel: string | null;
};

/**
 * A gift (a giving) joined for a recipient's "Gifts given" section: the row plus
 * its idea's title/url, its giver's resolved label (null for an unknown giver),
 * and its occasion's resolved label. The idea is always live (deleting an idea
 * cascades to its gifts), so the title is non-null.
 */
export type GiftForRecipient = Gift & {
  ideaTitle: string;
  ideaUrl: string | null;
  giverLabel: string | null;
  occasionLabel: string | null;
};

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
 *
 * Pass the {@link KeySession} minted by {@link ensureDeviceMasterKey} to encrypt
 * sensitive fields at rest under per-item content keys (today: `milestone.note`).
 * Omit it and those fields are stored and read as plaintext, unchanged — so tests
 * and any not-yet-keyed path keep working.
 */
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

export function createCore(driver: SqliteDriver, keySession?: KeySession) {
  // The first consumer of the unlocked master key: a content cipher that the
  // repositories with encrypted fields use to seal/open under per-item keys.
  const cipher =
    keySession === undefined
      ? undefined
      : createContentCipher({ driver, masterKey: keySession.masterKey });

  const people = createPeopleRepo(driver);
  const pets = createPetsRepo(driver);
  const tags = createTagsRepo(driver);
  const relationships = createRelationshipsRepo(driver);
  const dismissals = createDismissalsRepo(driver);
  const notADuplicate = createNotADuplicateRepo(driver);
  const milestones = createMilestonesRepo(driver, cipher);
  const reminderRules = createReminderRulesRepo(driver);
  const reminders = createRemindersRepo(driver);
  const self = createSelfPersonRepo(driver);
  const giftIdeas = createGiftIdeasRepo(driver);
  const giftSuggestions = createGiftSuggestionsRepo(driver);
  const giftsRepo = createGiftsRepo(driver);
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

  // Resolve a reminder's stored mentions to their targets' **current** labels
  // (null when the target is gone), so a client can render an inline mention token
  // as a live link. The join rows are the source of *which* entities are mentioned;
  // the label is re-resolved fresh, so a rename shows through.
  const resolveMentions = async (
    reminderId: string,
  ): Promise<ResolvedMention[]> => {
    const rows = await mentions.listForBearer("reminder", reminderId);
    return Promise.all(
      rows.map(async (m) => ({
        targetType: m.targetType,
        targetId: m.targetId,
        label: (await resolveLabel(m.targetType, m.targetId)) ?? null,
      })),
    );
  };
  const contactMethods = createContactMethodsRepo(driver);
  const kinship = createKinshipService(driver, {
    people,
    pets,
    relationships,
    dismissals,
  });
  const search = createSearchService(driver);
  const duplicates = createDuplicateService(driver);

  // Resolve an entity to its display label for relationship rows and timeline
  // annotations, using the shared `@leapsake/schema` formatters so every client
  // labels entities identically. Returns undefined when the entity is gone so
  // callers can skip a missing neighbor.
  async function resolveLabel(
    type: EntityType,
    id: string,
  ): Promise<string | undefined> {
    if (type === "person") {
      const person = await people.get(id);
      return person ? entityLabel("person", person) : undefined;
    }
    const pet = await pets.get(id);
    return pet ? entityLabel("pet", pet) : undefined;
  }

  // Resolve a gift suggestion's optional occasion pointer to a display label — a
  // milestone's label (e.g. "Birthday") or a holiday's name — or null when there
  // is no occasion or its target is gone. The occasion is only a label; the
  // suggestion's target date remains the source of truth for *when*.
  async function resolveOccasionLabel(
    occasionType: "milestone" | "holiday" | null,
    occasionId: string | null,
  ): Promise<string | null> {
    if (occasionType === null || occasionId === null) return null;
    if (occasionType === "milestone") {
      const m = await milestones.get(occasionId);
      return m ? milestoneLabel(m) : null;
    }
    const holiday = await holidays.get(occasionId);
    return holiday ? holiday.name : null;
  }

  // Orient each stored row touching the subject and resolve the *other* end's
  // label + role, so callers never see the raw a/b endpoints. Shared by the
  // `relationships.listForEntity` surface and the view builders.
  async function orientedNeighbors(
    type: EntityType,
    id: string,
  ): Promise<RelationshipNeighbor[]> {
    const rows = await relationships.listForEntity(type, id);
    const neighbors: RelationshipNeighbor[] = [];
    for (const rel of rows) {
      const subjectIsA = rel.aType === type && rel.aId === id;
      const otherType = subjectIsA ? rel.bType : rel.aType;
      const otherId = subjectIsA ? rel.bId : rel.aId;
      const otherRole = subjectIsA ? rel.bRole : rel.aRole;
      const otherRoleNote = subjectIsA ? rel.bRoleNote : rel.aRoleNote;
      const otherLabel = await resolveLabel(otherType, otherId);
      if (otherLabel === undefined) continue; // other end gone — skip
      neighbors.push({
        relationshipId: rel.id,
        otherType,
        otherId,
        otherLabel,
        otherRole,
        otherRoleLabel: roleDefs[otherRole].label,
        otherRoleNote,
        origin: "explicit",
      });
    }
    return neighbors;
  }

  // A relationship written from a subject's perspective: the subject is the `a`
  // endpoint, and its own role is the gender-neutral inverse of the chosen other
  // role. This is the single home for the "imply my role from the other end"
  // rule, shared by the add-from-subject, create-form, and derived-materialise
  // paths so no client re-derives it.
  function createFromSubject(input: {
    subjectType: EntityType;
    subjectId: string;
    otherType: EntityType;
    otherId: string;
    otherRole: RelationshipRole;
    otherRoleNote?: string | null;
  }): Promise<Relationship> {
    return driver.transaction(() =>
      relationships.create({
        aType: input.subjectType,
        aId: input.subjectId,
        aRole: inverseRole(input.otherRole),
        bType: input.otherType,
        bId: input.otherId,
        bRole: input.otherRole,
        bRoleNote: input.otherRoleNote ?? null,
      }),
    );
  }

  // Edit a subject-scoped relationship: only the *other* end's role changes; the
  // subject's own role re-derives as the neutral inverse but keeps the gendering
  // it already had (so editing a wife→husband couple doesn't flatten the unedited
  // "husband" back to "spouse"). The stored row may hold the subject on either
  // end, so we fetch it to learn the orientation before mapping roles onto a/b.
  function editFromSubject(input: {
    subjectType: EntityType;
    subjectId: string;
    relId: string;
    otherRole: RelationshipRole;
    otherRoleNote: string | null;
  }): Promise<Relationship | undefined> {
    return driver.transaction(async () => {
      const rel = await relationships.get(input.relId);
      if (!rel) return undefined;
      const subjectIsA =
        rel.aType === input.subjectType && rel.aId === input.subjectId;
      const subjectRole = genderedVariant(
        inverseRole(input.otherRole),
        impliedGender(subjectIsA ? rel.aRole : rel.bRole),
      );
      return relationships.update(
        input.relId,
        subjectIsA
          ? {
              aRole: subjectRole,
              aRoleNote: null,
              bRole: input.otherRole,
              bRoleNote: input.otherRoleNote,
            }
          : {
              aRole: input.otherRole,
              aRoleNote: input.otherRoleNote,
              bRole: subjectRole,
              bRoleNote: null,
            },
      );
    });
  }

  // The composition root for automated (`system`) reminders: construct the
  // `@leapsake/reminders` engine over the real repos + this core's own
  // `resolveLabel`, and reconcile today's upcoming birthdays. "Today" is the local
  // civil date (a calendar event fires on the user's day). Called at boot/focus
  // *and* after every milestone write (see `milestones` below), so an added /
  // edited / deleted birthday reconciles at once instead of waiting for a relaunch.
  const regenerateSystem = (): Promise<{
    created: number;
    updated: number;
    removed: number;
  }> =>
    regenerateSystemReminders({
      milestones: {
        listRemindEligible: () => milestones.listRemindEligible(),
      },
      // The milestone's effective staggered schedule: its stored rule rows, or —
      // when untouched — its kind's defaults (schema's `resolveReminderSchedule`,
      // the same resolve the editor loads). The engine mints one reminder per
      // enabled entry.
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
      // Birthdays only bear on a person/pet; a relationship bearer (future kinds)
      // has no single label, so it's skipped rather than mislabelled.
      resolveLabel: async (bearerType, bearerId) =>
        bearerType === "relationship"
          ? null
          : ((await resolveLabel(bearerType, bearerId)) ?? null),
      // Is a milestone's bearer the self-person? Flips your own birthday's wish to
      // its self-directed copy (plans/gifts.md §Slice 0). Only a person can be
      // self, so a pet/relationship bearer is `false` without a lookup.
      isSelf: async (bearerType, bearerId) =>
        bearerType === "person" &&
        bearerId === (await self.getSelf())?.personId,
      today: todayCivil(),
      transaction: (body) => driver.transaction(body),
      // The first-run signals for the onboarding nudges. `hasAnyEntity` gates the
      // "add your first person" step; a relay-connected account (a `relayUrl` on
      // the singleton) gates the "sync another device" step; `hasSelf` gates the
      // "pick yourself" step. All retire (prune) automatically once satisfied —
      // see `@leapsake/reminders` ONBOARDING_STEPS.
      onboarding: {
        hasAnyEntity: async () =>
          (await people.list()).length > 0 || (await pets.list()).length > 0,
        isSyncConnected: async () =>
          (await getSyncStatus({ driver })).relayUrl !== undefined,
        hasSelf: async () => (await self.getSelf()) !== undefined,
      },
      // Holiday observances — the second dated reminder family. Always supplied
      // here, never conditionally: the engine prunes (and permanently
      // tombstones) every active system reminder absent from the desired set, so
      // a client that omitted this port would silently kill every holiday
      // reminder it had already generated.
      holidays: {
        listCandidates: () =>
          holidayReminderCandidates({
            holidays,
            observances,
            hiddenHolidays,
            reminderRules,
            today: todayCivil(),
          }),
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
          (await resolveLabel(bearerType, bearerId)) ?? null,
      },
    });

  const views = createViews({
    people: { list: () => people.list(), get: (id) => people.get(id) },
    pets: { list: () => pets.list(), get: (id) => pets.get(id) },
    listTags: (type, id) => tags.listForEntity(type, id),
    getRelationship: (id) => relationships.get(id),
    listMilestones: (type, id) => milestones.listForBearer(type, id),
    orientedNeighbors,
    neighborsFor: (type, id) => kinship.neighborsFor(type, id),
    genderFor: (type, id) => kinship.genderFor(type, id),
    timelineFor: (type, id) =>
      listTimelineForEntity(milestones, relationships, resolveLabel, type, id),
    listContactMethods: (type, id) =>
      listContactMethods(contactMethods, { type, id }),
    resolveLabel,
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
        // Reconcile after commit so the "add your first person" onboarding nudge
        // retires promptly (its `hasAnyEntity` signal just flipped true) rather
        // than waiting for the next boot/focus. Its own transaction — BEGIN/COMMIT
        // doesn't nest — and a sync-kicking write, so the pruned row rides the kick.
        await regenerateSystem();
        return person;
      },
      update: (
        id: string,
        input: UpdatePersonInput,
        tagNames: string[],
      ): Promise<Person | undefined> =>
        driver.transaction(async () => {
          const person = await people.update(id, input);
          if (person) {
            await tags.setEntityTags("person", id, tagNames);
          }
          return person;
        }),
      // Soft-delete the person and cascade across every fact that references it.
      // The cascade removes their milestones, so reconcile afterwards to prune any
      // now-orphaned birthday reminder at once (same reason a milestone delete does
      // — see `milestones.softDelete`), rather than leaving it until boot/focus.
      softDelete: async (id: string): Promise<void> => {
        await driver.transaction(async () => {
          await people.softDelete(id);
          await tags.removeAllForEntity("person", id);
          await relationships.removeAllForEntity("person", id);
          await dismissals.removeAllForEntity("person", id);
          await milestones.removeAllForEntity("person", id);
          await contactMethods.removeAllForOwner("person", id);
          await observances.removeAllForBearer("person", id);
          await giftSuggestions.removeAllForRecipient("person", id);
          await giftsRepo.removeAllForParty("person", id);
        });
        await regenerateSystem();
      },
      // Absorb the `loser` person into the `survivor`, in one transaction: the
      // mirror of the cascade-delete above, re-pointing every fact onto the
      // survivor instead of removing it, then tombstoning the loser. The
      // survivor's own scalar fields (name, gender) win as-is — survivorship v1
      // is deliberately blunt, with no per-field picker. Re-points bump each
      // row's updated_at and the loser's tombstone propagates, so the merge
      // replicates across devices over normal sync with no merge-specific code.
      merge: async (survivorId: string, loserId: string): Promise<void> => {
        if (survivorId === loserId) {
          throw new Error(
            "mergePeople: survivor and loser are the same person",
          );
        }
        await driver.transaction(async () => {
          await tags.repointEntity("person", loserId, survivorId);
          await relationships.repointEntity("person", loserId, survivorId);
          await dismissals.repointEntity("person", loserId, survivorId);
          await milestones.repointEntity("person", loserId, survivorId);
          await contactMethods.repointOwner("person", loserId, survivorId);
          await observances.repointBearer("person", loserId, survivorId);
          await giftSuggestions.repointRecipient("person", loserId, survivorId);
          await giftsRepo.repointParty("person", loserId, survivorId);
          // Carry the "not a duplicate" memory across so the merge doesn't strand
          // or self-pair a rejection (it re-canonicalizes and drops self/dupes).
          await notADuplicate.repointEntity(loserId, survivorId);
          // Bump the survivor's clock so the merged survivor wins LWW against any
          // concurrent edit to the loser still in flight from another device.
          await people.update(survivorId, {});
          await people.softDelete(loserId);
        });
        // The loser's birthday milestone now bears the survivor, but its reminder
        // still carries the loser's baked-in name + @mention (now a dead link, the
        // loser being tombstoned). Reconcile so it re-titles onto the survivor and
        // re-points its mention backlink — same drift-repair a rename triggers.
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
        // Reconcile after commit so the "add your first person" onboarding nudge
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
          }
          return pet;
        }),
      // Cascade-delete the pet's facts, then reconcile so its birthday reminder is
      // pruned at once (see the Person `softDelete` above for the rationale).
      softDelete: async (id: string): Promise<void> => {
        await driver.transaction(async () => {
          await pets.softDelete(id);
          await tags.removeAllForEntity("pet", id);
          await relationships.removeAllForEntity("pet", id);
          await dismissals.removeAllForEntity("pet", id);
          await milestones.removeAllForEntity("pet", id);
          await observances.removeAllForBearer("pet", id);
          await giftSuggestions.removeAllForRecipient("pet", id);
          await giftsRepo.removeAllForParty("pet", id);
        });
        await regenerateSystem();
      },
    },

    tags: {
      get: (id: string): Promise<Tag | undefined> => tags.get(id),
      softDelete: (id: string): Promise<void> =>
        driver.transaction(() => tags.softDelete(id)),
      listForPerson: (personId: string): Promise<Tag[]> =>
        tags.listForEntity("person", personId),
      listForPet: (petId: string): Promise<Tag[]> =>
        tags.listForEntity("pet", petId),
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
    },

    // Holidays. The catalog itself is read-only — a catalog row is immutable by
    // design (holidays/research.md §2.6) — so the user's levers are all
    // *around* it: who observes, what each observance reminds about, and whether
    // the holiday is suppressed entirely.
    //
    // Every one of those is an input to the reminder engine, so each write
    // reconciles afterwards rather than waiting for the next boot/focus. Without
    // this, saying "Alice celebrates Christmas" would sit inert until the app
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
      create: (input: CreateRelationshipInput): Promise<Relationship> =>
        driver.transaction(() => relationships.create(input)),
      update: (
        id: string,
        input: UpdateRelationshipInput,
      ): Promise<Relationship | undefined> =>
        driver.transaction(() => relationships.update(id, input)),
      softDelete: (id: string): Promise<void> =>
        driver.transaction(() => relationships.softDelete(id)),
      // Orient each stored row to the subject and resolve the *other* end's
      // label + role, so the caller never sees the raw a/b endpoints.
      listForEntity: (
        type: EntityType,
        id: string,
      ): Promise<RelationshipNeighbor[]> => orientedNeighbors(type, id),
      // Write a relationship from a subject's perspective, implying the subject's
      // own role from the chosen other role. See {@link createFromSubject}.
      createFromSubject,
      // Edit a subject-scoped relationship, re-deriving the subject's own role.
      // See {@link editFromSubject}.
      editFromSubject,
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
          resolveLabel,
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
        return resolveReminderSchedule(kind, stored);
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

    reminders: {
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
      // Reversible completion toggle: stamps/clears `completedAt`; text (and so its
      // tags/mentions) is untouched, so no re-derivation needed.
      setCompleted: (
        id: string,
        completed: boolean,
      ): Promise<Reminder | undefined> =>
        driver.transaction(() => reminders.setCompleted(id, completed)),
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
    },

    // Who "you" are — a pointer at the Person that is the self (plans/gifts.md
    // §Slice 0). `get` reads the singleton (undefined when unset); `set` points
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

    // Gifts (plans/gifts.md). An idea is a thing in the world (person-agnostic);
    // a suggestion pairs an idea with a recipient (a candidate). Givings (dated
    // events) join this namespace in a later slice.
    gifts: {
      ideas: {
        list: (): Promise<GiftIdea[]> => giftIdeas.list(),
        get: (id: string): Promise<GiftIdea | undefined> => giftIdeas.get(id),
        // Single-payload create (share-target ready): capture an idea and,
        // optionally, suggest it for zero-to-many recipients in one transaction.
        create: ({
          suggestFor,
          ...ideaInput
        }: CreateGiftIdeaInput & {
          suggestFor?: SuggestForEntry[];
        }): Promise<GiftIdea> =>
          driver.transaction(async () => {
            const idea = await giftIdeas.create(ideaInput);
            for (const entry of suggestFor ?? []) {
              await giftSuggestions.create({ giftIdeaId: idea.id, ...entry });
            }
            return idea;
          }),
        update: (
          id: string,
          input: UpdateGiftIdeaInput,
        ): Promise<GiftIdea | undefined> =>
          driver.transaction(() => giftIdeas.update(id, input)),
        // Removing an idea cascades to its suggestions and gifts — nothing
        // references a deleted idea, and a live suggestion/gift must always point
        // at a live idea.
        softDelete: (id: string): Promise<void> =>
          driver.transaction(async () => {
            await giftIdeas.softDelete(id);
            await giftSuggestions.removeAllForIdea(id);
            await giftsRepo.removeAllForIdea(id);
          }),
      },

      suggestions: {
        // The recipient's "Gift ideas" section: each suggestion joined with its
        // idea's title/url and its occasion label. A suggestion whose idea is
        // somehow gone is dropped (defensive — the idea cascade prevents it).
        listForRecipient: async (
          type: GiftPartyType,
          id: string,
        ): Promise<GiftSuggestionForRecipient[]> => {
          const rows = await giftSuggestions.listForRecipient(type, id);
          const joined = await Promise.all(
            rows.map(async (s) => {
              const idea = await giftIdeas.get(s.giftIdeaId);
              if (idea === undefined) return null;
              return {
                ...s,
                ideaTitle: idea.title,
                ideaUrl: idea.url,
                occasionLabel: await resolveOccasionLabel(
                  s.occasionType,
                  s.occasionId,
                ),
              };
            }),
          );
          return joined.filter(
            (s): s is GiftSuggestionForRecipient => s !== null,
          );
        },
        // An idea's "Suggested for" section: each suggestion joined with its
        // recipient's current label. A suggestion whose recipient is gone is
        // dropped (defensive — the recipient cascade prevents it).
        listForIdea: async (
          ideaId: string,
        ): Promise<GiftSuggestionForIdea[]> => {
          const rows = await giftSuggestions.listForIdea(ideaId);
          const joined = await Promise.all(
            rows.map(async (s) => {
              const recipientLabel = await resolveLabel(
                s.recipientType,
                s.recipientId,
              );
              if (recipientLabel === undefined) return null;
              return {
                ...s,
                recipientLabel,
                occasionLabel: await resolveOccasionLabel(
                  s.occasionType,
                  s.occasionId,
                ),
              };
            }),
          );
          return joined.filter((s): s is GiftSuggestionForIdea => s !== null);
        },
        create: (input: CreateGiftSuggestionInput): Promise<GiftSuggestion> =>
          driver.transaction(() => giftSuggestions.create(input)),
        update: (
          id: string,
          input: UpdateGiftSuggestionInput,
        ): Promise<GiftSuggestion | undefined> =>
          driver.transaction(() => giftSuggestions.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => giftSuggestions.softDelete(id)),
      },

      // Givings — the dated events. The "Gifts given" section on a recipient, and
      // the source of the "✓ given" annotation the suggestion list reads over
      // `(gift_idea_id, recipient)`.
      given: {
        // A recipient's gifts, each joined with its idea's title/url, its giver's
        // label ("You" resolves to the self-person's real name; null = unknown),
        // and its occasion label. A gift whose idea is gone is dropped (defensive
        // — the idea cascade prevents it).
        listForRecipient: async (
          type: GiftPartyType,
          id: string,
        ): Promise<GiftForRecipient[]> => {
          const rows = await giftsRepo.listForRecipient(type, id);
          const joined = await Promise.all(
            rows.map(async (g) => {
              const idea = await giftIdeas.get(g.giftIdeaId);
              if (idea === undefined) return null;
              const giverLabel =
                g.giverType !== null && g.giverId !== null
                  ? ((await resolveLabel(g.giverType, g.giverId)) ?? null)
                  : null;
              return {
                ...g,
                ideaTitle: idea.title,
                ideaUrl: idea.url,
                giverLabel,
                occasionLabel: await resolveOccasionLabel(
                  g.occasionType,
                  g.occasionId,
                ),
              };
            }),
          );
          return joined.filter((g): g is GiftForRecipient => g !== null);
        },
        // Log a giving; mints the idea in the same transaction when `giftIdea`
        // isn't an existing id (plans/gifts.md). An existing-id reference is
        // verified so a gift never points at a missing idea.
        create: (input: CreateGiftInput): Promise<Gift> =>
          driver.transaction(async () => {
            let giftIdeaId: string;
            if ("id" in input.giftIdea) {
              const idea = await giftIdeas.get(input.giftIdea.id);
              if (idea === undefined) throw new Error("gift idea not found");
              giftIdeaId = idea.id;
            } else {
              const idea = await giftIdeas.create({
                title: input.giftIdea.title,
                url: input.giftIdea.url ?? null,
              });
              giftIdeaId = idea.id;
            }
            return giftsRepo.create({
              giftIdeaId,
              recipient: input.recipient,
              giver: input.giver,
              date: input.date,
              occasion: input.occasion,
            });
          }),
        update: (
          id: string,
          input: UpdateGiftInput,
        ): Promise<Gift | undefined> =>
          driver.transaction(() => giftsRepo.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => giftsRepo.softDelete(id)),
      },
    },

    contactMethods: {
      // Merged read fans out across the three typed tables; writes target one
      // typed sub-repo each.
      listForOwner: (
        type: ContactOwnerType,
        id: string,
      ): Promise<ContactMethod[]> =>
        listContactMethods(contactMethods, { type, id }),
      emails: {
        create: (input: CreateEmailInput): Promise<EmailAddress> =>
          driver.transaction(() => contactMethods.emails.create(input)),
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
          driver.transaction(() => contactMethods.phones.create(input)),
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
          driver.transaction(() => contactMethods.postals.create(input)),
        update: (
          id: string,
          input: UpdatePostalInput,
        ): Promise<PostalAddress | undefined> =>
          driver.transaction(() => contactMethods.postals.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => contactMethods.postals.softDelete(id)),
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
      findCandidates: (): Promise<DuplicateCandidate[]> =>
        notADuplicate
          .listPairs()
          .then((pairs) => duplicates.findCandidates(pairs)),
      reject: (idA: string, idB: string): Promise<void> =>
        driver.transaction(() => notADuplicate.record(idA, idB)),
    },

    // Contact import (e.g. a dropped vCard). The pure parse + format detection run
    // client-side (`@leapsake/contact-import`); this is the write half — take the
    // reviewed `ParsedContact`s and commit them through the same repos manual
    // creation uses. `preview` is the read half: flag likely-existing people so
    // the review can offer skip/merge before anything is written.
    import: {
      // Commit the reviewed decisions. The ingest engine drives the injected ports
      // below; each contact commits in its own `driver.transaction` (one bad row
      // rolls back alone), and the automated birthday reminders reconcile once
      // after the batch — the same `regenerateSystem` a manual birthday triggers,
      // so imported birthdays surface on the Home list at once.
      commit: async (decisions: ImportDecision[]): Promise<ImportResult> => {
        const ports: ImportPorts = {
          createPerson: (name, gender) =>
            people.create({
              firstName: name.firstName,
              middleName: name.middleName,
              lastName: name.lastName,
              gender,
            }),
          addEmail: async (personId, email) => {
            await contactMethods.emails.create({
              ownerType: "person",
              ownerId: personId,
              label: email.label,
              address: email.address,
            });
          },
          addPhone: async (personId, phone) => {
            await contactMethods.phones.create({
              ownerType: "person",
              ownerId: personId,
              label: phone.label,
              number: phone.number,
              extension: phone.extension,
              country: phone.country,
              smsCapable: phone.smsCapable,
            });
          },
          addPostal: async (personId, postal) => {
            await contactMethods.postals.create({
              ownerType: "person",
              ownerId: personId,
              label: postal.label,
              line1: postal.line1,
              line2: postal.line2,
              locality: postal.locality,
              region: postal.region,
              postalCode: postal.postalCode,
              country: postal.country,
            });
          },
          addBirthday: async (personId, birthday) => {
            await milestones.create({
              kind: "birthday",
              bearerType: "person",
              bearerId: personId,
              year: birthday.year,
              month: birthday.month,
              day: birthday.day,
            });
          },
          transaction: (body) => driver.transaction(body),
        };
        const result = await ingestContacts(ports, decisions);
        if (result.created > 0) await regenerateSystem();
        return result;
      },
      // Read-only: for each parsed contact, the active people it looks like, so the
      // review UI can flag likely duplicates. Never writes.
      preview: (
        contacts: ParsedContact[],
      ): Promise<{ index: number; matches: DuplicateMatch[] }[]> =>
        Promise.all(
          contacts.map(async (contact, index) => ({
            index,
            matches: await duplicates.matchContact({
              name: `${contact.name.firstName} ${contact.name.lastName}`.trim(),
              emails: contact.emails.map((e) => e.address),
              phones: contact.phones.map((p) => p.number),
            }),
          })),
        ),
    },

    // Read-and-compose view-model builders: portable fan-outs, label resolution,
    // candidate lists, and relationship-orientation reads that return plain data.
    views,
  };
}
