import { z } from "zod";
import { entityTypeSchema, relationshipRoleSchema } from "./relationship.js";

/**
 * A rejected derived relationship; a null `role` suppresses every derived edge
 * between the pair. Here so sync can validate a peer's row.
 */
export const dismissalSchema = z.object({
  id: z.uuid(),
  subjectType: entityTypeSchema,
  subjectId: z.uuid(),
  otherType: entityTypeSchema,
  otherId: z.uuid(),
  role: relationshipRoleSchema.nullable(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});
