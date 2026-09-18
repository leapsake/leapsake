import type { EntityType } from "./relationship.js";
import {
  type Mention,
  activeHashtagQuery,
  activeMentionQuery,
  mentionToken,
  splitAnnotatedText,
} from "./mention.js";

/**
 * A run of composer text that acts as one unit, sigil included. A mention's
 * text is fixed; a tag re-fits to its run, so typing at its end extends it.
 */
export type ChipSpan =
  | {
      kind: "mention";
      /** Index of the `@`. */
      start: number;
      /** Exclusive end, just past the last character of the display name. */
      end: number;
      displayName: string;
      targetType: EntityType;
      targetId: string;
    }
  | { kind: "tag"; start: number; end: number; name: string };

/**
 * How a field spells tags: in `"prose"` only `#` runs are tags; in a
 * `"tagField"` every word is one and the `#` is optional.
 */
export type TagGrammar = "prose" | "tagField";

/** The tag-run pattern for a grammar. Global — callers use `matchAll`. */
function tagRunPattern(grammar: TagGrammar): RegExp {
  return grammar === "prose" ? /#[\p{L}\p{N}]+/gu : /#?[\p{L}\p{N}]+/gu;
}

/** A tag run's stored name: what it spells, without the presentation sigil. */
function tagNameOf(run: string): string {
  return run.startsWith("#") ? run.slice(1) : run;
}

/**
 * A composer's displayed text and its chips, in displayed-text offsets. Only a
 * committed tag is a chip, so the spans are state, not derivable from the text.
 */
export interface ComposerDraft {
  text: string;
  spans: ChipSpan[];
  grammar: TagGrammar;
}

/** One run of a draft's text, plain or chip; the runs join to the text. */
export interface DraftRun {
  text: string;
  kind: "text" | "mention" | "tag";
}

/** Split a draft's text into its plain and chip runs, in order. */
export function splitDraft(draft: ComposerDraft): DraftRun[] {
  const runs: DraftRun[] = [];
  let last = 0;
  for (const span of draft.spans) {
    if (span.start > last) {
      runs.push({ text: draft.text.slice(last, span.start), kind: "text" });
    }
    runs.push({
      text: draft.text.slice(span.start, span.end),
      kind: span.kind,
    });
    last = span.end;
  }
  if (last < draft.text.length) {
    runs.push({ text: draft.text.slice(last), kind: "text" });
  }
  return runs;
}

/** Whether the two half-open ranges share any character. */
function overlaps(a: ChipSpan, start: number, end: number): boolean {
  return a.start < end && a.end > start;
}

/**
 * Sort spans and drop any that overlaps one already kept, as when deleting the
 * space in `#work #life` re-fits both chips onto one run.
 */
function normalizeSpans(spans: readonly ChipSpan[]): ChipSpan[] {
  const kept: ChipSpan[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start >= span.end) continue;
    if (kept.some((k) => overlaps(k, span.start, span.end))) continue;
    kept.push(span);
  }
  return kept;
}

/**
 * Chip every tag run not already inside a chip. With `onlyTerminated`, a run at
 * the very end is skipped: it is still being typed.
 */
function withTagSpans(
  text: string,
  spans: readonly ChipSpan[],
  grammar: TagGrammar,
  onlyTerminated: boolean,
): ChipSpan[] {
  const merged = [...spans];
  for (const match of text.matchAll(tagRunPattern(grammar))) {
    const start = match.index;
    const end = start + match[0].length;
    if (onlyTerminated && end === text.length) continue;
    if (merged.some((s) => overlaps(s, start, end))) continue;
    merged.push({ kind: "tag", start, end, name: tagNameOf(match[0]) });
  }
  return normalizeSpans(merged);
}

/**
 * A reminder's stored text as its composer shows it: each mention token becomes
 * `@Name` with a chip, and every saved `#tag` opens as a chip.
 */
