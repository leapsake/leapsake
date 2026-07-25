import {
  type HighlightMode,
  type HighlightSegment,
  highlightBirthdaySegments,
  highlightSegments,
} from "@leapsake/highlight";
import type { ReactNode } from "react";

export type { HighlightMode };

/**
 * Render platform-agnostic {@link HighlightSegment}s as React: each matched run
 * becomes a `<mark>` — the semantic element for text highlighted because it's
 * relevant to the user's current activity (here, the search query) — and the
 * rest renders as plain text. All the matching/folding lives in
 * `@leapsake/highlight`; this is the web's thin rendering wrapper (a React Native
 * renderer would map the same segments to styled `<Text>`).
 *
 * This split — portable segments in one package, a five-line renderer per
 * platform — is the pattern the rest of this package follows.
 */
function render(segments: HighlightSegment[]): ReactNode {
  return (
    <>
      {segments.map((s, i) =>
        s.marked ? <mark key={i}>{s.text}</mark> : s.text,
      )}
    </>
  );
}

/**
 * Wrap the portion of `text` that the user's `term` matched in a `<mark>`. The
 * fold mirrors the search service (accent/case for `"text"`, digits for
 * `"phone"`, comma/whitespace-insensitive for `"address"`) so the highlight
 * aligns with how the result matched. See {@link highlightSegments}.
 */
export function highlightMatch(
  text: string,
  term: string,
  mode: HighlightMode = "text",
): ReactNode {
  return render(highlightSegments(text, term, mode));
}

/**
 * Highlight a birthday reason (a formatted date like “October 31, 1990”) against
 * the user's query — month-name queries fold like text, numeric queries mark the
 * structural date pieces they name. See {@link highlightBirthdaySegments}.
 */
export function highlightBirthday(text: string, term: string): ReactNode {
  return render(highlightBirthdaySegments(text, term));
}
