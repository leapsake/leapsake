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

  "tags.get",
  "tags.softDelete",
  "tags.listForPerson",
  "tags.listForPet",
  "tags.peopleForTag",
  "tags.petsForTag",
  "tags.remindersForTag",

  "holidays.list",
  "holidays.get",
  "holidays.listObservers",
  "holidays.setObservers",
  "holidays.setHidden",

  "relationships.get",
  "relationships.create",
  "relationships.update",
  "relationships.softDelete",
  "relationships.listForEntity",
  "relationships.createFromSubject",
  "relationships.editFromSubject",

  "milestones.listForBearer",
  "milestones.timelineFor",
  "milestones.reminderSchedule",
  "milestones.create",
  "milestones.update",
  "milestones.softDelete",

  "reminders.list",
  "reminders.get",
  "reminders.create",
  "reminders.update",
  "reminders.setCompleted",
  "reminders.softDelete",
  "reminders.regenerateSystem",
  "reminders.mentioning",

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

  "kinship.neighborsFor",
  "kinship.genderFor",
  "kinship.dismiss",
  "kinship.undismiss",

  "search.query",

  "duplicates.findCandidates",
  "duplicates.reject",

  "import.preview",
  "import.commit",

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
