import { z } from "zod";

/**
 * Two people the user said are not duplicates, stored as one row per pair with
 * `lowerId < higherId`. Here so sync can validate a peer's row.
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
