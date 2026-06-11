import {
  type HighlightMode,
  foldCharFor,
  parseBirthdayQuery,
} from "@leapsake/schema";

export type { HighlightMode };

/**
 * One piece of a highlighted string: a run of `text` that is either part of the
 * match (`marked`) or not. The pieces in a list concatenate back to exactly the
 * original string; a no-match yields a single unmarked piece (or `[]` for the
 * empty string).
 *
 * This is the platform-agnostic output: a renderer maps each piece to its own
 * markup (web wraps `marked` runs in `<mark>`; a React Native view would wrap
 * them in a styled `<Text>`). No DOM, so it's directly unit-testable.
 */
export interface HighlightSegment {
  text: string;
  marked: boolean;
}

/** The no-match / fallback result: the whole string, unmarked (empty → `[]`). */
const plain = (text: string): HighlightSegment[] =>
  text === "" ? [] : [{ text, marked: false }];

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

/**
 * The pieces of `text` to highlight for the user's `term`, as platform-agnostic
 * {@link HighlightSegment}s. The fold mirrors the search service so the highlight
 * aligns with how the result was matched: accent/case-folded for `"text"`,
 * digits-only for `"phone"`, comma/whitespace-insensitive for `"address"`.
 *
 * Falls back from an exact folded substring to two looser strategies so a shown
 * result never renders *un*-highlighted: if the query instead fully contains the
 * value, the whole value is marked; otherwise the span between the first and
 * last matched token is marked. Returns the plain (unmarked) string only when
 * nothing aligns at all.
 */
export function highlightSegments(
  text: string,
  term: string,
  mode: HighlightMode = "text",
): HighlightSegment[] {
  const foldedTermRaw = foldWithMap(term, mode).folded;
  const foldedTerm = mode === "address" ? foldedTermRaw.trim() : foldedTermRaw;
  if (foldedTerm === "") return plain(text);

  const chars = Array.from(text);
  const { folded, sourceIndex } = foldWithMap(text, mode);
  if (folded === "") return plain(text);

  const span = matchSpan(folded, foldedTerm);
  if (!span) return plain(text);
  const start = sourceIndex[span.from];
  const end = sourceIndex[span.to]; // inclusive

  const segments: HighlightSegment[] = [];
  const pre = chars.slice(0, start).join("");
  const post = chars.slice(end + 1).join("");
  if (pre !== "") segments.push({ text: pre, marked: false });
  segments.push({ text: chars.slice(start, end + 1).join(""), marked: true });
  if (post !== "") segments.push({ text: post, marked: false });
  return segments;
}

/**
 * The pieces to highlight for a birthday reason (a formatted date like "October
 * 31, 1990") against the user's query. A month-name query ("oct", "october 31")
 * folds and aligns like any text, so it defers to {@link highlightSegments}. A
 * *numeric* query ("10/31", "10/31/1990", "1990") can't fold into a month
 * *name*, so instead we mark the structural pieces the query addresses: a month
 * part marks the month word, a day part marks the day number, a year part marks
 * the 4-digit year.
 *
 * Which parts the query named is read from {@link parseBirthdayQuery} — the same
 * parser the service matched with — so the highlight can never drift from what
 * was searched. The reason is only shown because the service already matched it,
 * so the date's parts are known-consistent with the query; we needn't re-check
 * the values, only mark the pieces the query named.
 */
export function highlightBirthdaySegments(
  text: string,
  term: string,
): HighlightSegment[] {
  // A query carrying letters is a month-name query; text folding highlights it
  // (typing "oct" marks "Oct", "october 31" marks "October 31").
  if (/\p{L}/u.test(term)) return highlightSegments(text, term, "text");

  // Numeric query: which date parts did the user name? Derive them from the
  // service's own parser so highlight and match stay in lockstep. "M/D" →
  // month + day; "M/D/Y" → + year; a lone 4-digit number → year only.
  const candidates = parseBirthdayQuery(term);
  if (candidates.length === 0) return plain(text);
  const wantMonth = candidates.some((c) => c.month !== undefined);
  const wantDay = candidates.some((c) => c.day !== undefined);
  const wantYear = candidates.some((c) => c.year !== undefined);

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
  if (ranges.length === 0) return plain(text);

  ranges.sort((a, b) => a[0] - b[0]);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [from, to] of ranges) {
    if (from > cursor)
      segments.push({ text: text.slice(cursor, from), marked: false });
    segments.push({ text: text.slice(from, to), marked: true });
    cursor = to;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), marked: false });
  }
  return segments;
}
