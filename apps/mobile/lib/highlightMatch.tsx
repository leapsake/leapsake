import {
  type HighlightMode,
  type HighlightSegment,
  highlightBirthdaySegments,
  highlightSegments,
} from "@leapsake/highlight";
import type { ReactNode } from "react";
import { Text } from "react-native";

export type { HighlightMode };

/**
 * Render platform-agnostic {@link HighlightSegment}s as React Native: each
 * matched run becomes a bold `<Text>` (the desktop renders the same segments as
 * `<mark>`, which it styles bold rather than with a colored background), and the
 * rest renders as plain inline `<Text>`. All the matching/folding lives in
 * `@leapsake/highlight`; this is RN's thin rendering wrapper, the counterpart to
 * the desktop's `highlightMatch.tsx`. The runs are inline `<Text>`, so they flow
 * inside a parent `<Text>`.
 */
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

/**
 * Bold the portion of `text` that the user's `term` matched. The fold mirrors the
 * search service (accent/case for `"text"`, digits for `"phone"`, comma/
 * whitespace-insensitive for `"address"`) so the highlight aligns with how the
 * result matched. See {@link highlightSegments}.
 */
export function highlightMatch(
  text: string,
  term: string,
  mode: HighlightMode = "text",
): ReactNode {
  return render(highlightSegments(text, term, mode));
}

/**
 * Highlight a birthday reason (a formatted date like "October 31, 1990") against
 * the user's query — month-name queries fold like text, numeric queries bold the
 * structural date pieces they name. See {@link highlightBirthdaySegments}.
 */
export function highlightBirthday(text: string, term: string): ReactNode {
  return render(highlightBirthdaySegments(text, term));
}
