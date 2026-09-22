import { type MilestoneKind, kindDefs } from "@leapsake/schema";

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
 * Whether a kind can be recovered from a date's **label alone**, which is all a
 * card we did not write ever carries. Our own cards say it outright in
 * `X-LEAPSAKE-MILESTONE-KIND`, and that parameter wins ahead of everything here —
 * so this table governs somebody else's iPhone, and nothing else.
 *
 * Exhaustive by type on purpose. Adding an eleventh milestone kind breaks the
 * build *here*, which is the point: whether a stranger's card may mint it is a
 * decision, not a consequence of adding a kind to `@leapsake/schema`.
 *
 * The two `false`s are permanent, for two unrelated reasons:
 *
 *  - **`birthday`** — a birthday-labelled date never becomes a dated milestone.
 *    It fills the contact's birthday, and only when the source's dedicated field
 *    (iOS's `CNContactBirthdayKey`, a vCard's `BDAY`) had nothing, so a card that
 *    spells its birthday twice can never mint a second one. Both importers check
 *    that word inline, *above* the lookup below, which is what makes it work.
 *  - **`other`** — its label *is* the user's note ("Beach house closing"), so no
 *    map could resolve it. On a foreign card an unrecognised label stays dropped
 *    and named, rather than being guessed into `other`: a stray date never mints
 *    a milestone, and the review shows the user exactly what it did not import.
 */
const FROM_A_LABEL: Record<MilestoneKind, boolean> = {
  birthday: false,
  other: false,
  death: true,
  "first-date": true,
  graduation: true,
  "job-start": true,
  met: true,
  moved: true,
  wedding: true,
};

/**
 * Those kinds keyed by the label lower-cased — **the label, not the slug**, since
 * the label is the only form that appears on a card. `first-date` is reached by
 * "first date" and `job-start` by "started a job".
 *
 * Derived from {@link kindDefs} rather than transcribed, because the writer emits
 * that same `kindDefs[kind].label` (`write.ts`, and `@leapsake/export`'s
 * `contact.ts`). Spelling the keys by hand would let a reworded label silently
 * stop matching, with nothing on either side to notice.
 */
const DATE_KINDS = new Map<string, MilestoneKind>(
  (Object.keys(FROM_A_LABEL) as MilestoneKind[])
    .filter((kind) => FROM_A_LABEL[kind])
    .map((kind) => [kindDefs[kind].label.toLowerCase(), kind]),
);

/** The milestone kind a dated occasion's label names, or `null` for one Leapsake
 *  has no kind for. Case-insensitive; the label is the only thing on either side
 *  of the import that says what a date *is*. */
export function dateKindFor(label: string): MilestoneKind | null {
  return DATE_KINDS.get(label.trim().toLowerCase()) ?? null;
}
