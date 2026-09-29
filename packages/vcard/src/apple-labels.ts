import { type MilestoneKind, kindDefs } from "@leapsake/schema";

// What both importers must know about Apple's labels; see the README.

/** An Apple `CNLabel*` constant, which arrives raw, such as `_$!<Work>!$_`. */
const LABEL_CONSTANT = /^_\$!<(.+)>!\$_$/;

/** Tokens that need more than their casing settled, keyed lower-cased. */
const LABEL_TOKENS: Record<string, string> = {
  homefax: "Home fax",
  workfax: "Work fax",
  otherfax: "Other fax",
  homepage: "Home page",
};

/** A label as display text: a constant unwrapped, free text untouched; `""`
 *  when empty, for the caller's own fallback. */
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

/** Whether a foreign card's date label alone can name each kind; exhaustive,
 *  so a new kind fails the build here. */
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

/** Those kinds keyed by their {@link kindDefs} label lower-cased, the form a
 *  card carries and the writer emits. */
const DATE_KINDS = new Map<string, MilestoneKind>(
  (Object.keys(FROM_A_LABEL) as MilestoneKind[])
    .filter((kind) => FROM_A_LABEL[kind])
    .map((kind) => [kindDefs[kind].label.toLowerCase(), kind]),
);

/** The milestone kind a date's label names, ignoring case, or `null`. */
export function dateKindFor(label: string): MilestoneKind | null {
  return DATE_KINDS.get(label.trim().toLowerCase()) ?? null;
}
