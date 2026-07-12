import { z } from "zod";
import { type EntityType, entityTypeSchema } from "./relationship.js";

/**
 * The entity types that can *bear* an `@mention` — i.e. hold the freeform text a
 * mention is embedded in. A Reminder today; milestone notes, bios, and other
 * freeform fields join later. Like {@link ./tagging.js tagBearerTypeSchema}, the
 * bearer is a polymorphic `(bearerType, bearerId)` pair, so a new bearer type
 * joins without a schema change. Kept **separate** from the *target* type below:
 * the thing holding the text (a reminder) is a different axis from the thing
 * referenced (a person/pet).
 */
export const mentionBearerTypeSchema = z.enum(["reminder"]);

export type MentionBearerType = z.infer<typeof mentionBearerTypeSchema>;

/**
 * A mention — the join row that records "bearer B's text references entity E",
 * derived from an inline {@link ./mention.js mentionToken} in the bearer's text.
 * It exists purely as a **synced, indexed backlink**: the text is the single
 * source of truth (re-derived on every write), and this row makes "what mentions
 * this person?" an indexed lookup (`ix_mentions_target`) instead of a scan of
 * every reminder. The `target` is a real, independently-owned entity addressed by
 * id — never created or garbage-collected by mention writes (unlike a tag).
 *
 * Its id is **deterministic** — `deterministicUuid(MENTION_NAMESPACE,
 * "{bearerType}:{bearerId}:{targetType}:{targetId}")` — so two devices that
 * re-derive the same mention from the same (deterministic) reminder text produce
 * the same row and whole-row LWW ({@link ./merge.js resolveMerge}) dedups them.
 *
 * Same sync-safe substrate as every domain row (see AGENTS.md): UUID id,
 * epoch-ms UTC timestamps, nullable `deletedAt` — merges via whole-row LWW.
 */
export const mentioningSchema = z.object({
  id: z.uuid(),
  bearerType: mentionBearerTypeSchema, // what holds the text
  bearerId: z.uuid(),
  targetType: entityTypeSchema, // the referenced entity (person | pet)
  targetId: z.uuid(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type Mentioning = z.infer<typeof mentioningSchema>;

/**
 * A mention resolved for display: the referenced entity plus its **current**
 * label (re-resolved by id, so a rename shows through), or `null` when the target
 * has been deleted. Core populates these on reminder reads so a renderer can turn
 * an inline mention token into a live link without a data-layer round-trip.
 */
export interface ResolvedMention {
  targetType: EntityType;
  targetId: string;
  label: string | null;
}
