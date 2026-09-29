import {
  type HighlightMode,
  foldCharFor,
  parseBirthdayQuery,
} from "@leapsake/schema";

export type { HighlightMode };

/** One run of a highlighted string, marked or not; the runs concatenate back
 *  to the original, and each platform renders them. */
export interface HighlightSegment {
  text: string;
  marked: boolean;
}

/** The whole string unmarked, or `[]` when empty. */
const plain = (text: string): HighlightSegment[] =>
  text === "" ? [] : [{ text, marked: false }];

/** Folds `text`, mapping each folded unit to its source index so a match maps
 *  back; address mode collapses whitespace runs. */
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

/** The inclusive folded span to mark: the exact substring, else the whole
 *  value the term contains, else first to last token matched. */
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

/** Marks what `term` matched, folding as the search service does, so a shown
 *  result is unmarked only when nothing aligns. */
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

/** Marks a formatted birthday: a month-name query as text, a numeric one by
 *  the date parts the service's own parser says it named. */
export function highlightBirthdaySegments(
  text: string,
  term: string,
): HighlightSegment[] {
  // A query with letters is a month name, highlighted as text.
  if (/\p{L}/u.test(term)) return highlightSegments(text, term, "text");

  // Which parts a numeric query named, by the service's own parser.
  const candidates = parseBirthdayQuery(term);
  if (candidates.length === 0) return plain(text);
  const wantMonth = candidates.some((c) => c.month !== undefined);
  const wantDay = candidates.some((c) => c.day !== undefined);
  const wantYear = candidates.some((c) => c.year !== undefined);

  // The month is the leading letter run, the year four digits, the day the
  // remaining one or two.
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
