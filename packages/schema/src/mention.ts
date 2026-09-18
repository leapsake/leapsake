import type { ChipSpan } from "./composer-draft.js";
import type { EntityType } from "./relationship.js";

/**
 * The namespace a mention row's id is derived under, from bearer and target.
 * Never change it: every mention row would re-mint and duplicate on sync.
 */
export const MENTION_NAMESPACE = "leapsake:mention";

/**
 * An inline `@[Violet Bick](person:<uuid>)` token. `displayName` is a snapshot;
 * renderers prefer the target's current label.
 */
export interface Mention {
  displayName: string;
  targetType: EntityType;
  targetId: string;
}

/** The inline token for a mention, shaped like a Markdown link. */
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
 * The `@` fragment being typed at the caret, or `null`. It may span spaces, and
 * ends at a newline, token punctuation, or a placed mention chip.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
  spans: readonly ChipSpan[] = [],
): { query: string; start: number } | null {
  // The first '@' back from the caret is the only candidate opener.
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "\n") return null;
    if (isInsideChip(spans, i)) return null;
    if (ch === "@") {
      const before = i > 0 ? text[i - 1] : "";
      // An opener must be at string start or right after whitespace.
      if (before !== "" && !/\s/u.test(before)) return null;
      const query = text.slice(i + 1, caret);
      // Token punctuation means an existing token, not a name being typed.
      if (/[[\]()@]/u.test(query)) return null;
      return { query, start: i };
    }
  }
  return null;
}

/**
 * The `#` fragment being typed at the caret, or `null`. It ends at the first
 * non-alphanumeric character; a `#` inside a chip does not open one.
 */
export function activeHashtagQuery(
  text: string,
  caret: number,
  spans: readonly ChipSpan[] = [],
): { query: string; start: number } | null {
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
 * The mention tokens in `text`, one per target in first-seen order. The strict
 * id pattern keeps ordinary prose from reading as a token.
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

/** Replace each mention token with the `@Violet Bick` a reader sees. */
export function plainMentionText(text: string): string {
  return text.replace(
    /@\[([^\]]+)\]\((?:person|pet):[0-9a-fA-F-]{36}\)/gu,
    (_match, display: string) => `@${display}`,
  );
}

/**
 * One piece of reminder text: prose, a `#tag`, or a mention. Each `text` is the
 * exact source substring, so the pieces join back to the input.
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
 * Split text into segments in one pass over the same patterns the tag and
 * mention parsers use, so marked runs match what was stored.
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
