import { z } from "zod";

/**
 * `unpublished` entities exist only as a fact about a published one, and no
 * list or picker offers them. `draft` is reserved and unused.
 */
export const standingSchema = z.enum(["draft", "unpublished", "published"]);

export type Standing = z.infer<typeof standingSchema>;

/**
 * The row's column, absent meaning `published`. Never use it in an input: the
 * default would fill every patch and republish unpublished people.
 */
export const standingColumnSchema = standingSchema.default("published");

/** Whether an entity is one of the user's own. */
export function isPublished(standing: Standing): boolean {
  return standing === "published";
}

/** {@link isPublished} as a parameterless SQL predicate. */
export const PUBLISHED_SQL = "standing = 'published'";
