import {
  type HighlightMode,
  type HighlightSegment,
  highlightBirthdaySegments,
  highlightSegments,
} from "@leapsake/highlight";
import type { ReactNode } from "react";
import { Text } from "react-native";

export type { HighlightMode };

/** Segments as inline `<Text>` runs, matched ones bold. */
function render(segments: HighlightSegment[]): ReactNode {
  return segments.map((s, i) =>
    s.marked ? (
      <Text key={i} style={{ fontWeight: "600" }}>
        {s.text}
      </Text>
    ) : (
      <Text key={i}>{s.text}</Text>
    ),
  );
}

/** Bold what `term` matched in `text`, folded as the search service folds. */
export function highlightMatch(
  text: string,
  term: string,
  mode: HighlightMode = "text",
): ReactNode {
  return render(highlightSegments(text, term, mode));
}

/** Bold the parts of a formatted birthday the query names. */
export function highlightBirthday(text: string, term: string): ReactNode {
  return render(highlightBirthdaySegments(text, term));
}
