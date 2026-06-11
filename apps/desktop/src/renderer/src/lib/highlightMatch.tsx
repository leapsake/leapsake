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
 * Highlight a birthday reason (a formatted date like "October 31, 1990") against
 * the user's query. A month-name query ("oct", "october 31") folds and aligns
 * like any text, so it defers to {@link highlightMatch}. A *numeric* query
 * ("10/31", "10/31/1990", "1990") can't fold into a month *name*, so instead we
 * mark the structural pieces the query addresses: a month part marks the month
 * word, a day part marks the day number, a year part marks the 4-digit year.
 *
 * The reason is only shown because the service already matched it, so the date's
 * parts are known-consistent with the query — we needn't re-check the values,
 * only mark the pieces the query named. Returns the plain string when nothing
 * numeric aligns.
 */
export function highlightBirthday(text: string, term: string): ReactNode {
  const t = term.trim().toLowerCase();
  // A query carrying letters is a month-name query; text folding highlights it
  // (typing "oct" marks "Oct", "october 31" marks "October 31").
  if (/\p{L}/u.test(t)) return highlightMatch(text, term, "text");

  // Numeric query: which date parts did the user type? "M/D" → month + day;
  // "M/D/Y" → + year; a lone 4-digit number → year only. Mirrors the service's
  // parseBirthdayQuery so the highlight matches what was searched.
  const numeric = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/.exec(t);
  const yearOnly = /^\d{4}$/.test(t);
  const wantMonth = numeric !== null;
  const wantDay = numeric !== null;
  const wantYear = numeric !== null ? numeric[3] !== undefined : yearOnly;
  if (!wantMonth && !wantDay && !wantYear) return text;

  // Locate the structural pieces of the formatted date. The month name is the
  // leading letter run (Unicode-aware for localized names like "août"); the year
  // is the 4-digit number; the day is the remaining 1–2 digit number.
  const ranges: [number, number][] = [];
  const push = (m: RegExpExecArray | null) => {
    if (m) ranges.push([m.index, m.index + m[0].length]);
  };
  if (wantMonth) push(/\p{L}+/u.exec(text));
  if (wantYear) push(/\d{4}/.exec(text));
  if (wantDay) push(/\b\d{1,2}\b/.exec(text)); // 1–2 digits, never inside a year
  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([from, to], i) => {
    if (from > cursor) out.push(text.slice(cursor, from));
    out.push(<mark key={i}>{text.slice(from, to)}</mark>);
    cursor = to;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
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
