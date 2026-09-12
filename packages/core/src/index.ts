import {
  type DuplicateCandidate,
  type DuplicateMatch,
  type GenderResult,
  type SqliteDriver,
  type TagListItem,
  createContactMethodsRepo,
  createDeviceContactLinksRepo,
  createDismissalsRepo,
  createDuplicateService,
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
  CreateSocialInput,
  CreateRelationshipInput,
  CreateGiftIdeaInput,
  CreateGiftRecipientInput,
  CaptureGiftInput,
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
  ReminderWithTags,
  ResolvedMention,
  SearchHit,
  SelfPerson,
  GiftIdea,
  GiftPartyType,
  GiftRecipient,
  GiftRecipientEntry,
  Tag,
  UpdateEmailInput,
  UpdateMilestoneInput,
  UpdatePersonInput,
  UpdatePetInput,
  UpdatePhoneInput,
  UpdatePostalInput,
  UpdateSocialInput,
  UpdateReminderInput,
  UpdateRelationshipInput,
  UpdateGiftIdeaInput,
  UpdateGiftRecipientInput,
} from "@leapsake/schema";
import {
  baseRole,
  civilFromDueMs,
  daysUntil,
  entityLabel,
  genderedVariant,
  impliedGender,
  inverseRole,
  isPublished,
  isReminderEditable,
  isRomanticRole,
  kindDefs,
  parseHashtags,
  parseMentions,
  planOffers,
  relationshipPairLabel,
  splitName,
  resolveObservanceReminderSchedule,
  resolveReminderSchedule,
  roleDefs,
  todayCivil,
  verbOf,
} from "@leapsake/schema";
import {
  type ReminderEngineDeps,
  type ReminderWindowFacts,
  type UndatedPartnership,
  type WindowedReminder,
  DISPLAY_WINDOW_DAYS,
  duplicatesReminderId,
  getReminderInWindow,
  listNotifiableReminders,
  listRemindersInWindow,
  listSystemReminderTargets,
  materializeReminder,
  partnershipNudgeId,
  regenerateSystemReminders,
} from "@leapsake/reminders";
// The onboarding-nudge id-convention, surfaced through core (the apps' single
// entry point) so a client can map a Home reminder's id to its CTA route without
// depending on `@leapsake/reminders` directly.
export { ONBOARDING_REMINDERS, onboardingRouteOf } from "@leapsake/reminders";
export type { OnboardingReminder, OnboardingRoute } from "@leapsake/reminders";

/**
 * A reminder as the **list** reads it: the joined row plus the two timing facts
 * only the engine can supply (see `reminders.listInWindow`). Surfaced through
 * core, like the onboarding route above, so a client can type its screen without
 * depending on `@leapsake/reminders` directly.
 */
export type ReminderInWindow = ReminderWithTags & ReminderWindowFacts;
import {
  type ImportDecision,
  type ImportPorts,
  type ImportResult,
  type ParsedContact,
  ingestContacts,
  nameInputFrom,
} from "@leapsake/vcard";
import {
  type ExportArchive,
  type ExportPorts,
  buildArchive,
} from "@leapsake/export";
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

// The tag catalog's row shape, re-exported so a client's tag list binds to the
// same contract `tags.list` returns.
export type { TagListItem } from "@leapsake/data";

// Contact-import shapes, re-exported so the desktop boundary parser and the
// review UI bind to the same contract the ingest engine consumes.
export type {
  ImportDecision,
  ImportError,
  ImportResult,
  ParsedContact,
} from "@leapsake/vcard";

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
 * A gift link joined for the recipient's "Gifts" section: the row plus its idea's
 * title and url. The idea is always live (deleting an idea cascades to its
 * links), so the title is non-null.
 */
export type GiftForRecipient = GiftRecipient & {
  ideaTitle: string;
  ideaUrl: string | null;
};

/**
 * A gift link joined for an idea's "For…" section: the row plus its recipient's
 * display label. A link whose recipient is gone is dropped by the reader, so the
 * label is non-null.
 */
export type GiftForIdea = GiftRecipient & {
  recipientLabel: string;
};

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

/**
 * One row of the Gifts overview (the `/gifts` screen, keyed by idea): an idea
 * with its tags and everyone it is for, given or not.
 */
export interface GiftIdeaOverview {
  idea: GiftIdea;
  tags: Tag[];
  recipients: GiftForIdea[];
}

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
 * The entity an incoming card **is**, when its `UID` names one already stored.
 *
 * Distinct from a `DuplicateMatch`, which says an incoming card *resembles*
 * somebody. This one is an identity, established by id rather than scored: our
 * own exporter writes each entity's `people.id`/`pets.id` as the card's `UID`,
 * so a card carrying one we hold is that entity coming home. It covers pets,
 * which the duplicate detector does not, and carries `type` for that reason.
 *
 * Import still creates a **new** entity for such a card — the review's job is to
 * let the user skip it. Writing the file's ids back is a restore
 * (`plans/export.md` → 6), not this.
 */
