import type {
  ContactMethodKind,
  DateFormat,
  GiftPartyType,
  ObservanceBearerType,
  Religion,
  YourCountrySource,
} from "@leapsake/schema";

/** Every user-visible string the package renders. */
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
    /** How many records carry a tag. */
    usageCount: (count: number) => string;
    /** A tag list row read aloud: its label and how many records carry it. */
    rowLabel: (label: string, count: number) => string;
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
    /** How many people and pets observe a holiday. */
    observerCount: (count: number) => string;
    /** A list row's second line: the next date, if known, and who observes. */
    rowMeta: (next: string | null, observerCount: number) => string;
    /** One upcoming date, with its length when it spans several days. */
    occurrence: (date: string, durationDays: number | null) => string;
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
    editHeading: string;
    submit: string;
    name: string;
    namePlaceholder: string;
    role: string;
    /** The role picker's empty choice. */
    rolePick: string;
    note: string;
    /** Shown when Save is pressed before naming the other end. */
    otherRequired: string;
    /** Shown when Save is pressed on a name that matches nobody. */
    otherUnknown: string;
    /** Shown when Save is pressed on a name more than one entity has. */
    otherAmbiguous: string;
    /** Shown when Save is pressed on a role the other end can’t hold. */
    otherNotHolder: string;
    /** Shown when Save is pressed before picking a role. */
    roleRequired: string;
    /** Shown when Save is pressed on an “Other” role with no note. */
    noteRequired: string;
    /** Legend for the rows embedded in a create form. */
    groupLegend: string;
    /** Adds another blank row to that group. */
    addRow: string;
  };

  personForm: {
    tagsPlaceholder: string;
    /** Why Save can't go yet: every part of the name is blank. */
    nameRequired: string;
  };

  petForm: {
    tagsPlaceholder: string;
    nameRequired: string;
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
    nothingChosen: string;
    skip: string;
    include: string;
    needsName: string;
    /** An incoming card whose `UID` names someone already here: a certainty. */
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
    /** How many people an import added. */
    imported: (count: number) => string;
    failedCount: (count: number) => string;
    failedRow: (name: string, message: string) => string;
    unnamedContact: string;
    whichIsYou: string;
    pickYourself: string;
    done: string;
  };

  contactMethodForm: {
    /** “Add email”, “Add phone”, “Add address”: a whole heading per kind. */
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
    /** Why that field exists: what the row will do without it. */
    userIdHint: (platform: string) => string;
    profileUrl: string;
    /** Whether the phone reaches a platform addressed by number. */
    reachableOn: string;
    /** Why Save can't go yet, one per field a draft is refused on. */
    labelRequired: string;
    addressRequired: string;
    numberRequired: string;
    postalRequired: string;
    platformRequired: string;
    handleRequired: string;
  };

  reminderPrompt: {
    legend: string;
    justTheDay: string;
    save: string;
    editFull: string;
    /** What ticking anything buys: a reminder at a time, not a to-do. */
    caption: string;
    /** The field for an errand of the user's own, typed into the prompt. */
    somethingElse: string;
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
    /** Shown when Save is pressed with a year that isn't a whole number. */
    dateOutOfRange: string;
    /** Shown when Save is pressed on an “Other” milestone with no label. */
    labelRequired: string;
    /** Shown when Save is pressed on an “Other” reminder with no label. */
    reminderLabelRequired: string;
    /** Shown when Save is pressed before the “with whom?” person is chosen. */
    withWhomRequired: string;
    /** The switch that brings back “what do you want to do?” every year. */
    asksEachYear: string;
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
    /** Shown when Save is pressed with no title. */
    titleRequired: string;
  };

  reminderForm: {
    title: string;
    titlePlaceholder: string;
    details: string;
    detailsPlaceholder: string;
    dueDate: string;
    /** Shown when Save is pressed with neither a title nor details. */
    textRequired: string;
    /** Shown when Save is pressed with a due date that doesn't exist. */
    dueInvalid: string;
    /** Shown when Save is pressed with a due date in the past. */
    duePast: string;
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

  /** A holiday's yearly question, and the switch that stops it. */
  holidayPrompt: {
    /** Under the question: when the holiday is, and how soon. */
    when: (name: string, date: string, countdown: string) => string;
    forYou: string;
    whichIsYou: string;
    /** Shown when an errand is ticked with nobody picked as you. */
    youFirst: string;
    /** The collapsed line over everyone else who keeps it. */
    wishLine: (greeting: string) => string;
    addSomeone: string;
    /** When the day is too close for anything but what's already set. */
    nothingLeft: string;
    save: string;
    stopAsking: {
      title: (name: string) => string;
      thisYear: string;
      ever: string;
      /** Under the choice: what stopping leaves as it was. */
      note: string;
    };
    /** The holiday page's switch. */
    askEachYear: string;
  };

  /** A person's stated nationalities and religions. */
  affiliations: {
    nationalities: string;
    religions: string;
    religion: Record<Religion, string>;
    /** Under the multi-select of countries, on a pointer-driven form. */
    nationalitiesHint: string;
    /** Several names as one phrase: “Ireland and the United States”. */
    list: (names: readonly string[]) => string;
  };

  people: {
    /** The People list's link to the duplicates review. */
    reviewDuplicates: (count: number) => string;
  };

  dataExport: {
    /** What left the device, in one line. */
    summary: (counts: {
      people: number;
      pets: number;
      contactMethods: number;
      otherRecords: number;
      bytes: number;
    }) => string;
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

  /** Settings → Country: the one country Leapsake takes you to live in. */
  yourCountry: {
    title: string;
    intro: string;
    /** Under the picker: where the country on it came from. */
    source: Record<YourCountrySource, string>;
    saveFailed: string;
  };

  /** Settings → Display: how the app writes things out. */
  display: {
    title: string;
    intro: string;
    dateFormat: string;
    /** Each date format's name: its placeholder, in the reader's letters. */
    dateFormatLabel: Record<DateFormat, string>;
    /** Under the picker: today's date written in the chosen format. */
    dateFormatExample: (example: string) => string;
    saveFailed: string;
  };

  /** What reaches a device while the app is closed. */
  notifications: {
    /** One delivery's digest; `variant` picks among phrasings, so the same
     *  digest always reads the same. */
    digest: (situation: {
      /** An earlier delivery time comes before this one the same day. */
      followUp: boolean;
      /** It carries a note remembering someone who has died. */
      remembering: boolean;
      partOfDay: "morning" | "day" | "evening";
      /** At least one. */
      labels: readonly string[];
      variant: number;
    }) => { title: string; body: string };
    /** The notice a month before the schedule lapses: never claims anything
     *  was switched off, since opening the app is the fix. */
    runningOut: { title: string; body: string };
    /** One holiday occurrence's wishes as one line, never a count. */
    wishGroup: (greeting: string) => string;
  };
}
