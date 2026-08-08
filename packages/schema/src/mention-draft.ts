import type { EntityType } from "./relationship.js";
import {
  type Mention,
  activeMentionQuery,
  mentionToken,
  splitAnnotatedText,
} from "./mention.js";

/**
 * Where one mention sits in a {@link MentionDraft}'s **displayed** text, plus the
 * target the display run stands for. `text.slice(start, end)` is always
 * `"@" + displayName` — the span covers the sigil, so styling includes it and
 * deleting it kills the mention like any other character of the name.
 */
export interface MentionSpan {
  /** Index of the `@`. */
  start: number;
  /** Exclusive end, just past the last character of the display name. */
  end: number;
  displayName: string;
  targetType: EntityType;
  targetId: string;
}

/**
 * What a compose surface shows while the user types: the text as they see it —
 * `Call @David Taylor about it` — plus the spans marking which runs are mentions.
 * The *stored* form is unchanged (`@[David Taylor](person:<uuid>)`; see {@link
 * ./mention.js mentionToken}), because the text is still the single source of
 * truth for the derived `mentions` rows. This is only a projection of it for
 * display: forty characters of machine-readable id are noise in a field someone
 * is mid-sentence in.
 *
 * The composers hold the **markup** as their value and re-derive the draft on
 * every render ({@link draftFromMarkup} → edit → {@link markupFromDraft}), so
 * there is no second copy of the truth to keep in step. Everything here works in
 * displayed-text coordinates, which is exactly what a DOM `selectionStart` or a
 * React Native selection event reports.
 *
 * Spans are ordered by `start` and never overlap.
 */
export interface MentionDraft {
  text: string;
  spans: MentionSpan[];
}

/**
 * One run of a draft's displayed text: either ordinary typed text (`mention`
 * null) or the `@Name` of a mention. The runs concatenate back to `draft.text`,
 * so a renderer can style the mention runs — a tinted chip in both composers —
 * without knowing anything about the token grammar. The shared seam for the
 * desktop backdrop layer and the mobile `TextInput`'s styled children.
 */
export interface DraftSegment {
  text: string;
  mention: MentionSpan | null;
}

/** Split a draft's text into its plain and mention runs, in order. */
export function splitDraft(draft: MentionDraft): DraftSegment[] {
  const segments: DraftSegment[] = [];
  let last = 0;
  for (const span of draft.spans) {
    if (span.start > last) {
      segments.push({
        text: draft.text.slice(last, span.start),
        mention: null,
      });
    }
    segments.push({
      text: draft.text.slice(span.start, span.end),
      mention: span,
    });
    last = span.end;
  }
  if (last < draft.text.length) {
    segments.push({ text: draft.text.slice(last), mention: null });
  }
  return segments;
}

/**
 * Project stored text into what the composer displays: each `@[Name](type:id)`
 * token becomes `@Name` with a span recording the id it stands for; everything
 * else — prose and `#tags`, which are already readable as typed — is copied
 * verbatim. Built on {@link splitAnnotatedText} so the token grammar has exactly
 * one definition.
 */
export function draftFromMarkup(markup: string): MentionDraft {
  let text = "";
  const spans: MentionSpan[] = [];
  for (const segment of splitAnnotatedText(markup)) {
    if (segment.kind !== "mention") {
      text += segment.text;
      continue;
    }
    const start = text.length;
    text += `@${segment.displayName}`;
    spans.push({
      start,
      end: text.length,
      displayName: segment.displayName,
      targetType: segment.targetType,
      targetId: segment.targetId,
    });
  }
  return { text, spans };
}

/**
 * The inverse of {@link draftFromMarkup}: put the ids back, turning each span
 * into its stored {@link mentionToken} and copying the text between spans
 * through. A span whose slice no longer reads `"@" + displayName` has been
 * edited out from under us and is dropped — its characters stay, as plain prose.
 * That is the decay rule of {@link applyDraftEdit} enforced a second time, so a
 * caller that builds a draft by hand can't mint a token for text that doesn't
 * say the name.
 */
export function markupFromDraft(draft: MentionDraft): string {
  let markup = "";
  let last = 0;
  for (const span of draft.spans) {
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
 * Reconcile a draft's spans with the text the user just typed, and return the
 * new draft. A field edit — typing, pasting, backspacing, replacing a selection —
 * is always **one contiguous replacement**, so the span it touched can be
 * recovered from the two strings alone by matching their common prefix and
 * suffix; no keystroke plumbing needed, and it works identically on both
 * platforms.
 *
 * Spans wholly before the edit are untouched, spans wholly after it shift, and a
 * span the edit reached *into* is **dropped**: the letters stay on screen but
 * stop being a mention, so backspacing into `@David Taylor` deletes one character
 * at a time rather than swallowing the name whole. The boundaries are half-open
 * in the user's favour — typing immediately after a mention (or immediately
 * before it) leaves it intact.
 */
export function applyDraftEdit(
  draft: MentionDraft,
  nextText: string,
): MentionDraft {
  const prev = draft.text;
  if (nextText === prev) return draft;

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

  // The replaced span of the old text, and how much longer the text just got.
  const removedStart = prefix;
  const removedEnd = prev.length - suffix;
  const delta = nextText.length - prev.length;

  const spans: MentionSpan[] = [];
  for (const span of draft.spans) {
    if (span.end <= removedStart) {
      spans.push(span);
    } else if (span.start >= removedEnd) {
      spans.push({ ...span, start: span.start + delta, end: span.end + delta });
    }
    // Anything else overlaps the edit: the mention decays to plain text.
  }
  return { text: nextText, spans };
}

/**
 * Splice a resolved mention into a draft, replacing the active `@`-fragment at
 * the caret with `@DisplayName` plus a span carrying the id, and return the new
 * draft with the caret just past the inserted name. The picker calls this when
 * the user takes a hit; the composer then feeds {@link markupFromDraft} back to
 * its `onChange`.
 *
 * The counterpart to {@link activeMentionQuery}, whose fragment span it
 * re-derives so it always replaces exactly what the picker was querying on; if
 * the caret isn't in a fragment the name is inserted at the caret without
 * replacing anything. A single trailing space follows the insertion (unless the
 * next character is already whitespace) so the mention stays a discrete word and
 * a subsequent `@` typed after it can open the picker again — the returned caret
 * sits before that space.
 */
export function insertMentionInDraft(
  draft: MentionDraft,
  caret: number,
  mention: Mention,
): { draft: MentionDraft; caret: number } {
  const active = activeMentionQuery(draft.text, caret, draft.spans);
  const start = active ? active.start : caret;
  const label = `@${mention.displayName}`;
  const after = draft.text.slice(caret);
  const needsSpace = !/^\s/u.test(after); // true when `after` is "" or non-space
  const insertion = needsSpace ? `${label} ` : label;
  const end = start + label.length;
  // How far the text after the replaced fragment moved.
  const delta = insertion.length - (caret - start);

  const spans: MentionSpan[] = [];
  for (const span of draft.spans) {
    if (span.end <= start) {
      spans.push(span);
    } else if (span.start >= caret) {
      spans.push({ ...span, start: span.start + delta, end: span.end + delta });
    }
    // A span overlapping the replaced fragment can't survive it — but the
    // fragment can't overlap one either (`activeMentionQuery` stops at a span),
    // so this only guards a hand-built caret.
  }
  spans.push({
    start,
    end,
    displayName: mention.displayName,
    targetType: mention.targetType,
    targetId: mention.targetId,
  });
  spans.sort((a, b) => a.start - b.start);

  return {
    draft: { text: draft.text.slice(0, start) + insertion + after, spans },
    caret: end,
  };
}
