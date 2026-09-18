import { z } from "zod";

/**
 * A label shared across entities: one run of letters and numbers, deduplicated
 * by `normalized`. The "#" is never stored.
 */
export const tagSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1), // display form, first spelling seen (no "#" sigil)
  normalized: z.string().min(1), // trimmed + lowercased dedup key
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(), // epoch ms, UTC
  deletedAt: z.number().int().nullable(),
});

export type Tag = z.infer<typeof tagSchema>;

/** The canonical dedup key for a tag name: trimmed and lowercased. */
export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * A tags field's unique names: each run of letters and numbers, anything else a
 * separator. The first spelling of a duplicate wins.
 */
export function parseTagNames(raw: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of raw.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const key = normalizeTagName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * The unique `#` tags in prose: `"call mom #family"` yields `["family"]`. The
 * first spelling of a duplicate wins.
 */
export function parseHashtags(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of text.matchAll(/#([\p{L}\p{N}]+)/gu)) {
    const name = match[1];
    const key = normalizeTagName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** One piece of text: a `#tag` with its `tagName`, or prose with null. */
export interface HashtagSegment {
  text: string;
  tagName: string | null;
}

/**
 * Split text into segments with {@link parseHashtags}'s pattern, so marked runs
 * are exactly the stored tags. The pieces join back to the input.
 */
export function splitHashtags(text: string): HashtagSegment[] {
  const segments: HashtagSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(/#([\p{L}\p{N}]+)/gu)) {
    const start = match.index;
    if (start > last)
      segments.push({ text: text.slice(last, start), tagName: null });
    segments.push({ text: match[0], tagName: match[1] });
    last = start + match[0].length;
  }
  if (last < text.length)
    segments.push({ text: text.slice(last), tagName: null });
  return segments;
}
