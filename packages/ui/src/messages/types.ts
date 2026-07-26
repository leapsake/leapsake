import type { GiftPartyType, ObservanceBearerType } from "@leapsake/schema";

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
    /**
     * A candidate, with its occasion and target date if it has them. Takes the
     * details as a list rather than a joined string: separators are a language's
     * decision (`Intl.ListFormat`), not a component's.
     */
    suggested: (details: readonly string[]) => string;
    /** A logged giving, with its date, giver and occasion if known. */
    given: (details: readonly string[]) => string;
    /** Who a giving came from, when known. */
    fromGiver: (giver: string) => string;
  };

  giftIdeaRecipients: {
    title: string;
    addLabel: string;
    addPlaceholder: string;
    empty: string;
    /** A recipient the idea is suggested for, with its occasion when it has one. */
    recipientLine: (recipient: string, occasion: string | null) => string;
  };

  giftAdornments: {
    suggestionLegend: string;
    givingLegend: string;
  };

  giftOccasion: {
    occasionLabel: string;
    noOccasion: string;
    milestoneGroup: string;
    holidayGroup: string;
    year: string;
    month: string;
    day: string;
    /** Offer a date the occasion actually falls on. */
    useDate: (iso: string) => string;
  };

  giftCapture: {
    giftLabel: string;
    titlePlaceholder: string;
    urlLabel: string;
    urlPlaceholder: string;
    addRecipientLabel: string;
    addRecipientPlaceholder: string;
    removeRecipient: string;
    addDate: string;
    removeDate: string;
    givingLegend: string;
    suggestionSummary: string;
    suggestionLegend: string;
    /** The re-gift guard, phrased without a giver: what matters is they have one. */
    alreadyGiven: (recipient: string, when: readonly string[]) => string;
    missingTitle: string;
    submitSuggestion: string;
    submitGiving: string;
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