export interface AlreadyStored {
  type: "person" | "pet";
  id: string;
  name: string;
}

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

// `keySession` is still accepted (and still optional — an Unauthenticated store has none),
// but **no repository consumes it today**: `milestone.note` was layer 3's only
// domain-field consumer and was retired on 2026-07-27 (migration 27). The
// parameter stays because photos, layer 3's real consumer, will need exactly this
// (`plans/v0-2.md`) — and because `createCore(driver, keySession?)` is what lets
// the same call site serve both custody states.
export function createCore(driver: SqliteDriver, _keySession?: KeySession) {
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
    const entity = await resolveEntity(type, id);
    return entity ? entityLabel(type, entity) : undefined;
  }

  /**
   * The entity an incoming card's `UID` names, or `null` when it names none —
   * how `import.preview` tells "this is a new person" from "this is a person you
   * already have". See {@link AlreadyStored}.
   *
   * The card's `kind` decides which table to ask, rather than both being tried:
   * ids are UUIDs, so a collision across the two is not the risk — asking the
   * wrong one is. A pet card whose id happens to name a person is a malformed
   * file, and answering "already stored: Jane Wainwright" for it would be worse than
   * answering nothing.
   */
  async function storedAs(
    contact: ParsedContact,
  ): Promise<AlreadyStored | null> {
    if (contact.uid === null) return null;
    const type = contact.kind === "pet" ? "pet" : "person";
    const entity = await resolveEntity(type, contact.uid);
    return entity === undefined
      ? null
      : { type, id: contact.uid, name: entityLabel(type, entity) };
  }

  // The row behind an endpoint, for the callers that want more of it than its
  // label — currently its `standing`. Neither `get` filters on standing, so an
  // unpublished entity resolves here like any other.
  async function resolveEntity(
    type: EntityType,
    id: string,
  ): Promise<Person | Pet | undefined> {
    return type === "person" ? people.get(id) : pets.get(id);
  }

  /** A relationship's two endpoints as `(type, id)` pairs; `[]` when it is gone. */
  function endpointsOf(
    rel: Relationship | undefined,
  ): { type: EntityType; id: string }[] {
    return rel === undefined
      ? []
      : [
          { type: rel.aType, id: rel.aId },
          { type: rel.bType, id: rel.bId },
        ];
  }

  /**
   * What to call a milestone borne by a **relationship** — "Harry & Tilly", or just
   * "Violet" for a relationship the self-person is one end of, since a reminder
   * about your own anniversary is addressed to you and names your partner.
   *
   * `undefined` only when there is no name left to use: the relationship is gone,
   * or both its endpoints are. That distinction is the whole reason this exists —
   * the reminder engine reads a null label as "the bearer is gone" and skips the
   * milestone, so answering null merely because a bearer type had no formatter
   * silently suppressed every relationship-borne reminder (see the
   * `resolveLabel` port).
   */
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
      : ((await resolveLabel(bearerType, bearerId)) ?? null);
  }

  async function relationshipLabel(id: string): Promise<string | null> {
    const rel = await relationships.get(id);
    if (rel === undefined) return null;
    const selfId = (await self.getSelf())?.personId;
    const ends = endpointsOf(rel).filter(
      (e) => !(e.type === "person" && e.id === selfId),
    );
    const named = (
      await Promise.all(ends.map((e) => resolveLabel(e.type, e.id)))
    ).filter((label): label is string => label !== undefined);
    if (named.length === 0) return null;
    // One name is the ordinary case for a relationship you are in, and also what
    // a half-deleted pair degrades to — better a reminder naming whoever is left
    // than none at all.
    return named.length === 1
      ? named[0]
      : relationshipPairLabel(named[0], named[1]);
  }

  const softDeleteEntity = (type: EntityType, id: string): Promise<void> =>
    type === "person" ? people.softDelete(id) : pets.softDelete(id);

  /**
   * Soft-delete every fact hanging off an entity.
   *
   * The list the Person and Pet cascades share, in one place so the two cannot
   * drift apart — and so the unpublished-entity cascade below sweeps exactly what
   * a deliberate delete would. Contact methods are the one asymmetry: only a
   * person owns them.
   *
   * Transaction-free, like the repo building blocks it calls; every caller is
   * already inside one.
   */
  async function removeEntityFacts(
    type: EntityType,
    id: string,
  ): Promise<void> {
    await tags.removeAllForEntity(type, id);
    await relationships.removeAllForEntity(type, id);
    await dismissals.removeAllForEntity(type, id);
    await milestones.removeAllForEntity(type, id);
    if (type === "person") {
      await contactMethods.removeAllForOwner("person", id);
    }
    await observances.removeAllForBearer(type, id);
    await giftRecipients.removeAllForRecipient(type, id);
  }

  /**
   * The entities that exist only because this one does: the unpublished ends of
   * its explicit relationships.
   *
   * **Must be read before the relationships are removed**, because the edge is
   * the only thing identifying such an entity as belonging to this one.
   */
  async function attachedUnpublished(
    type: EntityType,
    id: string,
  ): Promise<{ type: EntityType; id: string }[]> {
    const rows = await relationships.listForEntity(type, id);
    const attached: { type: EntityType; id: string }[] = [];
    for (const rel of rows) {
      const subjectIsA = rel.aType === type && rel.aId === id;
      const end = {
        type: subjectIsA ? rel.bType : rel.aType,
        id: subjectIsA ? rel.bId : rel.aId,
      };
      const other = await resolveEntity(end.type, end.id);
      if (other !== undefined && !isPublished(other.standing)) {
        attached.push(end);
      }
    }
    return attached;
  }

  /**
   * Soft-delete an entity, its facts, and anyone who existed only as a fact
   * about it.
   *
   * A coworker's wife recorded as a name on his relationship is not a person the
   * user has any other way to reach; leaving her behind when he goes would strand
   * a row nothing links to. So she goes too — the deliberate counterpart of the
   * catalog rule that keeps her out of every list in the first place.
   *
   * One level deep, and that is not an approximation: an unpublished entity holds
   * exactly one explicit relationship, to a published one, so there is never a
   * second rung to walk down.
   */
  async function softDeleteEntityCascade(
    type: EntityType,
    id: string,
  ): Promise<void> {
    const attached = await attachedUnpublished(type, id);
    await softDeleteEntity(type, id);
    await removeEntityFacts(type, id);
    for (const other of attached) {
      await softDeleteEntity(other.type, other.id);
      await removeEntityFacts(other.type, other.id);
    }
  }

  /**
   * Publish an entity that has just stopped being only a fact about someone else.
   *
   * The rule the whole feature turns on: an unpublished entity is one that is
   * nothing but a name on somebody's relationship, so the moment it acquires a
   * fact of its own — a birthday, a gender, a contact method, a tag, a second
   * relationship — it is no longer that, and belongs in the catalog. Every core
   * write that records such a fact calls this, which is why the user never meets
   * the idea: they fill something in, and the person is simply there afterwards.
   *
   * A no-op for the overwhelmingly common case of an already-published entity,
   * and for the derived readings (a gender inferred from a role) that store
   * nothing and so make nobody more than they were.
   *
   * Transaction-free: callers fold it into the transaction of the write that
   * triggered it, so the fact and the promotion land together or not at all.
   */
  async function publishIfUnpublished(
    type: EntityType,
    id: string,
  ): Promise<void> {
    const entity = await resolveEntity(type, id);
    if (entity === undefined || isPublished(entity.standing)) return;
    if (type === "person") {
      await people.update(id, { standing: "published" });
    } else {
      await pets.update(id, { standing: "published" });
    }
  }

  /**
   * Whether an edit to an entity's own row makes it more than a name.
   *
   * A name is the one thing an unpublished entity is *allowed* to have, so
   * correcting "Ruth" to "Ruth Dakin" leaves her exactly what she was. Anything
   * else on the row — a gender, a pet's species — is a fact of her own, and so is
   * a tag, which arrives beside the patch rather than in it.
   *
   * A patch that names `standing` itself is left alone: the caller has said what
   * they want, and inferring over the top of that would make an explicit demotion
   * impossible to write.
   */
  function promotes(
    input: Record<string, unknown>,
    nameFields: readonly string[],
    tagNames: readonly string[],
  ): boolean {
    if ("standing" in input) return false;
    return (
      tagNames.length > 0 ||
      Object.keys(input).some((field) => !nameFields.includes(field))
    );
  }

  /** Milestones and observances also bear on relationships, which have no
   *  standing of their own; only a person or a pet can be promoted. */
  const publishBearerIfUnpublished = (
    type: string,
    id: string,
  ): Promise<void> =>
    type === "person" || type === "pet"
      ? publishIfUnpublished(type, id)
      : Promise.resolve();

  // An idea's links joined with each recipient's current label (a link whose
  // recipient is gone is dropped). Shared by the idea's "For…" section and the
  // Gifts overview.
  async function giftRecipientsForIdea(ideaId: string): Promise<GiftForIdea[]> {
    const rows = await giftRecipients.listForIdea(ideaId);
    const joined = await Promise.all(
      rows.map(async (row) => {
        const recipientLabel = await resolveLabel(
          row.recipientType,
          row.recipientId,
        );
        if (recipientLabel === undefined) return null;
        return { ...row, recipientLabel };
      }),
    );
    return joined.filter((row): row is GiftForIdea => row !== null);
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
      const other = await resolveEntity(otherType, otherId);
      if (other === undefined) continue; // other end gone — skip
      neighbors.push({
        relationshipId: rel.id,
        otherType,
        otherId,
        otherLabel: entityLabel(otherType, other),
        otherStanding: other.standing,
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
    return driver.transaction(async () => {
      const created = await relationships.create({
        aType: input.subjectType,
        aId: input.subjectId,
        aRole: inverseRole(input.otherRole),
        bType: input.otherType,
        bId: input.otherId,
        bRole: input.otherRole,
        bRoleNote: input.otherRoleNote ?? null,
      });
      // An unpublished entity holds exactly one relationship — the one it was
      // created with. Either end reaching here is therefore an end acquiring a
      // *second*, which is a connection of its own and more than being a name on
      // somebody else's page. Note this is how the invariant is kept: by
      // promoting, not by refusing. `createWithNewOther` writes the first edge
      // without coming through here, which is why it doesn't trip this.
      await publishIfUnpublished(input.subjectType, input.subjectId);
      await publishIfUnpublished(input.otherType, input.otherId);
      return created;
    });
  }

  /**
   * Record a relationship to somebody who isn't in the user's list — creating
   * them, unpublished, as part of the same write.
   *
   * This is the way an unpublished entity comes into being, and the only one:
   * you type a name into the relationship form, nothing matches it, and you save.
   * What you get is a person (or pet) that exists as a fact about the subject —
   * absent from People & Pets, from every picker, and from duplicate detection —
   * plus the single relationship that is their entire reason for being there.
   *
   * One transaction, because half of this is nothing: an entity with no edge is
   * unreachable, and an edge to nobody is not writable.
   *
   * The name is taken **verbatim** for a pet and split on the first space for a
   * person, the same rule the vCard reader falls back on for a bare `FN`. Nothing
   * cleverer: "Ruth" and "Ruth Dakin" are both whole names now, so there is no
   * missing part to guess at, and a two-word name that isn't first-and-last is
   * one edit away from being right on the person's own page.
   */
  function createWithNewOther(input: {
    subjectType: EntityType;
    subjectId: string;
    otherType: EntityType;
    otherName: string;
    otherRole: RelationshipRole;
    otherRoleNote?: string | null;
  }): Promise<{ other: Person | Pet; relationship: Relationship }> {
    return driver.transaction(async () => {
      const name = input.otherName.trim();
      const other =
        input.otherType === "person"
          ? await people.create({ ...splitName(name), standing: "unpublished" })
          : await pets.create({ name, standing: "unpublished" });
      const relationship = await relationships.create({
        aType: input.subjectType,
        aId: input.subjectId,
        aRole: inverseRole(input.otherRole),
        bType: input.otherType,
        bId: other.id,
        bRole: input.otherRole,
        bRoleNote: input.otherRoleNote ?? null,
      });
      return { other, relationship };
    });
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

  /** The unresolved duplicate candidates: every scoring pass, minus the pairs a
   *  device has already been told are not the same. The one place the exclusion
   *  is applied — `duplicates.*` and the Home nudge both come through here. */
  function findDuplicateCandidates(): Promise<DuplicateCandidate[]> {
    return notADuplicate
      .listPairs()
      .then((pairs) => duplicates.findCandidates(pairs));
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
      const partnerLabel = await resolveLabel(other.type, other.id);
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

  /** The same candidates as canonical `"lower:higher"` pair keys — the identity
   *  the Home nudge is content-addressed on (names never leave this layer). */
  async function duplicatePairKeys(): Promise<string[]> {
    const candidates = await findDuplicateCandidates();
    return candidates.map(({ a, b }) =>
      a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`,
    );
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
    // invitation; a relay-connected account (a `relayUrl` on the singleton) gates
    // the sign-in step; `hasSelf` gates the "pick yourself" step. All retire
    // (prune) automatically once satisfied — see `@leapsake/reminders`
    // ONBOARDING_STEPS.
    //
    // `isSyncConnected` and `hasAccount` are two reads of the same singleton and
    // stay separate on purpose: the account exists as soon as one is created, but
    // `relayUrl` is set only when it is also bound to a relay, and a local-only
    // account is the case that tells them apart.
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
      isSyncConnected: async () =>
        (await getSyncStatus({ driver })).relayUrl !== undefined,
      hasSelf: async () => (await self.getSelf()) !== undefined,
      hasAccount: async () => (await getSyncStatus({ driver })).hasAccount,
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
    // Unresolved duplicate pairs — the fourth family. Always supplied, for the
    // same reason `holidays` is: an omitted port prunes (and tombstones) the
    // nudge the last reconcile minted.
    duplicates: { pairKeys: () => duplicatePairKeys() },
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
              await publishIfUnpublished("person", id);
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
      // Soft-delete the person and cascade across every fact that references it,
      // and across anyone who existed only as a fact about them — see
      // `softDeleteEntityCascade`. The cascade removes their milestones, so
      // reconcile afterwards to prune any now-orphaned birthday reminder at once
      // (same reason a milestone delete does — see `milestones.softDelete`),
      // rather than leaving it until boot/focus.
      softDelete: async (id: string): Promise<void> => {
        await driver.transaction(() => softDeleteEntityCascade("person", id));
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
          await giftRecipients.repointRecipient("person", loserId, survivorId);
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
              await publishIfUnpublished("pet", id);
            }
          }
          return pet;
        }),
      // Cascade-delete the pet's facts, then reconcile so its birthday reminder is
      // pruned at once (see the Person `softDelete` above for the rationale).
      softDelete: async (id: string): Promise<void> => {
        await driver.transaction(() => softDeleteEntityCascade("pet", id));
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
          await publishBearerIfUnpublished(
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
            const entity = await resolveEntity(end.type, end.id);
            if (entity === undefined || isPublished(entity.standing)) continue;
            await softDeleteEntity(end.type, end.id);
            await removeEntityFacts(end.type, end.id);
          }
        });
        await regenerateSystem();
      },
      // Orient each stored row to the subject and resolve the *other* end's
      // label + role, so the caller never sees the raw a/b endpoints.
      listForEntity: (
        type: EntityType,
        id: string,
      ): Promise<RelationshipNeighbor[]> => orientedNeighbors(type, id),
      // Write a relationship from a subject's perspective, implying the subject's
      // own role from the chosen other role. See {@link createFromSubject}.
      //
      // These three reconcile afterwards for the same reason `create`/`update`
      // above do — and they are the ones that matter in practice, since this is
      // the path a relationship is actually added by, from a person's own page.
      // Wrapped here rather than inside each helper because the milestone
      // "with whom?" flow calls them mid-write and reconciles once, after its
      // own commit.
      createFromSubject: async (
        ...args: Parameters<typeof createFromSubject>
      ): Promise<Relationship> => {
        const created = await createFromSubject(...args);
        await regenerateSystem();
        return created;
      },
      // The same, for an other end that doesn't exist yet: creates them
      // unpublished alongside the edge. See {@link createWithNewOther}.
      createWithNewOther: async (
        ...args: Parameters<typeof createWithNewOther>
      ): Promise<{ other: Person | Pet; relationship: Relationship }> => {
        const created = await createWithNewOther(...args);
        await regenerateSystem();
        return created;
      },
      // Edit a subject-scoped relationship, re-deriving the subject's own role.
      // See {@link editFromSubject}.
      editFromSubject: async (
        ...args: Parameters<typeof editFromSubject>
      ): Promise<Relationship | undefined> => {
        const updated = await editFromSubject(...args);
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
          await publishBearerIfUnpublished(
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
      // Put this off, ask me later: sets the snooze clock and spends one
      // repetition of the nag budget, atomically. One generic verb for both
      // cases — a user hiding their own reminder, and the product accepting
      // "not now" on an onboarding nudge — because the row write is identical
      // and only the choice of date differs.
      //
      // That date is the **caller's**: the offered action already carries the
      // one `snoozePolicyOf` returned, so re-deriving it here would be a second
      // evaluation that disagrees with the copy the user just read whenever a
      // dial changes. Most reminders have no policy at all, so there is nothing
      // to validate against in the general case.
      //
      // Deliberately skips `isReminderEditable`, the way `setCompleted` does:
      // snoozing is not a content edit, so it stays open on `system` rows —
      // which is the whole point, those being its first consumer. Text is
      // untouched, so no tags/mentions to re-derive.
      snooze: (id: string, until: number): Promise<Reminder | undefined> =>
        driver.transaction(() => reminders.snooze(id, until)),
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
                  await reminderRules.listForBearer(
                    "milestone",
                    t.milestone!.id,
                  ),
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
            subject: (await resolveLabel("person", t.bearerId)) ?? "",
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
    },

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
    // `reminders.snooze(id, until)` takes an explicit id.
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
    gifts: {
      ideas: {
        list: (): Promise<GiftIdea[]> => giftIdeas.list(),
        get: (id: string): Promise<GiftIdea | undefined> => giftIdeas.get(id),
        // Single-payload create (share-target ready): capture an idea and,
        // optionally, attach it to zero-to-many people or pets in one
        // transaction. `tagNames` rides along the same way a Person's does — the
        // whole desired set, committed with the row.
        create: (
          {
            recipients,
            ...ideaInput
          }: CreateGiftIdeaInput & { recipients?: GiftRecipientEntry[] },
          tagNames?: string[],
        ): Promise<GiftIdea> =>
          driver.transaction(async () => {
            const idea = await giftIdeas.create(ideaInput);
            for (const entry of recipients ?? []) {
              await giftRecipients.create({ giftIdeaId: idea.id, ...entry });
            }
            if (tagNames) {
              await tags.setEntityTags("gift_idea", idea.id, tagNames);
            }
            return idea;
          }),
        // An **omitted** `tagNames` leaves the idea's tags alone; passing the
        // array makes them exactly that set (`[]` clears them), so a caller that
        // only renames an idea can't silently drop its tags.
        update: (
          id: string,
          input: UpdateGiftIdeaInput,
          tagNames?: string[],
        ): Promise<GiftIdea | undefined> =>
          driver.transaction(async () => {
            const idea = await giftIdeas.update(id, input);
            if (idea && tagNames) {
              await tags.setEntityTags("gift_idea", id, tagNames);
            }
            return idea;
          }),

        // Removing an idea cascades to its recipient links and taggings —
        // nothing references a deleted idea, and a live link must always point at
        // a live idea.
        softDelete: (id: string): Promise<void> =>
          driver.transaction(async () => {
            await giftIdeas.softDelete(id);
            await giftRecipients.removeAllForIdea(id);
            await tags.removeAllForEntity("gift_idea", id);
          }),
      },

      // The links themselves — an idea paired with a person or pet, ticked or
      // not. This was two namespaces, `suggestions` and `given`, back when a
      // giving was a separate dated row; "has it been given" is now a column, so
      // it is one namespace with a `setGiven`.
      recipients: {
        // A party's "Gifts" section: each link joined with its idea's title/url.
        // A link whose idea is somehow gone is dropped (defensive — the idea
        // cascade prevents it).
        listForRecipient: async (
          type: GiftPartyType,
          id: string,
        ): Promise<GiftForRecipient[]> => {
          const rows = await giftRecipients.listForRecipient(type, id);
          const joined = await Promise.all(
            rows.map(async (row) => {
              const idea = await giftIdeas.get(row.giftIdeaId);
              if (idea === undefined) return null;
              return { ...row, ideaTitle: idea.title, ideaUrl: idea.url };
            }),
          );
          return joined.filter((row): row is GiftForRecipient => row !== null);
        },
        // An idea's "For…" section: each link joined with its recipient's current
        // label (dropped when the recipient is gone).
        listForIdea: (ideaId: string): Promise<GiftForIdea[]> =>
          giftRecipientsForIdea(ideaId),
        // Attaching a gift to someone is a fact about them, so it publishes an
        // unpublished party the same way a milestone or a contact method does.
        create: (input: CreateGiftRecipientInput): Promise<GiftRecipient> =>
          driver.transaction(async () => {
            await publishBearerIfUnpublished(input.party.type, input.party.id);
            return giftRecipients.create(input);
          }),
        // Tick or untick the box — the only edit a link has, which is why it is
        // the ordinary `update` rather than a `setGiven`: anything else would
        // fall outside `withSyncKick`'s mutating-method predicate and a ticked
        // box would never kick a sync. The repo makes it a no-op when the row
        // already says so, so this is safe to call from a checkbox that doesn't
        // track its own previous state.
        update: (
          id: string,
          input: UpdateGiftRecipientInput,
        ): Promise<GiftRecipient | undefined> =>
          driver.transaction(() => giftRecipients.update(id, input)),
        softDelete: (id: string): Promise<void> =>
          driver.transaction(() => giftRecipients.softDelete(id)),
      },

      // The one consolidated create: an idea (existing or minted) captured with
      // zero-to-many recipients, all in one transaction. No recipients ⇒ just the
      // idea; each recipient ⇒ one link, ticked or not. Returns the resolved
      // idea.
      capture: (input: CaptureGiftInput): Promise<GiftIdea> =>
        driver.transaction(async () => {
          // Resolve (or mint) the idea once, so N links to a new idea don't mint
          // N ideas.
          let idea: GiftIdea;
          if ("id" in input.giftIdea) {
            const found = await giftIdeas.get(input.giftIdea.id);
            if (found === undefined) throw new Error("gift idea not found");
            idea = found;
          } else {
            idea = await giftIdeas.create({
              title: input.giftIdea.title,
              url: input.giftIdea.url ?? null,
            });
          }

          for (const entry of input.recipients) {
            // Being someone to give something to is a fact about the recipient.
            await publishBearerIfUnpublished(entry.party.type, entry.party.id);
            // Capture is an *add* surface — it can name an existing idea — so a
            // party already on this idea is updated rather than doubled. Ticking
            // is one-way here: capture says "and I gave them this", never "and I
            // did not", which is the checkbox's job on a row that already exists.
            const existing = (await giftRecipients.listForIdea(idea.id)).find(
              (row) =>
                row.recipientType === entry.party.type &&
                row.recipientId === entry.party.id,
            );
            if (existing !== undefined) {
              if (entry.given === true) {
                await giftRecipients.update(existing.id, { given: true });
              }
              continue;
            }
            await giftRecipients.create({ giftIdeaId: idea.id, ...entry });
          }

          return idea;
        }),

      // The Gifts screen, keyed by idea: every idea with everyone it is for.
      // Ideas keep their newest-first list order.
      overview: async (): Promise<GiftIdeaOverview[]> => {
        const ideas = await giftIdeas.list();
        return Promise.all(
          ideas.map(async (idea) => ({
            idea,
            tags: await tags.listForEntity("gift_idea", idea.id),
            recipients: await giftRecipientsForIdea(idea.id),
          })),
        );
      },
    },

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
            await publishBearerIfUnpublished(input.ownerType, input.ownerId);
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
            await publishBearerIfUnpublished(input.ownerType, input.ownerId);
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
            await publishBearerIfUnpublished(input.ownerType, input.ownerId);
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
            await publishBearerIfUnpublished(input.ownerType, input.ownerId);
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
      findCandidates: findDuplicateCandidates,
      /**
       * The candidates involving one person — what the review screen shows when
       * it is scoped to a just-created person, and what a person's own page asks
       * before deciding whether to warn. A filter over the full scan rather than
       * its own query: the scan is the same O(n²) in-memory pass either way at
       * personal-CRM scale, and reusing it keeps the `not_a_duplicate` memory and
       * the tier/sort rules in exactly one place.
       */
      findFor: async (personId: string): Promise<DuplicateCandidate[]> =>
        (await findDuplicateCandidates()).filter(
          (c) => c.a.id === personId || c.b.id === personId,
        ),
      /** How many pairs are outstanding — the count the clients gate their
       *  "N possible duplicates" links on, without shipping the whole list. */
      count: async (): Promise<number> =>
        (await findDuplicateCandidates()).length,
      /**
       * The id of the Home nudge for today's outstanding pairs, or `null` when
       * there are none. Clients match it against the reminder list to hang the
       * "Review" CTA on that row — the id-convention, but recomputed rather than
       * static because the nudge is content-addressed on the pair set (see
       * `duplicatesReminderId`).
       */
      nudgeId: async (): Promise<string | null> => {
        const keys = await duplicatePairKeys();
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
          neighborsFor: (type, id) => orientedNeighbors(type, id),
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
    import: {
      // Commit the reviewed decisions. The ingest engine drives the injected ports
      // below; each contact commits in its own `driver.transaction` (one bad row
      // rolls back alone), and the automated birthday reminders reconcile once
      // after the batch — the same `regenerateSystem` a manual birthday triggers,
      // so imported birthdays surface on the Home list at once.
      commit: async (decisions: ImportDecision[]): Promise<ImportResult> => {
        const ports: ImportPorts = {
          createPerson: (name, gender) =>
            // Through `nameInputFrom`, not field-by-field: a card's blank part
            // is `""`, and the Person schema spells absent as `null`. Handing it
            // the raw strings would fail `min(1)` on exactly the mononym and
            // organisation-only cards this import is meant to accept.
            people.create({ ...nameInputFrom(name), gender }),
          // `petSchema` is a single `name`, so one slot of the card's name has
          // to be it — the first, which is the mononym shape `toPetContact`
          // writes on the way out. The surname fallback is for the one card our
          // own writer never produces but a hand-made one might (`N:Jimmy;;;;`,
          // which `deriveName` reads as a surname-only person): without it that
          // pet is refused mid-batch by `petSchema`'s `min(1)`, which is a
          // confusing way to lose a row. The engine has already refused a card
          // with no name at all, so the final `?? ""` is unreachable.
          createPet: (name, gender) => {
            const parts = nameInputFrom(name);
            return pets.create({
              name: parts.firstName ?? parts.lastName ?? "",
              gender,
            });
          },
          // The same call `people.create`/`pets.create` make for a manually
          // created entity — but over the raw repo, with no `driver.transaction`
          // of its own, because the engine has already opened one and the
          // driver's BEGIN/COMMIT does not nest.
          addTags: async (entityType, entityId, names) => {
            await tags.setEntityTags(entityType, entityId, names);
          },
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
          addSocial: async (personId, social) => {
            await contactMethods.socials.create({
              ownerType: "person",
              ownerId: personId,
              label: social.label,
              platform: social.platform,
              handle: social.handle,
              url: social.url,
              // Only ever set for a card we wrote, which is the whole reason the
              // writer emits it: the platform keys DMs on an id it does not
              // publish beside the handle, so it is unrecoverable from the rest
              // of the row and would otherwise be the one thing a backup lost.
              platformUserId: social.platformUserId,
            });
          },
          // The bearer's type comes from the engine rather than being assumed —
          // a pet's card carries a birthday too. Hardcoding `"person"` here did
          // not fail loudly the way `addRelated`'s did: a pet birthday committed
          // against `bearer_type = 'person'` and then went missing from the pet,
          // because `listForBearer("pet", …)` could never find it.
          addBirthday: async (bearerType, bearerId, birthday) => {
            await milestones.create({
              kind: "birthday",
              bearerType,
              bearerId,
              year: birthday.year,
              month: birthday.month,
              day: birthday.day,
            });
          },
          // The kind and the bearer are both settled before this runs — the
          // parser read the kind off the card (or resolved it from the label for
          // a foreign one), and the engine chose the bearer and checked that the
          // kind may be held by it. This only writes the row.
          addDate: async (bearerType, bearerId, date) => {
            await milestones.create({
              kind: date.kind,
              bearerType,
              bearerId,
              year: date.date.year,
              month: date.date.month,
              day: date.date.day,
              // The card's own `-NOTE` wins; the label is the fallback, because
              // the writer deliberately omits the parameter when the note *is*
              // the label — which is what it means on an `other`-kind milestone.
              // The parser already applies that fallback, so this is what keeps
              // a hand-built IPC payload honest.
              note: date.note ?? (date.kind === "other" ? date.label : null),
            });
          },
          // Somebody the card merely named becomes an unpublished person with
          // one edge — the same thing `relationships.createWithNewOther` makes,
          // spelled over the raw repos because the engine is already inside a
          // transaction and the driver's BEGIN/COMMIT doesn't nest.
          addRelated: async (ownerType, ownerId, relation) => {
            const other = await people.create({
              ...splitName(relation.name),
              standing: "unpublished",
            });
            await relationships.create({
              // The owner's own type, not a hardcoded `"person"` — a pet's card
              // carries relations too, and `holderAllows` refuses a mismatch
              // outright rather than writing a wrong row quietly.
              aType: ownerType,
              aId: ownerId,
              aRole: inverseRole(relation.role),
              bType: "person",
              bId: other.id,
              bRole: relation.role,
              bRoleNote: relation.roleNote,
            });
          },
          // Both ends already exist, so unlike `addRelated` there is nobody to
          // create — just the edge. Spelled over the raw repo rather than through
          // `createFromSubject`, which opens a transaction of its own and would
          // also run the promotion rule; both ends came from cards of their own
          // and are already published.
          linkExisting: async (
            ownerType,
            ownerId,
            otherType,
            otherId,
            relation,
          ) => {
            // The new row's id goes back to the engine: a milestone this edge
            // bears names the id the edge had *in the file*, and the map between
            // the two is built out of these.
            const row = await relationships.create({
              aType: ownerType,
              aId: ownerId,
              aRole: inverseRole(relation.role),
              bType: otherType,
              bId: otherId,
              bRole: relation.role,
              bRoleNote: relation.roleNote,
            });
            return { id: row.id };
          },
          // The raw repo, not `core.self.set` — that one runs its own
          // `regenerateSystem`, which the batch already does once at the end,
          // and it would fire inside the engine's transaction.
          setSelf: async (personId) => {
            await self.setSelf(personId);
          },
          // Only a phone import carries a source; the engine calls this inside
          // the contact's transaction, and the table's primary key refusing a
          // second link is what rolls a racing duplicate back.
          linkSource: (sourceId, entity) =>
            deviceContactLinks.link(sourceId, entity),
          transaction: (body) => driver.transaction(body),
        };
        const result = await ingestContacts(ports, decisions);
        if (result.created > 0) await regenerateSystem();
        return result;
      },
      /**
       * Read-only: for each parsed contact, what the review needs to warn about
       * before anything is written — the active people it *resembles*, and
       * whether it **is** somebody already stored. Never writes.
       *
       * The two are deliberately separate answers. `matches` is
       * `matchContact`'s resemblance score over names and contact methods;
       * `alreadyStored` is an id lookup, and an id is not a resemblance. Folding
       * the second into the first would mean saying "very likely already in
       * Leapsake" about a certainty, and would have nowhere to put a **pet** —
       * `DuplicateMatch.personId` cannot honestly hold a pet's id, and the
       * duplicate detector's pool is published people alone.
       *
       * This is what stops a user re-importing their own export from getting a
       * second copy of everyone: our own cards carry the `people.id`/`pets.id`
       * they came from as their `UID`, so the match is exact rather than
       * guessed. A `get` excludes soft-deleted rows on purpose — somebody the
       * user deleted and then re-imported should come back as new, not as a
       * clash with a tombstone.
       */
      preview: (
        contacts: ParsedContact[],
      ): Promise<
        {
          index: number;
          matches: DuplicateMatch[];
          alreadyStored: AlreadyStored | null;
        }[]
      > =>
        Promise.all(
          contacts.map(async (contact, index) => ({
            index,
            matches: await duplicates.matchContact({
              name: `${contact.name.firstName} ${contact.name.lastName}`.trim(),
              emails: contact.emails.map((e) => e.address),
              phones: contact.phones.map((p) => p.number),
              handles: contact.socials.map((s) => ({
                platform: s.platform,
                handle: s.handle,
              })),
            }),
            alreadyStored: await storedAs(contact),
          })),
        ),
    },

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
