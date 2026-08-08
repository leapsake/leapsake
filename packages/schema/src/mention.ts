import type { ChipSpan } from "./composer-draft.js";
import type { EntityType } from "./relationship.js";

/**
 * The fixed namespace every mention **join-row id** is content-addressed under
 * (see `deterministicUuid` in `@leapsake/crypto`, and `mentions-repo.ts`). Kept
 * constant forever — changing it would re-mint every mention row under a new id
 * and duplicate the lot on next sync, exactly like {@link
 * ../reminders/src/engine.ts SYSTEM_REMINDER_NAMESPACE}. The row id is derived
 * from `(bearerType, bearerId, targetType, targetId)`, so two devices that
 * independently re-derive a mention from the *same* (deterministic) reminder text
 * produce the **same** id and the existing whole-row LWW merge collapses them.
 */
export const MENTION_NAMESPACE = "leapsake:mention";

/**
 * One `@mention` embedded **inline** in freeform text as a self-describing token
 * — `@[Alice Ng](person:<uuid>)`. Unlike a `#tag` (which is derivable from a bare
 * word), a mention points at a *specific* pre-existing entity by id: names have
 * spaces, aren't unique, and must never be auto-created. Carrying the id inline
 * makes the text the single source of truth — the rendered forward-link and the
 * derived {@link ../mentioning.js mentions} backlink rows both fall out of it,
 * with no name-resolution or ambiguity step. The embedded `displayName` is a
 * write-time snapshot: the live renderer prefers the target's current label
 * (re-resolved by id), falling back to this name only when the target is gone.
 */
export interface Mention {
  displayName: string;
  targetType: EntityType;
  targetId: string;
}

/**
 * Build the inline token for a mention. The generator uses this today (it holds
 * the label + type + id at generation time); a future authoring typeahead reuses
 * it once a typed name is resolved to an entity. The grammar is a Markdown-link
 * lookalike so it reads acceptably even in a plain-text context that doesn't
 * strip it (see {@link plainMentionText}).
 */
export function mentionToken(
  displayName: string,
  targetType: EntityType,
  targetId: string,
): string {
  return `@[${displayName}](${targetType}:${targetId})`;
}

/** Whether `index` falls inside one of `spans` — i.e. belongs to a chip. */
function isInsideChip(spans: readonly ChipSpan[], index: number): boolean {
  return spans.some((span) => index >= span.start && index < span.end);
}

/**
 * The active `@`-mention fragment at the caret, or `null` when the caret isn't in
 * one. Used by the compose-surface typeahead (both apps) to decide whether to show
 * the People/Pets picker and what to search for; the write path is unaffected
 * (mentions are re-derived from the saved text by {@link parseMentions}).
 *
 * A fragment opens at an `@` that sits at string start or right after whitespace —
 * so `foo@bar` (an email) and a mid-word `@` never trigger — and runs up to the
 * caret. Names carry spaces, so the fragment deliberately spans them (`@ali ng`);
 * it is *not* ended at a space. It is ended by a newline (a mention never wraps a
 * line) and by any token/markup punctuation (`[](){@}`).
 *
 * The text here is what the composer **displays**, where a mention already taken
 * reads `@David Taylor` — indistinguishable from a name being typed. So the
 * already-placed mentions come in as {@link ChipSpan}s (see {@link
 * ../composer-draft.js ComposerDraft}) and end a fragment the same way punctuation
 * does: a caret inside or just past one is not a live query. Without that, the
 * picker would reopen on a completed mention and quietly widen its query across
 * everything typed since. Callers with no spans to give (a plain search box) pass
 * none.
 *
 * The empty fragment (`@` with nothing after it yet) is a valid active query
 * (`query: ""`); the caller's search floor keeps it quiet until a character is
 * typed. Returns the `start` index of the opening `@` so {@link
 * ../composer-draft.js insertMentionInDraft} knows the span to replace.
 * Platform-agnostic and unit-testable.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
  spans: readonly ChipSpan[] = [],
): { query: string; start: number } | null {
  // Walk back from the caret to the nearest '@' that could open a fragment. Stop
  // early at a newline (a fragment can't span one); the first '@' we reach is the
  // only candidate, since a valid fragment can't itself contain an '@'.
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "\n") return null;
    // A character belonging to a mention already placed — including its own '@'.
    if (isInsideChip(spans, i)) return null;
    if (ch === "@") {
      const before = i > 0 ? text[i - 1] : "";
      // An opener must be at string start or right after whitespace.
      if (before !== "" && !/\s/u.test(before)) return null;
      const query = text.slice(i + 1, caret);
      // Token/markup punctuation means this isn't a name being typed (it's an
      // existing token, or a caret parked inside/after one) — not a live query.
      if (/[[\]()@]/u.test(query)) return null;
      return { query, start: i };
    }
  }
  return null;
}

/**
 * The active `#`-hashtag fragment at the caret, or `null` when the caret isn't in
 * one. The sibling of {@link activeMentionQuery} for the compose-surface typeahead
 * (both apps): it decides whether to show the existing-tags picker and what to
 * search for. The write path is unaffected — hashtags are re-derived from the
 * saved text by {@link ./tag.js parseHashtags}, so a brand-new tag with no
 * suggestion is still created on save; this only offers completions.
 *
 * A fragment opens at a `#` that sits at string start or right after whitespace
 * (so `a#b` mid-word and `##x` never trigger) and runs to the caret. Unlike a
 * mention, a tag is a single {@link ./tag.js parseHashtags} token — a maximal run
 * of `[\p{L}\p{N}]` — so the fragment ends at the **first** non-alphanumeric char:
 * `#fam` is active but `#fam ` (trailing space) has ended it, and the caret moving
 * onto punctuation/a newline closes it. The empty fragment (`#` with nothing after
 * it yet) is a valid active query (`query: ""`); the caller's search floor keeps it
 * quiet until a character is typed. A `#` embedded in a mention's display name
 * (`@Team #1`) belongs to that mention, not to a live hashtag, so — as in {@link
 * activeMentionQuery} — the already-placed {@link ChipSpan}s are passed in and
 * a `#` inside one returns `null`. Returns the `start` index of the opening `#` so
 * {@link ../composer-draft.js insertTagInDraft} knows the span to replace.
 * Platform-agnostic and unit-testable.
 */
