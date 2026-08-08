import type { EntityType } from "./relationship.js";
import {
  type Mention,
  activeHashtagQuery,
  activeMentionQuery,
  mentionToken,
  splitAnnotatedText,
} from "./mention.js";

/**
 * A **chip**: a run of a composer's text that behaves as one thing rather than as
 * the characters it is made of. `text.slice(start, end)` is the run a reader sees,
 * sigil included — the caret never lands inside it ({@link snapCaret}), and an
 * edit that reaches into it takes the whole run ({@link applyDraftEdit}).
 *
 * The two kinds differ in exactly one respect, and it follows from what backs
 * them. A **mention** stands for an id, so its content is fixed: it can be
 * deleted but never grown. A **tag** *is* its text — the stored tag is whatever
 * the run spells — so it re-fits to the run at its position after every edit,
 * which is what lets typing at its trailing edge extend it.
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
 * How a field spells its tags — the one thing that differs between the two
 * surfaces where tags are typed, and the reason a draft carries it around:
 *
 * - `"prose"` — a reminder's title/body. Only `#`-prefixed runs are tags (see
 *   {@link ./tag.js parseHashtags}), because ordinary words must stay ordinary.
 * - `"tagField"` — a Person/Pet/GiftIdea Tags field. **Every** word run is a tag
 *   and the `#` is optional decoration (see {@link ./tag.js parseTagNames}), so
 *   `neighbor` is stored exactly as `#Friend` is.
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
 * What a compose surface shows while the user types: the text as they see it —
 * `Call @David Taylor about #family` — plus the chips marking which runs are more
 * than the characters they contain.
 *
 * For a mention the *stored* form differs from the shown one
 * (`@[David Taylor](person:<uuid>)`; see {@link ./mention.js mentionToken}) and
 * the chip is what carries the id across an edit. For a tag the stored form is
 * the text itself, and the chip carries something the text cannot say: whether
 * that tag is **set**. A `#family` still being typed and a `#family` already
 * committed look identical, but only the second is a chip — so this is state a
 * field keeps, not something re-derivable from its value.
 *
 * Everything here works in displayed-text coordinates, which is exactly what a
 * DOM `selectionStart` or a React Native selection event reports. Spans are
 * ordered by `start` and never overlap ({@link normalizeSpans}).
 */
export interface ComposerDraft {
  text: string;
  spans: ChipSpan[];
  grammar: TagGrammar;
}

/**
 * One run of a draft's displayed text: ordinary typed text, or a chip. The runs
 * concatenate back to `draft.text`, so a renderer can style the chips — a tinted
 * background in both composers — without knowing anything about the grammars.
 * The shared seam for the desktop backdrop layer and the mobile `TextInput`'s
 * styled children.
 */
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
 * Sort spans and drop any that overlaps one already kept. Overlap is not a shape
 * the renderer or the caret rules can express, and re-fitting can produce it
 * honestly — delete the space in `#work #life` and both chips land on the single
 * run `#work#life`, where only the first survives as that run's chip.
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
 * Mint a set tag chip for every tag run in `text`, except runs already inside a
 * chip — a `#` in a mention's display name (`@Team #1`) belongs to that mention —
 * and, when `onlyTerminated`, except a run still at the very end of the text.
 * That exception is what "a new tag chips as soon as you type the space" means:
 * a trailing run is still being typed.
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
 * Project a reminder's stored text into what its composer displays: each
 * `@[Name](type:id)` token becomes `@Name` with a chip carrying the id, and every
 * `#tag` already in the text becomes a **set** chip — text that has been saved
 * has had its tags committed, so they open as chips. Built on {@link
 * splitAnnotatedText} so the token grammar has exactly one definition.
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
 * The inverse of {@link draftFromMarkup}: put the mention ids back, turning each
 * mention chip into its stored {@link mentionToken} and copying everything else —
 * prose and `#tags`, which are stored exactly as they read — through. A mention
 * chip whose slice no longer reads `"@" + displayName` has been edited out from
 * under us and is dropped; its characters stay, as plain prose.
 */
