/**
 * Folding primitives shared by the search service (whole-string matching) and
 * the highlight package (per-character matching with a source-index map). They
 * live here, the lowest layer, so both the data layer and any renderer can
 * import them — the renderer must not reach into `@leapsake/data`. Keeping the
 * per-character and whole-string forms side by side guarantees they fold the
 * same way, so a highlighted span always lines up with *why* a result matched.
 */

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

/**
 * Per-character fold for phone numbers: keep digits, drop formatting and the
 * leading "+", so "5551234567" lines up with the digits inside "+1 (555)
 * 123-4567".
 */
export const foldPhoneChar = (c: string): string => (/\d/.test(c) ? c : "");

/**
 * Per-character fold for addresses: as text, but commas and any whitespace
 * become a single space (runs are collapsed by the caller), so "123 any street
 * pittsburgh" lines up inside "123 Any Street, Pittsburgh".
 */
export const foldAddressChar = (c: string): string =>
  c === "," || /\s/.test(c) ? " " : foldTextChar(c);

export const foldCharFor: Record<HighlightMode, (c: string) => string> = {
  text: foldTextChar,
  phone: foldPhoneChar,
  address: foldAddressChar,
};

/**
 * Accent + case folding so `"jose"` matches `"José"`. Both the query and every
 * candidate are folded before matching — uniform, false-positive-friendly
 * (better to over-surface than to miss).
 */
export const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Strip everything but digits — drops formatting *and* the leading `+`. */
export const digits = (s: string): string => s.replace(/\D/g, "");

/**
 * Address fold: {@link fold} plus comma- and whitespace-insensitivity, so a
 * run-together "123 any street pittsburgh" matches the formatted "123 Any
 * Street, Pittsburgh". Applied to both the query and the candidate address.
 */
export const foldAddress = (s: string): string =>
  fold(s).replace(/,/g, " ").replace(/\s+/g, " ").trim();
