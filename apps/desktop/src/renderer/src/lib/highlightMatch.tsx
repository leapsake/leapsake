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
 * Wrap the portion of `text` that the user's `term` matched in a `<mark>` — the
 * semantic element for text highlighted because it is relevant to the user's
 * current activity (here, the search query). The fold mirrors the search service
 * so the highlight aligns with how the result was matched: accent- and
 * case-insensitive for `"text"`, digits-only for `"phone"`. Returns the plain
 * string when nothing aligns (e.g. a contact-only hit whose name doesn't contain
 * the term), so callers can use it unconditionally.
 */
export function highlightMatch(
  text: string,
  term: string,
  mode: "text" | "phone" = "text",
): ReactNode {
  const foldChar = mode === "phone" ? foldPhoneChar : foldTextChar;
  const foldedTerm = Array.from(term).map(foldChar).join("");
  if (foldedTerm === "") return text;

  // Fold char-by-char, recording the source code-point index behind each folded
  // code unit, so a match located in the folded string maps back to a span in
  // the original (which may differ in length — accents, formatting, the "+").
  const chars = Array.from(text);
  let folded = "";
  const sourceIndex: number[] = [];
  chars.forEach((c, i) => {
    const f = foldChar(c);
    for (let j = 0; j < f.length; j++) {
      folded += f[j];
      sourceIndex.push(i);
    }
  });

  const at = folded.indexOf(foldedTerm);
  if (at === -1) return text;

  const start = sourceIndex[at];
  const end = sourceIndex[at + foldedTerm.length - 1]; // inclusive
  return (
    <>
      {chars.slice(0, start).join("")}
      <mark>{chars.slice(start, end + 1).join("")}</mark>
      {chars.slice(end + 1).join("")}
    </>
  );
}