export function activeHashtagQuery(
  text: string,
  caret: number,
  spans: readonly ChipSpan[] = [],
): { query: string; start: number } | null {
  // Walk back from the caret through the tag's alphanumeric run to its opening
  // '#'. Any other character (whitespace, punctuation, a newline, a token
  // bracket) breaks the run: a hashtag is a single [\p{L}\p{N}] token, so the
  // first non-alphanumeric before '#' means the caret isn't in a live fragment.
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "#") {
      const before = i > 0 ? text[i - 1] : "";
      // An opener must be at string start or right after whitespace.
      if (before !== "" && !/\s/u.test(before)) return null;
      // A '#' inside a mention is part of its name, not a live hashtag.
      if (isInsideChip(spans, i)) return null;
      return { query: text.slice(i + 1, caret), start: i };
    }
    if (!/[\p{L}\p{N}]/u.test(ch)) return null;
  }
  return null;
}

/**
 * Extract the mentions embedded **inline** in freeform prose, in first-seen
 * order, **deduped by target** (`targetType:targetId` — a repeated mention of the
 * same entity yields one row, first spelling wins). The display run forbids `]`
 * and the id must be a strict UUID, so ordinary prose can never be mistaken for a
 * token. This is the derivation input for the `mentions` join: the reminder text
 * is re-parsed on every write and the rows reconciled to match (mirrors {@link
 * ./tag.js parseHashtags} → taggings). Platform-agnostic and unit-testable.
 */
export function parseMentions(text: string): Mention[] {
  const seen = new Set<string>();
  const mentions: Mention[] = [];
  for (const match of text.matchAll(
    /@\[([^\]]+)\]\((person|pet):([0-9a-fA-F-]{36})\)/gu,
  )) {
    const targetType = match[2] as EntityType;
    const targetId = match[3];
    const key = `${targetType}:${targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({ displayName: match[1], targetType, targetId });
  }
  return mentions;
}

/**
 * Replace each inline mention token with the `@name` a reader sees — `@[Alice
 * Ng](person:…)` → `@Alice Ng` — for the plain-text contexts that show a
 * reminder's raw title/body as a string rather than through the `ReminderText`
 * renderer (delete confirmations, list labels; see {@link ./reminder.js
 * reminderLabel}). The sigil is kept because that is what the composer and the
 * rendered view both show; only the id is machine-facing. Idempotent: text with
 * no token is returned unchanged, and a once-stripped string has nothing left to
 * strip.
 */
export function plainMentionText(text: string): string {
  return text.replace(
    /@\[([^\]]+)\]\((?:person|pet):[0-9a-fA-F-]{36}\)/gu,
    (_match, display: string) => `@${display}`,
  );
}

/**
 * One piece of freeform reminder text: a run of ordinary prose, an inline `#tag`,
 * or an `@mention`. The `text` is always the exact source substring (so the
 * pieces concatenate back to the input); a renderer shows a hashtag's `text`
 * verbatim as its link label, but a mention's live/looked-up label in place of
 * `text` (falling back to `displayName`, the write-time snapshot in the token).
 */
export type AnnotatedSegment =
  | { kind: "text"; text: string }
  | { kind: "hashtag"; text: string; tagName: string }
  | {
      kind: "mention";
      text: string;
      displayName: string;
      targetType: EntityType;
      targetId: string;
    };

/**
 * Split freeform text into ordered {@link AnnotatedSegment}s, marking each inline
 * `#tag` and `@mention` in a **single** pass so the two never mis-nest. It unions
 * the very patterns {@link ./tag.js parseHashtags} and {@link parseMentions} use,
 * so the marked runs are exactly the tokens that became stored taggings/mentions
 * — the shared render seam for both apps' `ReminderText`. Platform-agnostic (no
 * DOM / RN), directly unit-testable; the empty string → `[]`.
 */
export function splitAnnotatedText(text: string): AnnotatedSegment[] {
  const segments: AnnotatedSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(
    /#([\p{L}\p{N}]+)|@\[([^\]]+)\]\((person|pet):([0-9a-fA-F-]{36})\)/gu,
  )) {
    const start = match.index;
    if (start > last)
      segments.push({ kind: "text", text: text.slice(last, start) });
    if (match[1] !== undefined) {
      segments.push({ kind: "hashtag", text: match[0], tagName: match[1] });
    } else {
      segments.push({
        kind: "mention",
        text: match[0],
        displayName: match[2],
        targetType: match[3] as EntityType,
        targetId: match[4],
      });
    }
    last = start + match[0].length;
  }
  if (last < text.length)
    segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}
