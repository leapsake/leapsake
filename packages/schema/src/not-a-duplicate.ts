import { z } from "zod";

/**
 * A "not a duplicate" memory — the user reviewed a proposed merge and said the
 * two people are *not* the same, in its stored shape. The behavioural type and
 * repository live in `@leapsake/data`; this schema exists so sync can validate a
 * row pulled from a peer before applying it (the data package has no Zod surface
 * of its own), and so `defineSyncable` can derive its columns.
 *
 * The pair is **canonicalized** by the repo — `lowerId` < `higherId` — so the
 * unordered pair (A,B) is a single row. People-only for v1; no `entityType`.
 *
 * Same sync-safe substrate as every domain row (see AGENTS.md): client
 * UUID id, epoch-ms UTC timestamps, nullable `deletedAt` — so it merges via
 * whole-row LWW ({@link resolveMerge}) and rides the sync allowlist like the
 * rest, which is what keeps a rejection from re-nagging on other devices.
 */
export const notADuplicateSchema = z.object({
  id: z.uuid(),
  lowerId: z.uuid(),
  higherId: z.uuid(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type NotADuplicate = z.infer<typeof notADuplicateSchema>;
