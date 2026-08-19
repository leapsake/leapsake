import { z } from "zod";

/**
 * Where an entity stands in your catalog — whether it is one of *your* people
 * and pets, or something smaller that exists only because a real one does.
 *
 * - `published` — an ordinary entity. Listed on People & Pets, offered by every
 *   picker, searchable in its own right, seen by duplicate detection. Everything
 *   was this before the column existed, and everything still defaults to it.
 * - `unpublished` — an entity that exists *only as a fact about a published
 *   one*: your coworker's wife, recorded as a name on the relationship and
 *   nothing more. It has no place in the catalog and is offered by no picker, so
 *   two coworkers' wives both called "Jen" are simply two different people. It
 *   is real, durable, synced data — not a draft — and it becomes `published` the
 *   moment it stops being only a name (see the promotion rule in `@leapsake/core`).
 * - `draft` — **reserved, and nothing implements it.** It is here so that the
 *   half-finished record of an in-progress create has a value to take when that
 *   work lands, rather than forcing a second migration and a re-think of every
 *   `standing = 'published'` predicate. A draft would differ from an unpublished
 *   entity on the two axes that matter: it is swept away if abandoned, and it is
 *   hidden from duplicate detection until it is finished.
 *
 * The three are one column rather than two booleans because they are mutually
 * exclusive and totally ordered by visibility, and because a pair of flags would
 * make three of its four states legal to write and only two meaningful.
 */
export const standingSchema = z.enum(["draft", "unpublished", "published"]);

export type Standing = z.infer<typeof standingSchema>;

/**
 * The same values as they sit in a row: absent means `published`.
 *
 * This is a **separate schema, not `standingSchema.default(…)` reused**, and the
 * distinction is load-bearing. A defaulted schema fills itself in even under
 * `.optional()`, so putting one in an update input makes every patch — including
 * a patch that touches only a gender — carry `standing: "published"`. That would
 * quietly republish an unpublished person on any edit at all, which is the exact
 * opposite of promoting them deliberately.
 *
 * So: inputs take the bare {@link standingSchema} and say nothing unless they
 * mean to, while the row takes this one, where the default earns its place — it
 * is what lets a record pulled from a peer that predates the column decode as
 * one of the user's own people instead of failing validation.
 */
export const standingColumnSchema = standingSchema.default("published");

/**
 * Is this entity one of the user's own — the catalog's membership test?
 *
 * Spelled as a predicate over the value rather than `=== "published"` scattered
 * about, so that adding `draft` to the set of things that are hidden (or ever
 * taking one out) is a change to this function and not a hunt.
 */
export function isPublished(standing: Standing): boolean {
  return standing === "published";
}

/** The SQL predicate matching {@link isPublished}, for the reads that filter in
 *  the database rather than in memory. No parameters, so it composes into a
 *  `WHERE` fragment without disturbing anyone's `?` bindings. */
export const PUBLISHED_SQL = "standing = 'published'";
