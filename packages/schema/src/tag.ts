import { z } from "zod";

/**
 * A Tag — a free-form label shared across entities to group like and unlike
 * things together (People and Pets today; more entity types later). Tags are deduplicated
 * by their {@link normalized} form, so "Friend", "friend", and " Friend " all map
 * to a single tag; the {@link name} preserves the first-seen spelling for display.
 *
 * Same sync-safe conventions as Person (see reboot-plan.md §4.2): client-generated
 * UUID primary key, epoch-ms UTC timestamps, nullable `deletedAt` for soft deletes.
 */
export const tagSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1), // display form, first spelling seen
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
 * Parse the comma-separated tags form field into unique, non-empty display
 * names. Whitespace is trimmed, empties dropped, and duplicates removed by
 * normalized form — the first spelling wins (e.g. "Friend, friend" -> ["Friend"]).
 */
export function parseTagNames(raw: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name.length === 0) continue;
    const key = normalizeTagName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