export function markupFromDraft(draft: ComposerDraft): string {
  let markup = "";
  let last = 0;
  for (const span of draft.spans) {
    if (span.kind !== "mention") continue;
    if (span.start < last) continue; // overlapping — not a shape we can emit
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
 * The draft for a dedicated Tags field, where the text *is* the stored value and
 * every word run is a tag ({@link TagGrammar}). Everything present when the field
 * opens is a set chip, for the same reason as in {@link draftFromMarkup}: it has
 * been saved. There is no inverse — `draft.text` is the value.
 */
export function draftFromTagField(raw: string): ComposerDraft {
  return {
    text: raw,
    spans: withTagSpans(raw, [], "tagField", false),
    grammar: "tagField",
  };
}

/**
 * Re-fit each tag chip to the run at its position, and drop the ones with no run
 * left. A tag chip *is* its text, so an edit at its trailing edge grows it rather
 * than landing outside it — the only way to fix a typo in a set tag without
 * deleting the whole thing. Mention chips are left alone: theirs is a fixed run
 * standing for an id.
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
 * Reconcile a draft with the text the user just typed, and return the new draft
 * plus where the caret belongs. A field edit — typing, pasting, backspacing,
 * replacing a selection — is always **one contiguous replacement**, so the range
 * it touched can be recovered from the two strings alone by matching their common
 * prefix and suffix; no keystroke plumbing, and it behaves identically on both
 * platforms.
 *
 * A chip is atomic, so the replaced range is widened to the **union** of the edit
 * with every chip it reaches into, and the whole union goes:
 *
 * ```
 * text  = prev[0, union.start) + inserted + prev[union.end, …)
 * caret = union.start + inserted.length
 * ```
 *
 * That one rule is what makes backspace at a chip's end delete the whole chip,
 * and a paste over part of one take all of it. When it fires, `tookChip` says so
 * and `caret` is where the caret belongs — more was removed than the keystroke
 * asked for, so the field's own caret is now wrong and the caller must move it.
 * On an ordinary edit `tookChip` is false and the caller should leave the caret
 * alone: forcing it on every keystroke is what breaks IME composition.
 *
 * Surviving chips then shift, tag chips re-fit to their runs ({@link
 * refitTagSpans}), and any tag run that is now terminated and not yet covered
 * becomes a set chip ({@link withTagSpans}).
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
 * The tag fragment being typed at the caret, or `null` when there isn't one —
 * what the existing-tag picker searches on, and the span {@link insertTagInDraft}
 * replaces. In `"prose"` this is {@link activeHashtagQuery}'s `#`-opened
 * fragment; in a `"tagField"`, where every word is a tag, it is the word run
 * ending at the caret, with its optional `#`. A caret inside a chip yields
 * `null` — a set tag is not a query — though the caret rules already keep it out.
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
 * Splice a resolved mention into a draft, replacing the active `@`-fragment at
 * the caret with `@DisplayName` plus a chip carrying the id, and return the new
 * draft with the caret at the chip's end. The picker calls this when the user
 * takes a hit.
 *
 * The counterpart to {@link activeMentionQuery}, whose fragment span it
 * re-derives so it always replaces exactly what the picker was querying on; if
 * the caret isn't in a fragment the name is inserted at the caret without
 * replacing anything.
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
 * Splice a chosen tag into a draft, replacing the active fragment at the caret
 * with `#name` and a **set** chip — a tag taken from the picker is committed at
 * once, unlike one being typed, which waits for a terminator ({@link
 * applyDraftEdit}). The twin of {@link insertMentionInDraft}; it re-derives the
 * fragment from {@link activeTagQuery} for the same reason.
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
 * Replace `[start, caret)` with `label`, mint the chip it becomes, and shift what
 * follows — the shared body of the two insert helpers, which differ only in the
 * chip they make. A single trailing space is appended unless the next character
 * is already whitespace, so the chip stays a discrete word and the next `@`/`#`
 * typed after it can open the picker again; the returned caret sits at the chip's
 * end, before that space.
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
 * Where the caret belongs, given where the field put it. A chip is one thing, so
 * the caret rests at its edges but never inside it. An **arrow-key step** — a
 * move of exactly one character — is carried on the way it was going, left to the
 * chip's start and right to its end, so `←` from a chip's end steps over the
 * whole chip in one press rather than into it. Any other arrival (a click, a tap,
 * a programmatic jump) has no direction to honour and goes to the nearer edge.
 *
 * `previous` is where the caret was before this move, or `null` when there is
 * none to compare against. Platform-agnostic: both apps feed it their own
 * selection events.
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
 * {@link snapCaret} for a selection. A collapsed selection is a caret and snaps
 * as one; a range that covers part of a chip is widened over the whole of it, so
 * that deleting, replacing or dragging a selection can never take half a chip.
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
