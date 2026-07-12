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
 * Replace each inline mention token with its bare display name — `@[Alice
 * Ng](person:…)` → `Alice Ng` — for the plain-text contexts that show a
 * reminder's raw title/body as a string rather than through the `ReminderText`
 * renderer (delete confirmations, list labels; see {@link ./reminder.js
 * reminderLabel}). Idempotent: text with no token is returned unchanged, and a
 * once-stripped string has nothing left to strip.
 */
export function plainMentionText(text: string): string {
  return text.replace(
    /@\[([^\]]+)\]\((?:person|pet):[0-9a-fA-F-]{36}\)/gu,
    (_match, display: string) => display,
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
