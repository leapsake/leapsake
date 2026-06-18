import { z } from "zod";
import { entityTypeSchema, relationshipRoleSchema } from "./relationship.js";

/**
 * A relationship dismissal — a rejected *derived* edge — in its stored shape.
 * The behavioural type and repository live in `@leapsake/data`; this schema
 * exists so sync can validate a dismissal pulled from a peer before applying it
 * (the data package has no Zod surface of its own). `role` is the dismissed base
 * role, or `null` to suppress any derived edge between the pair.
 *
 * Same sync-safe substrate as every domain row (reboot-plan.md §4.2): client
 * UUID id, epoch-ms UTC timestamps, nullable `deletedAt` — so it merges via
 * whole-row LWW ({@link resolveMerge}) like the rest.
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
