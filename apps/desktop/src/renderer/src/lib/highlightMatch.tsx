import type { ReactNode } from "react";

/**
 * Per-character fold for names, emails and addresses: accent- and
 * case-insensitive, mirroring the search service's own folding so the
 * highlighted span lines up with *why* the result matched (e.g. typing "jose"
 * highlights "José").
 */
const foldTextChar = (c: string): string =>
  c
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Per-character fold for phone numbers: keep digits, drop formatting and the
 * leading "+", mirroring the service's digits-only phone matching — so typing
 * "5551234567" highlights the matching digits inside "+1 (555) 123-4567".
 */
const foldPhoneChar = (c: string): string => (/\d/.test(c) ? c : "");

/**
 * Per-character fold for addresses: as text, but commas and any whitespace
 * become a single space (runs are collapsed in {@link foldWithMap}), mirroring
 * the service's `foldAddress` so "123 any street pittsburgh" highlights inside
 * the formatted "123 Any Street, Pittsburgh".
 */
const foldAddressChar = (c: string): string =>
  c === "," || /\s/.test(c) ? " " : foldTextChar(c);

/** How `text` is highlighted, picked from the matched facet by the caller. */
export type HighlightMode = "text" | "phone" | "address";

const foldCharFor: Record<HighlightMode, (c: string) => string> = {
  text: foldTextChar,
  phone: foldPhoneChar,
  address: foldAddressChar,
};

/**
 * Fold `text` character-by-character, recording the source code-point index
 * behind each folded code unit so a match found in the folded string maps back
 * to a span in the original (which may differ in length — accents, formatting,
 * the "+"). In address mode, runs of whitespace collapse to one space.
 */
function foldWithMap(
  text: string,
  mode: HighlightMode,
): { folded: string; sourceIndex: number[] } {
  const foldChar = foldCharFor[mode];
  const collapse = mode === "address";
  const chars = Array.from(text);
  let folded = "";
  const sourceIndex: number[] = [];
  let prevSpace = false;
  chars.forEach((c, i) => {
    const f = foldChar(c);
    for (let j = 0; j < f.length; j++) {
      const ch = f[j];
      const isSpace = collapse && ch === " ";
      if (isSpace && prevSpace) continue; // collapse a run of whitespace
      folded += ch;
      sourceIndex.push(i);
      prevSpace = isSpace;
    }
  });
  return { folded, sourceIndex };
}

/**
 * Wrap the portion of `text` that the user's `term` matched in a `<mark>` — the
 * semantic element for text highlighted because it is relevant to the user's
 * current activity (here, the search query). The fold mirrors the search service
 * so the highlight aligns with how the result was matched: accent/case-folded
 * for `"text"`, digits-only for `"phone"`, comma/whitespace-insensitive for
 * `"address"`.
 *
 * Falls back from an exact folded substring to two looser strategies so a shown
 * result never renders *un*-highlighted: if the query instead fully contains the
 * value, the whole value is marked; otherwise the span between the first and
 * last matched token is marked. Returns the plain string only when nothing
 * aligns at all.
 */
export function highlightMatch(
  text: string,
  term: string,
  mode: HighlightMode = "text",
): ReactNode {
  const foldedTermRaw = foldWithMap(term, mode).folded;
  const foldedTerm = mode === "address" ? foldedTermRaw.trim() : foldedTermRaw;
  if (foldedTerm === "") return text;

  const chars = Array.from(text);
  const { folded, sourceIndex } = foldWithMap(text, mode);
  if (folded === "") return text;

  const span = matchSpan(folded, foldedTerm);
  if (!span) return text;
  const start = sourceIndex[span.from];
  const end = sourceIndex[span.to]; // inclusive
  return (
    <>
      {chars.slice(0, start).join("")}
      <mark>{chars.slice(start, end + 1).join("")}</mark>
      {chars.slice(end + 1).join("")}
    </>
  );
}

/**
 * The `[from, to]` folded-index span (inclusive) to highlight, or null if the
 * term doesn't align at all. Tries, in order: the exact substring; the whole
 * value when the term contains it (e.g. a phone typed with an extra country
 * code); else the stretch from the first to the last matched whitespace token,
 * so a reordered or partly-matching multi-word query still surrounds the
 * relevant text.
 */
function matchSpan(
  folded: string,
  foldedTerm: string,
): { from: number; to: number } | null {
  const exact = folded.indexOf(foldedTerm);
  if (exact !== -1) return { from: exact, to: exact + foldedTerm.length - 1 };
  if (foldedTerm.includes(folded)) return { from: 0, to: folded.length - 1 };

  const tokens = foldedTerm.split(" ").filter((t) => t !== "");
  let from = Number.POSITIVE_INFINITY;
  let to = -1;
  for (const token of tokens) {
    const at = folded.indexOf(token);
    if (at === -1) continue;
    from = Math.min(from, at);
    to = Math.max(to, folded.lastIndexOf(token) + token.length - 1);
  }
  return to === -1 ? null : { from, to };
}
