import { genderLabel } from "@leapsake/schema";
import type { Messages } from "./types.js";

/** Join a list the way English does. `Intl.ListFormat` handles the rest later. */
const list = (items: readonly string[]) => items.join(", ");

/**
 * The English catalog — the only one, for now.
 *
 * Plural branches live here rather than in components on purpose: English needs
 * two forms, other languages need up to six, and a catalog can reach for
 * `Intl.PluralRules` without a single component changing.
 *
 * Gender values are sourced from `@leapsake/schema`'s table so desktop, mobile
 * and this package can't disagree about them today. That table is itself English,
 * and mobile reads it directly — translating it is part of the wider i18n
 * workstream, not something this catalog can do alone.
 */
export const en: Messages = {
  common: {
    edit: "Edit",
    remove: "Remove",
    delete: "Delete",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    none: "—",
    saveFailed: (error) => `Couldn’t save: ${error}`,
  },

  breadcrumbs: {
    label: "Breadcrumb",
  },

  combobox: {
    added: (label) => `${label} added`,
    suggestionCount: (count) =>
      count === 1 ? "1 suggestion" : `${count} suggestions`,
    resultCount: (count) => (count === 1 ? "1 result" : `${count} results`),
  },

  gender: {
    fieldLabel: "Gender",
    female: genderLabel.female,
    male: genderLabel.male,
    nonbinary: genderLabel.nonbinary,
  },

  tags: {
    title: "Tags",
    edit: "Edit tags",
    empty: "No tags yet.",
  },

  mentionedIn: {
    title: "Mentioned in",
    empty: "Not mentioned in any reminders.",
  },

  milestones: {
    title: "Milestones",
    add: "Add milestone",
    columnMilestone: "Milestone",
    columnDate: "Date",
    empty: "No milestones yet.",
    view: "View",
    setSpouse: "Set spouse",
    withPartner: (milestoneLabel, partner) =>
      `${milestoneLabel} · with ${partner}`,
  },

  relationships: {
    title: "Relationships",
    add: "Add relationship",
    columnName: "Name",
    columnRole: "Role",
    details: "Details",
    empty: "No relationships yet.",
  },

  contactMethods: {
    title: "Contact",
    addEmail: "Add email",
    addPhone: "Add phone",
    addAddress: "Add address",
    addSocial: "Add social",
    socialHandle: (platform, handle) => `${platform} · ${handle}`,
    columnLabel: "Label",
    columnValue: "Value",
    empty: "No contact methods yet.",
    phoneWithExtension: (number, extension) => `${number} ext. ${extension}`,
    phoneWithoutSms: (number) => `${number} (no texts)`,
  },

  holidays: {
    title: "Holidays",
    addLabel: (bearerType) =>
      bearerType === "pet"
        ? "Add a holiday this pet observes"
        : "Add a holiday this person observes",
    addPlaceholder: "Add a holiday…",
    columnHoliday: "Holiday",
    columnNext: "Next",
    reminders: "Reminders",
    empty: "No holidays yet.",
    hiddenName: (name) => `${name} (hidden)`,
  },

  gifts: {
    title: "Gifts",
    empty: "No gifts yet.",
    link: "link",
    given: "Given",
  },

  giftIdeaRecipients: {
    title: "For…",
    addLabel: "Add a person or pet this would suit",
    addPlaceholder: "For whom?",
    empty: "Not for anyone in particular yet.",
    givenTo: (recipient) => `Given to ${recipient}`,
  },

  giftCapture: {
    giftLabel: "Gift",
    titlePlaceholder: "Red Ryder BB Gun",
    urlLabel: "Gift link",
    urlPlaceholder: "https://… (optional)",
    addRecipientLabel: "Add a person or pet to gift",
    addRecipientPlaceholder: "For whom? (optional)",
    removeRecipient: "Remove",
    alreadyGiven: (recipient) => `Already gave it to ${recipient}`,
    missingTitle: "A gift needs a name.",
    submit: "Add",
  },

  relationshipForm: {
    heading: "Add relationship",
    submit: "Add",
    name: "Name",
    namePlaceholder: "Start typing a name",
    role: "Role",
    rolePlaceholder: "role",
    note: "Note",
    groupLegend: "Relationships",
    addRow: "Add relationship",
  },

  personForm: {
    tagsPlaceholder: "#Friend #Colleague",
  },

  petForm: {
    tagsPlaceholder: "#Friend #Neighbor",
  },

  search: {
    fieldLabel: "Search people, pets, tags, holidays, and gift ideas",
    placeholder: "Search… (⌘K)",
    matchedOn: "matched on",
    reasonSeparator: ", ",
  },

  import: {
    dropHint: "Drop a contact card (.vcf) to import",
    unrecognizedHeading: "Can’t read that file",
    unrecognizedBody: (filename) =>
      `Leapsake can only import contact cards (.vcf) right now, and ${filename} doesn’t look like one.`,
    acknowledge: "OK",
    reviewHeading: "Import contacts",
    reviewIntro: (count) =>
      count === 1
        ? "Found 1 contact in the dropped file. Review what will be imported, then confirm."
        : `Found ${count} contacts in the dropped file. Review what will be imported, then confirm.`,
    importCount: (count) => `Import ${count}`,
    importing: "Importing…",
    skip: "Skip",
    include: "Include",
    needsName: "Needs a first and last name before it can be imported.",
    duplicateWarning: (tier, name, reasons) => {
      const label =
        tier === "high"
          ? "Very likely already in Leapsake"
          : tier === "medium"
            ? "Possibly already in Leapsake"
            : tier;
      return `${label}: matches ${name} (${reasons.join("; ")}). Skip to avoid a duplicate.`;
    },
    notImported: (properties) => `Not imported: ${list(properties)}`,
    labelledValue: (label, value) => `${label}: ${value}`,
    birthday: (formatted) => `Birthday: ${formatted}`,
    detailLine: (bits) => bits.join(" · "),
    completeHeading: "Import complete",
    completeSummary: (created, skipped) => {
      const people = created === 1 ? "1 person" : `${created} people`;
      return skipped > 0
        ? `Imported ${people}, skipped ${skipped}.`
        : `Imported ${people}.`;
    },
    failedCount: (count) =>
      count === 1 ? "Couldn’t import 1:" : `Couldn’t import ${count}:`,
    failedRow: (name, message) => `${name} — ${message}`,
    unnamedContact: "Unnamed contact",
    whichIsYou: "Which of these is you?",
    pickYourself: "Pick yourself",
    done: "Done",
  },

  contactMethodForm: {
    addHeading: (kind) =>
      kind === "email"
        ? "Add email"
        : kind === "phone"
          ? "Add phone"
          : kind === "postal"
            ? "Add address"
            : "Add social profile",
    editHeading: (kind) =>
      kind === "email"
        ? "Edit email"
        : kind === "phone"
          ? "Edit phone"
          : kind === "postal"
            ? "Edit address"
            : "Edit social profile",
    submitAdd: "Add",
    label: "Label",
    labelPlaceholder: "e.g. Home",
    email: "Email",
    number: "Number",
    extension: "Extension",
    optional: "optional",
    country: "Country",
    smsCapable: "Can receive texts (SMS)",
    line1: "Address line 1",
    line1Placeholder: "Street or PO box",
    line2: "Address line 2",
    line2Placeholder: "Apt / unit / suite",
    locality: "City / town",
    region: "State / province / county",
    postalCode: "Postal code",
    platform: "Platform",
    handle: "Handle or profile link",
    handlePlaceholder: "@name",
    userId: (platform) => `${platform} user ID`,
    userIdHint: (platform) =>
      `${platform} opens a direct message only from a numeric ID. Without one this opens their profile.`,
    profileUrl: "Profile URL",
    reachableOn: "Also reachable on",
  },

  reminderSchedule: {
    legend: "Reminders",
    on: "On",
    action: "Reminder action",
    label: "Reminder label",
    labelPlaceholder: "e.g. Send flowers",
    daysBefore: "Days before",
    daysBeforeSuffix: "days before",
    add: "Add reminder",
    emptyForMilestone: "No reminders for this milestone.",
  },

  withWhom: {
    person: "Person",
    unknownPlaceholder: "Leave blank if unknown",
    whichRelationship: "Which relationship?",
    relationship: "Relationship",
    rolePlaceholder: "Friend",
  },

  milestoneForm: {
    addHeading: "Add milestone",
    editHeading: "Edit milestone",
    submitAdd: "Add",
    kind: "Kind",
    month: "Month",
    day: "Day",
    year: "Year",
    label: "Label",
    labelPlaceholder: "e.g. Adoption day",
    noteLabel: "Note",
    notePlaceholder: "optional",
    dayNeedsMonth: "Pick a month before a day, or clear the day.",
  },

  giftIdeaForm: {
    title: "Title",
    titlePlaceholder: "Red Ryder BB Gun",
    url: "Link",
    urlPlaceholder: "https://…",
    notes: "Notes",
    notesPlaceholder: "the 200-shot model; she mentioned it in June",
    tags: "Tags",
    tagsPlaceholder: "#books #kitchen",
  },

  reminderForm: {
    title: "Title",
    titlePlaceholder: "Call mom",
    details: "Details",
    detailsPlaceholder:
      "Type @ to mention someone; add #tags inline, e.g. ask about the trip #family",
    dueDate: "Due date",
  },

  person: {
    merge: "Merge",
    firstName: "First name",
    middleName: "Middle name",
    lastName: "Last name",
    created: "Created",
    updated: "Updated",
    duplicates: (count) =>
      count === 1
        ? "Someone else in your list looks like the same person."
        : `${count} other people in your list look like the same person.`,
    reviewDuplicates: "Review",
  },

  pet: {
    name: "Name",
    created: "Created",
    updated: "Updated",
  },

  relationship: {
    editRoles: "Edit roles",
  },

  party: {
    person: "Person",
    pet: "Pet",
    of: (type) => (type === "pet" ? "Pet" : "Person"),
  },
};
