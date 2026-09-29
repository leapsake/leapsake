import {
  type HighlightMode,
  type HighlightSegment,
  highlightBirthdaySegments,
  highlightSegments,
} from "@leapsake/highlight";
import type { ReactNode } from "react";

export type { HighlightMode };

/** Renders {@link HighlightSegment}s, each matched run as a `<mark>`. */
function render(segments: HighlightSegment[]): ReactNode {
  return (
    <>
      {segments.map((s, i) =>
        s.marked ? <mark key={i}>{s.text}</mark> : s.text,
      )}
    </>
  );
}

/** Marks what `term` matched in `text`, folding as the search service does. */
export function highlightMatch(
  text: string,
  term: string,
  mode: HighlightMode = "text",
): ReactNode {
  return render(highlightSegments(text, term, mode));
}

/** Marks a formatted birthday against the query; see
 *  {@link highlightBirthdaySegments}. */
export function highlightBirthday(text: string, term: string): ReactNode {
  return render(highlightBirthdaySegments(text, term));
}
