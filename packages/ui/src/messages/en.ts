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
    saveFailed: (error) => `Couldn't save: ${error}`,
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
    suggested: (details) =>
      details.length === 0 ? "Suggested" : `Suggested — ${list(details)}`,
    given: (details) =>
      details.length === 0 ? "✓ Given" : `✓ Given — ${list(details)}`,
    fromGiver: (giver) => `from ${giver}`,
  },

  giftIdeaRecipients: {
    title: "Suggested for",
    addLabel: "Suggest this idea for a person or pet",
    addPlaceholder: "Suggest for someone…",
    empty: "Not suggested for anyone yet.",
    recipientLine: (recipient, occasion) =>
      occasion === null ? recipient : `${recipient} — ${occasion}`,
  },

  giftAdornments: {
    suggestionLegend: "For…",
    givingLegend: "Given on…",
  },

  giftOccasion: {
    occasionLabel: "Occasion",
    noOccasion: "— none —",
    milestoneGroup: "Milestones",
    holidayGroup: "Holidays",
    year: "Year",
    month: "Month",
    day: "Day",
    useDate: (iso) => `Use ${iso}`,
  },

  giftCapture: {
    giftLabel: "Gift",
    titlePlaceholder: "Red Ryder BB Gun",
    urlLabel: "Gift link",
    urlPlaceholder: "https://… (optional)",
    addRecipientLabel: "Add a person or pet to gift",
    addRecipientPlaceholder: "For whom? (optional)",
    removeRecipient: "Remove",
    addDate: "+ Add a date",
    removeDate: "Remove date",
    givingLegend: "Given on… (a date makes it a logged gift, not a suggestion)",
    suggestionSummary: "For… (an occasion or a target date, optional)",
    suggestionLegend: "For…",
    alreadyGiven: (recipient, when) =>
      when.length === 0
        ? `⚠ ${recipient} was already given this.`
        : `⚠ ${recipient} was already given this — ${list(when)}.`,
    missingTitle: "A gift needs a name.",
    submitSuggestion: "Add",
    submitGiving: "Log gift",
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
