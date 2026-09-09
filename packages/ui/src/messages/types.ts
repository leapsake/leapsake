import type {
  ContactMethodKind,
  GiftPartyType,
  ObservanceBearerType,
} from "@leapsake/schema";

/**
 * Every user-visible string the package renders.
 *
 * **Messages that take values are functions, not templates with holes.** The
 * catalog owns the whole sentence; a component only supplies data. That is what
 * makes a component unable to assemble a sentence out of fragments — the failure
 * mode isn't discouraged, it's unavailable — and it's what lets a later catalog
 * handle plural rules, word order and grammatical agreement without any component
 * changing.
 *
 * A dedicated i18n library will replace `en` and the provider eventually. Nothing
 * here assumes which one: components read a plain typed object, so adopting
 * FormatJS/Lingui/i18next is a swap of the two files under `messages/`, not a
 * rewrite of the components.
 *
 * **On sharing keys:** `common` holds only verbs that are genuinely the same
 * action wherever they appear. One English word often needs several translations
 * depending on context — if a surface ever needs its own wording, give it its own
 * key rather than widening `common`.
 */
export interface Messages {
  common: {
    edit: string;
    remove: string;
    delete: string;
    save: string;
    cancel: string;
    close: string;
    /** Shown where a value is absent. */
    none: string;
    /** A write that didn't land. */
    saveFailed: (error: string) => string;
  };

  breadcrumbs: {
    /** Accessible name for the trail itself. */
    label: string;
  };

  combobox: {
    /** Announced after a pick, since the field deliberately stays open. */
    added: (label: string) => string;
    suggestionCount: (count: number) => string;
    resultCount: (count: number) => string;
  };

  gender: {
    fieldLabel: string;
    female: string;
    male: string;
    nonbinary: string;
  };

  tags: {
    title: string;
    edit: string;
    empty: string;
  };

  mentionedIn: {
    title: string;
    empty: string;
  };

  milestones: {
    title: string;
    add: string;
    columnMilestone: string;
    columnDate: string;
    empty: string;
    view: string;
    setSpouse: string;
    /** A milestone drawn from a relationship, labelled with the other party. */
    withPartner: (milestoneLabel: string, partner: string) => string;
  };

  relationships: {
    title: string;
    add: string;
    columnName: string;
    columnRole: string;
    details: string;
    empty: string;
  };

  contactMethods: {
    title: string;
    addEmail: string;
    addPhone: string;
    addAddress: string;
    addSocial: string;
    /** A profile, named by its platform — "Instagram · @josh". */
    socialHandle: (platform: string, handle: string) => string;
    columnLabel: string;
    columnValue: string;
    empty: string;
    /** A number with its extension. */
    phoneWithExtension: (number: string, extension: string) => string;
    /** A number that can't receive texts, which is otherwise assumed. */
    phoneWithoutSms: (number: string) => string;
  };

  holidays: {
    title: string;
    addLabel: (bearerType: ObservanceBearerType) => string;
    addPlaceholder: string;
    columnHoliday: string;
    columnNext: string;
    reminders: string;
    empty: string;
    /** A holiday that generates no reminders but is still observed. */
    hiddenName: (name: string) => string;
  };

  gifts: {
    title: string;
    empty: string;
    /** The idea's external link. */
    link: string;
    /** The tick beside a gift on a person's or pet's list. */
    given: string;
  };

  giftIdeaRecipients: {
    title: string;
    addLabel: string;
    addPlaceholder: string;
    empty: string;
    /** The tick beside one party on an idea's list. */
    givenTo: (recipient: string) => string;
  };

  giftCapture: {
    giftLabel: string;
    titlePlaceholder: string;
    urlLabel: string;
    urlPlaceholder: string;
    addRecipientLabel: string;
    addRecipientPlaceholder: string;
    removeRecipient: string;
    /** The capture form's tick: this one is already in their hands. */
    alreadyGiven: (recipient: string) => string;
    missingTitle: string;
    submit: string;
  };

  relationshipForm: {
    heading: string;
    submit: string;
    name: string;
    namePlaceholder: string;
    role: string;
    rolePlaceholder: string;
    note: string;
    /** Legend for the rows embedded in a create form. */
    groupLegend: string;
    /** Adds another blank row to that group. */
    addRow: string;
  };

  personForm: {
    tagsPlaceholder: string;
  };

  petForm: {
    tagsPlaceholder: string;
  };

