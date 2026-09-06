import type { MilestoneKind } from "@leapsake/schema";

/**
 * The two things both importers have to know about Apple's way of labelling a
 * contact's fields, kept here so they cannot drift apart.
 *
 * A card exported from Contacts and the same card read through the device API
 * carry the *same* labels — the vCard is a serialisation of the very record
 * `expo-contacts` hands back — so a rule that lives in only one of the two
 * importers is a bug waiting for whichever path the user happens to take.
 */

/**
 * Apple's `CNLabel*` constants are not display text: they are wrapped tokens —
 * `CNLabelWork` is literally `"_$!<Work>!$_"`, `CNLabelPhoneNumberHomeFax` is
 * `"_$!<HomeFAX>!$_"`. The Contacts framework unwraps them via
 * `CNLabeledValue.localizedString(forLabel:)`; neither the vCard it exports nor
 * the `Contact` API `expo-contacts` reads from does that, so the constants arrive
 * raw and would otherwise be shown to the user as-is.
 *
 * Unwrapping is safe rather than brittle because the wrapper is a fixed, decades-
 * old sentinel (it predates `CNLabeledValue`, coming from AddressBook.framework)
 * whose whole purpose is to be recognisable: it can't collide with a user's own
 * label, since the Contacts UI has no way to type one. Anything not wrapped is
 * free text (a custom label, or Android's already-localised value) and passes
 * through untouched — we never title-case someone's "Beach House".
 */
const LABEL_CONSTANT = /^_\$!<(.+)>!\$_$/;

/**
 * Tokens whose unwrapped form isn't presentable on its own, keyed by the token
 * lower-cased. Everything else inside the wrapper is a single word ("Home",
 * "Mobile", "Pager", "School") that only needs its casing settled.
 */
const LABEL_TOKENS: Record<string, string> = {
  homefax: "Home fax",
  workfax: "Work fax",
  otherfax: "Other fax",
  homepage: "Home page",
};

/**
 * A label as display text: an Apple constant unwrapped, free text passed through.
 * Returns `""` for a label that says nothing, leaving the caller to supply the
 * fallback its own field wants (a contact method's "Other", a dropped date's
 * property name).
 */
export function appleLabelText(raw: string): string {
  const trimmed = raw.trim();
  const wrapped = LABEL_CONSTANT.exec(trimmed)?.[1];
  if (wrapped === undefined) return trimmed;

  const token = wrapped.trim();
  if (token === "") return "";
  return (
    LABEL_TOKENS[token.toLowerCase()] ??
    token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
  );
}

/**
 * Date labels Leapsake has a milestone kind for, keyed by the label lower-cased.
 * Deliberately tiny: a label with no kind here is surfaced as dropped rather than
 * guessed into `other`, so a card's "Graduation" or "Beach house closing" stays
 * visible in the review without every stray date minting a milestone.
 *
 * `birthday` is absent on purpose — a birthday-labelled date never becomes a
 * dated milestone; it fills the contact's birthday, and only when the source's
 * dedicated birthday field (iOS's `CNContactBirthdayKey`, a vCard's `BDAY`) had
 * nothing, so a card that spells its birthday twice can never mint a second one.
 */
const DATE_KINDS: Record<string, MilestoneKind> = {
  anniversary: "anniversary",
};

/** The milestone kind a dated occasion's label names, or `null` for one Leapsake
 *  has no kind for. Case-insensitive; the label is the only thing on either side
 *  of the import that says what a date *is*. */
export function dateKindFor(label: string): MilestoneKind | null {
  return DATE_KINDS[label.trim().toLowerCase()] ?? null;
}
