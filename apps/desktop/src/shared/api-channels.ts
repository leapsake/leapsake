import type { ApiChannel } from "./ipc-bridge.js";

/**
 * The single source of truth for the desktop IPC surface: one dotted-path entry
 * per {@link import("@leapsake/core").CoreApi} method. The `satisfies` clause
 * rejects any entry that names no real method, and the exhaustiveness assertion
 * below rejects any method left off the list — so the main-process handlers
 * (`registerCoreHandlers`) and the renderer wrappers (`buildBridgeApi`) both stay
 * in lockstep with core, the way `satisfies CoreApi` kept the old hand-written
 * preload object honest.
 *
 * Adding a core method? Add its dotted path here and the bridge picks it up on
 * both sides; forget, and `_assertAllMethodsListed` fails the typecheck.
 */
export const API_CHANNELS = [
  "people.list",
  "people.get",
  "people.create",
  "people.update",
  "people.softDelete",
  "people.merge",

  "pets.list",
  "pets.get",
  "pets.create",
  "pets.update",
  "pets.softDelete",

  "tags.list",
  "tags.get",
  "tags.softDelete",
  "tags.listForPerson",
  "tags.listForPet",
  "tags.peopleForTag",
  "tags.petsForTag",
  "tags.remindersForTag",
  "tags.giftIdeasForTag",
  "tags.listForGiftIdea",

  "holidays.list",
  "holidays.get",
  "holidays.occurrencesIn",
  "holidays.listObservers",
  "holidays.listForBearer",
  "holidays.setObservers",
  "holidays.setHidden",
  "holidays.getObservanceSchedule",
  "holidays.setObservanceSchedule",

  "relationships.get",
  "relationships.create",
  "relationships.update",
  "relationships.softDelete",
  "relationships.listForEntity",
  "relationships.createFromSubject",
  "relationships.createWithNewOther",
  "relationships.editFromSubject",

  "milestones.listForBearer",
  "milestones.timelineFor",
  "milestones.reminderSchedule",
  "milestones.create",
  "milestones.update",
  "milestones.softDelete",

  "reminders.list",
  // Exposed for completeness, unused by the desktop client today: it schedules
  // no local notifications yet, and this read exists to feed that planner.
  "reminders.listNotifiable",
  "reminders.listInWindow",
  "reminders.getInWindow",
  "reminders.get",
  "reminders.create",
  "reminders.update",
  "reminders.setCompleted",
  "reminders.snooze",
  "reminders.softDelete",
  "reminders.regenerateSystem",
  // One read behind every affordance the rows carry — gifts, prompts, and the
  // ways to reach a `wish`'s person. Three filters over one engine walk.
  "reminders.targets",
  "reminders.mentioning",

  "self.get",
  "self.set",
  "self.clear",

  "notificationSettings.get",
  "notificationSettings.list",
  "notificationSettings.setPolicy",
  "notificationSettings.setPermissionState",

  "gifts.ideas.list",
  "gifts.ideas.get",
  "gifts.ideas.create",
  "gifts.ideas.update",
  "gifts.ideas.softDelete",
  "gifts.recipients.listForRecipient",
  "gifts.recipients.listForIdea",
  "gifts.recipients.create",
  "gifts.recipients.update",
  "gifts.recipients.softDelete",
  "gifts.capture",
  "gifts.overview",

  "contactMethods.listForOwner",
  "contactMethods.emails.create",
  "contactMethods.emails.update",
  "contactMethods.emails.softDelete",
  "contactMethods.phones.create",
  "contactMethods.phones.update",
  "contactMethods.phones.softDelete",
  "contactMethods.postals.create",
  "contactMethods.postals.update",
  "contactMethods.postals.softDelete",
  "contactMethods.socials.create",
  "contactMethods.socials.update",
  "contactMethods.socials.softDelete",

  "kinship.neighborsFor",
  "kinship.genderFor",
  "kinship.dismiss",
  "kinship.undismiss",

  "search.query",

  "duplicates.findCandidates",
  "duplicates.findFor",
  "duplicates.count",
  "duplicates.nudgeId",
  "duplicates.reject",

  "import.preview",
  "import.commit",

  // The channel, not the surface: desktop has no Export button yet (that is
  // `plans/export.md` increment 6, after mobile GA), but the exhaustiveness
  // assertion below is what keeps this list honest, so a core method reaches it
  // the moment core grows one.
  "export.archive",

  "views.entityList",
  "views.candidates",
  "views.relationshipNew",
  "views.person",
  "views.pet",
  "views.relationship",
  "views.relationshipPartners",
  "views.relationshipForSubject",
  "views.derivedRelationship",
  "views.milestoneBearer",
  "views.milestoneNew",
] as const satisfies readonly ApiChannel[];

// Every CoreApi method that has no channel above. Wrapping both sides in a tuple
// stops the conditional from distributing over the union (so the `never` happy
// path stays `true`, not `never`).
type MissingChannels = Exclude<ApiChannel, (typeof API_CHANNELS)[number]>;

// Fails the typecheck if any CoreApi method is missing from API_CHANNELS; hover
// `missing` in the error to see which.
const channelsCoverCoreApi: [MissingChannels] extends [never]
  ? true
  : {
      error: "CoreApi methods missing from API_CHANNELS";
      missing: MissingChannels;
    } = true;
void channelsCoverCoreApi;
