import { z } from "zod";

/**
 * A Tag — a free-form label shared across entities to group like and unlike
 * things together (People and Pets today; more entity types later). Tags are deduplicated
 * by their {@link normalized} form, so "Friend", "friend", and " Friend " all map
 * to a single tag; the {@link name} preserves the first-seen spelling for display.
 *
 * A tag's content is a single run of letters/numbers — no spaces or punctuation
 * (see {@link parseTagNames}). The leading "#" sigil shown in the UI is
 * presentation only and is never stored in {@link name}.
 *
 * Same sync-safe conventions as Person (see AGENTS.md): client-generated
 * UUID primary key, epoch-ms UTC timestamps, nullable `deletedAt` for soft deletes.
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
 * Split a raw tags field into unique display names. A tag is a maximal run of
 * letters and numbers; **every other character — whitespace, commas, other
 * punctuation, and the "#" sigil — is a separator**. So "Friend, Colleague",
 * "Friend Colleague", and "#Friend #Colleague" all yield ["Friend",
 * "Colleague"], and an inline "my #friend." contributes just "friend". This is
 * the single chokepoint that keeps spaces/punctuation out of stored tag names
 * (so a tag is freely embeddable in prose later) and strips the optional "#".
 * Duplicates are removed by {@link normalizeTagName}; the first spelling wins.
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
 * Extract the `#`-prefixed tags embedded **inline** in freeform prose — e.g.
 * `"call mom #family #urgent"` yields `["family", "urgent"]`. Unlike
 * {@link parseTagNames} (which treats *every* word as a tag, right for a
 * dedicated tags field), this matches only tokens introduced by a `#` sigil, so
 * it can run over a reminder's title/body without turning ordinary words into
 * tags. A tag is the maximal run of letters/numbers after the `#`. Duplicates
 * are removed by {@link normalizeTagName}; the first spelling wins.
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