export function draftFromMarkup(markup: string): ComposerDraft {
  let text = "";
  const spans: ChipSpan[] = [];
  for (const segment of splitAnnotatedText(markup)) {
    if (segment.kind !== "mention") {
      text += segment.text;
      continue;
    }
    const start = text.length;
    text += `@${segment.displayName}`;
    spans.push({
      kind: "mention",
      start,
      end: text.length,
      displayName: segment.displayName,
      targetType: segment.targetType,
      targetId: segment.targetId,
    });
  }
  return {
    text,
    spans: withTagSpans(text, spans, "prose", false),
    grammar: "prose",
  };
}

/**
 * The inverse of {@link draftFromMarkup}. A mention chip whose text no longer
 * reads `@displayName` is dropped, and its characters stay as prose.
 */
export function markupFromDraft(draft: ComposerDraft): string {
  let markup = "";
  let last = 0;
  for (const span of draft.spans) {
    if (span.kind !== "mention") continue;
    if (span.start < last) continue; // overlapping; cannot be emitted
    if (draft.text.slice(span.start, span.end) !== `@${span.displayName}`) {
      continue;
    }
    markup += draft.text.slice(last, span.start);
    markup += mentionToken(span.displayName, span.targetType, span.targetId);
    last = span.end;
  }
  return markup + draft.text.slice(last);
}

/**
 * The draft for a Tags field, every saved tag a chip. There is no inverse:
 * `draft.text` is the stored value.
 */
export function draftFromTagField(raw: string): ComposerDraft {
  return {
    text: raw,
    spans: withTagSpans(raw, [], "tagField", false),
    grammar: "tagField",
  };
}

/**
 * Re-fit each tag chip to the run at its position, dropping any with no run
 * left. Mention chips are left alone.
 */
function refitTagSpans(
  text: string,
  spans: readonly ChipSpan[],
  grammar: TagGrammar,
): ChipSpan[] {
  const runs = [...text.matchAll(tagRunPattern(grammar))];
  return spans.flatMap<ChipSpan>((span) => {
    if (span.kind !== "tag") return [span];
    const run = runs.find(
      (m) => m.index < span.end && m.index + m[0].length > span.start,
    );
    if (!run) return [];
    return [
      {
        ...span,
        start: run.index,
        end: run.index + run[0].length,
        name: tagNameOf(run[0]),
      },
    ];
  });
}

/**
 * Apply a field edit, diffed as one contiguous replacement; a chip it reaches
 * goes whole. Move the caret only when `tookChip`: forcing it breaks IME input.
 */