  search: {
    fieldLabel: string;
    placeholder: string;
    /** Introduces why a result matched, when it wasn't the name. */
    matchedOn: string;
    reasonSeparator: string;
  };

  import: {
    dropHint: string;
    unrecognizedHeading: string;
    unrecognizedBody: (filename: string) => string;
    acknowledge: string;
    reviewHeading: string;
    reviewIntro: (count: number) => string;
    importCount: (count: number) => string;
    importing: string;
    skip: string;
    include: string;
    needsName: string;
    /** That an incoming card **is** someone already here — its `UID` names them.
     *  A certainty, unlike {@link duplicateWarning}'s resemblance. */
    alreadyStored: (name: string) => string;
    /** The card says it is the user themselves; ticking it makes it so. */
    selfClaim: string;
    /** Why an incoming contact looks like someone already here. */
    duplicateWarning: (
      tier: string,
      name: string,
      reasons: readonly string[],
    ) => string;
    notImported: (properties: readonly string[]) => string;
    labelledValue: (label: string, value: string) => string;
    birthday: (formatted: string) => string;
    detailLine: (bits: readonly string[]) => string;
    completeHeading: string;
    completeSummary: (created: number, skipped: number) => string;
    failedCount: (count: number) => string;
    failedRow: (name: string, message: string) => string;
    unnamedContact: string;
    whichIsYou: string;
    pickYourself: string;
    done: string;
  };

  contactMethodForm: {
    /** “Add email” / “Add phone” / “Add address” — one whole heading per kind. */
    addHeading: (kind: ContactMethodKind) => string;
    editHeading: (kind: ContactMethodKind) => string;
    submitAdd: string;
    label: string;
    labelPlaceholder: string;
    email: string;
    number: string;
    extension: string;
    optional: string;
    country: string;
    smsCapable: string;
    line1: string;
    line1Placeholder: string;
    line2: string;
    line2Placeholder: string;
    locality: string;
    region: string;
    postalCode: string;
    platform: string;
    handle: string;
    handlePlaceholder: string;
    /** The optional opaque id, named after the platform that wants one. */
    userId: (platform: string) => string;
    /** Why that field exists, said in terms of what the row will do without it. */
    userIdHint: (platform: string) => string;
    profileUrl: string;
    /** Whether the phone reaches a platform addressed by number. */
    reachableOn: string;
  };

  reminderPrompt: {
    legend: string;
    justTheDay: string;
    save: string;
    editFull: string;
    /** What ticking anything actually buys — a reminder at a time, not a to-do. */
    caption: string;
    /** The one delivery question for the whole occasion. */
    deliveryLegend: string;
    deliveryHand: string;
    deliveryMail: string;
    /** What the posting choice schedules, given a lead time in words. */
    deliveryNote: (leadTime: string) => string;
  };

  reminderSchedule: {
    legend: string;
    on: string;
    action: string;
    label: string;
    labelPlaceholder: string;
    daysBefore: string;
    daysBeforeSuffix: string;
    add: string;
    emptyForMilestone: string;
  };

  withWhom: {
    person: string;
    unknownPlaceholder: string;
    whichRelationship: string;
    relationship: string;
    rolePlaceholder: string;
  };

  milestoneForm: {
    addHeading: string;
    editHeading: string;
    submitAdd: string;
    kind: string;
    month: string;
    day: string;
    year: string;
    label: string;
    labelPlaceholder: string;
    noteLabel: string;
    notePlaceholder: string;
    dayNeedsMonth: string;
  };

  giftIdeaForm: {
    title: string;
    titlePlaceholder: string;
    url: string;
    urlPlaceholder: string;
    notes: string;
    notesPlaceholder: string;
    tags: string;
    tagsPlaceholder: string;
  };

  reminderForm: {
    title: string;
    titlePlaceholder: string;
    details: string;
    detailsPlaceholder: string;
    dueDate: string;
  };

  person: {
    merge: string;
    firstName: string;
    middleName: string;
    lastName: string;
    created: string;
    updated: string;
    /** How many others look like this person. */
    duplicates: (count: number) => string;
    reviewDuplicates: string;
  };

  pet: {
    name: string;
    created: string;
    updated: string;
  };

  relationship: {
    editRoles: string;
  };

  /** Party labels, for surfaces that name what kind of thing something is. */
  party: {
    person: string;
    pet: string;
    of: (type: GiftPartyType) => string;
  };
}
