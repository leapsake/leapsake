import type { ApiChannel } from "./ipc-bridge.js";

/**
 * One entry per {@link import("@leapsake/core").CoreApi} method. `satisfies`
 * rejects an unknown one, and the check below a missing one.
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
  "milestones.linkPartner",
  "milestones.softDelete",

  "reminders.list",
  // Unused on desktop, which schedules no local notifications yet.
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
  // What the gift, plan and wish rows each act on, from one engine walk.
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

  // Mobile's address-book sync; listed because every method must be.
  "deviceContacts.linkedIds",
  "deviceContacts.getSyncEnabled",
  "deviceContacts.setSyncEnabled",

  // Desktop has no Export button yet; listed because every method must be.
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

// Every CoreApi method that has no channel above.
type MissingChannels = Exclude<ApiChannel, (typeof API_CHANNELS)[number]>;

// Hover `missing` in the error to see which. The tuples stop the conditional
// distributing over the union, which would make the happy path `never`.
const channelsCoverCoreApi: [MissingChannels] extends [never]
  ? true
  : {
      error: "CoreApi methods missing from API_CHANNELS";
      missing: MissingChannels;
    } = true;
void channelsCoverCoreApi;