export function applyDraftEdit(
  draft: ComposerDraft,
  nextText: string,
): { draft: ComposerDraft; caret: number; tookChip: boolean } {
  const prev = draft.text;
  if (nextText === prev) {
    return { draft, caret: prev.length, tookChip: false };
  }

  const max = Math.min(prev.length, nextText.length);
  let prefix = 0;
  while (prefix < max && prev[prefix] === nextText[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    prev[prev.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) {
    suffix++;
  }
  const inserted = nextText.slice(prefix, nextText.length - suffix);

  // Widen the replaced range over every chip it reaches into: chips go whole.
  let start = prefix;
  let end = prev.length - suffix;
  let tookChip = false;
  for (const span of draft.spans) {
    if (overlaps(span, start, end)) {
      start = Math.min(start, span.start);
      end = Math.max(end, span.end);
      tookChip = true;
    }
  }

  const text = prev.slice(0, start) + inserted + prev.slice(end);
  const delta = inserted.length - (end - start);
  const shifted = draft.spans.flatMap((span) =>
    span.end <= start
      ? [span]
      : span.start >= end
        ? [{ ...span, start: span.start + delta, end: span.end + delta }]
        : [],
  );
  const refitted = normalizeSpans(refitTagSpans(text, shifted, draft.grammar));

  return {
    draft: {
      text,
      spans: withTagSpans(text, refitted, draft.grammar, true),
      grammar: draft.grammar,
    },
    caret: start + inserted.length,
    tookChip,
  };
}

/**
 * The tag fragment being typed at the caret, which the tag picker searches on,
 * or `null`. A caret inside a chip has none.
 */
export function activeTagQuery(
  draft: ComposerDraft,
  caret: number,
): { query: string; start: number } | null {
  if (draft.grammar === "prose") {
    return activeHashtagQuery(draft.text, caret, draft.spans);
  }
  if (draft.spans.some((s) => caret > s.start && caret <= s.end)) return null;
  let start = caret;
  while (start > 0 && /[\p{L}\p{N}]/u.test(draft.text[start - 1])) start--;
  const query = draft.text.slice(start, caret);
  if (start > 0 && draft.text[start - 1] === "#") start--; // take the sigil too
  return query.length === 0 && start === caret ? null : { query, start };
}

/**
 * Replace the `@` fragment at the caret (or insert at it) with a mention chip,
 * returning the caret at the chip's end.
 */
export function insertMentionInDraft(
  draft: ComposerDraft,
  caret: number,
  mention: Mention,
): { draft: ComposerDraft; caret: number } {
  const active = activeMentionQuery(draft.text, caret, draft.spans);
  return spliceChip(
    draft,
    caret,
    active?.start ?? caret,
    `@${mention.displayName}`,
    (start, end) => ({
      kind: "mention",
      start,
      end,
      displayName: mention.displayName,
      targetType: mention.targetType,
      targetId: mention.targetId,
    }),
  );
}

/**
 * Replace the tag fragment at the caret (or insert at it) with a `#name` chip,
 * committed at once rather than waiting for a space.
 */
export function insertTagInDraft(
  draft: ComposerDraft,
  caret: number,
  name: string,
): { draft: ComposerDraft; caret: number } {
  const active = activeTagQuery(draft, caret);
  return spliceChip(
    draft,
    caret,
    active?.start ?? caret,
    `#${name}`,
    (start, end) => ({ kind: "tag", start, end, name }),
  );
}

/**
 * Replace `[start, caret)` with `label` as a chip, adding a space after it
 * unless one follows. The caret lands at the chip's end, before the space.
 */
function spliceChip(
  draft: ComposerDraft,
  caret: number,
  start: number,
  label: string,
  chip: (start: number, end: number) => ChipSpan,
): { draft: ComposerDraft; caret: number } {
  const after = draft.text.slice(caret);
  const needsSpace = !/^\s/u.test(after); // true when `after` is "" or non-space
  const insertion = needsSpace ? `${label} ` : label;
  const end = start + label.length;
  // How far the text after the replaced fragment moved.
  const delta = insertion.length - (caret - start);

  const spans = draft.spans.flatMap((span) =>
    span.end <= start
      ? [span]
      : span.start >= caret
        ? [{ ...span, start: span.start + delta, end: span.end + delta }]
        : [],
  );

  return {
    draft: {
      text: draft.text.slice(0, start) + insertion + after,
      spans: normalizeSpans([...spans, chip(start, end)]),
      grammar: draft.grammar,
    },
    caret: end,
  };
}

/**
 * Move a caret inside a chip to an edge: onward for a one-character arrow step
 * from `previous`, else the nearer edge.
 */
export function snapCaret(
  spans: readonly ChipSpan[],
  caret: number,
  previous: number | null,
): number {
  const span = spans.find((s) => caret > s.start && caret < s.end);
  if (!span) return caret;
  if (previous === caret + 1) return span.start; // ← one step, travelling left
  if (previous === caret - 1) return span.end; // → one step, travelling right
  return caret - span.start < span.end - caret ? span.start : span.end;
}

/**
 * {@link snapCaret} for a selection: a range covering part of a chip widens to
 * the whole chip.
 */
export function snapSelection(
  spans: readonly ChipSpan[],
  selection: { start: number; end: number },
  previous: number | null,
): { start: number; end: number } {
  if (selection.start === selection.end) {
    const caret = snapCaret(spans, selection.start, previous);
    return { start: caret, end: caret };
  }
  let { start, end } = selection;
  for (const span of spans) {
    if (overlaps(span, start, end)) {
      start = Math.min(start, span.start);
      end = Math.max(end, span.end);
    }
  }
  return { start, end };
}
