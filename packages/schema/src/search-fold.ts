// Search folds whole strings; highlighting folds per character. Both forms
// live side by side so a highlight always lines up with why a result matched.

/** How `text` is folded, picked from the matched facet by the caller. */
export type HighlightMode = "text" | "phone" | "address";

/**
 * Per-character fold for names, emails and addresses: accent- and
 * case-insensitive, so typing "jose" lines up with "José".
 */
export const foldTextChar = (c: string): string =>
  c
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Per-character fold for phone numbers: digits only, dropping the "+". */
export const foldPhoneChar = (c: string): string => (/\d/.test(c) ? c : "");

/**
 * Per-character fold for addresses: as text, but commas and whitespace become
 * a space. The caller collapses runs.
 */
export const foldAddressChar = (c: string): string =>
  c === "," || /\s/.test(c) ? " " : foldTextChar(c);

export const foldCharFor: Record<HighlightMode, (c: string) => string> = {
  text: foldTextChar,
  phone: foldPhoneChar,
  address: foldAddressChar,
};

/** Accent and case folding, so `"jose"` matches `"José"`. */
export const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Strip everything but digits — drops formatting *and* the leading `+`. */
export const digits = (s: string): string => s.replace(/\D/g, "");

/**
 * {@link fold}, ignoring commas and collapsing whitespace, so "123 any street
 * pittsburgh" matches "123 Any Street, Pittsburgh".
 */
export const foldAddress = (s: string): string =>
  fold(s).replace(/,/g, " ").replace(/\s+/g, " ").trim();

/**
 * {@link fold} without the scheme or a leading `www.`, applied to both sides so
 * a bare "https" query matches nothing but a pasted URL still matches.
 */
export const foldUrl = (s: string): string =>
  fold(s)
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "");
