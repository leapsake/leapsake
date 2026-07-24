import { z } from "zod";

/**
 * A GiftIdea — "a thing in the world" (a Red Ryder BB Gun), reusable and
 * **person-agnostic**: it says nothing about who might want it. That's the
 * deliberate split at the heart of gifts (plans/gifts.md): an idea is about the
 * *thing* (it can have a URL; a person can't), a {@link GiftSuggestion} pairs an
 * idea with a recipient, and a {@link Gift} is a dated giving. An idea can be
 * suggested for zero-to-many people and given zero-to-many times.
 *
 * {@link title} is the only required field; {@link url} (where to buy / read
 * more) and {@link notes} are optional free text. Near-duplicates ("BB gun" vs
 * "Red Ryder BB Gun") are **tolerated, not auto-merged** — titles are prose, and
 * the eventual answer is the existing reconciliation substrate, not silent
 * normalization here (plans/gifts.md).
 *
 * Sync-safe conventions (see AGENTS.md): client-generated UUID primary key,
 * epoch-ms UTC timestamps, nullable `deletedAt` for soft deletes. Deliberately
 * plaintext (no per-item content key), like reminders — a gift idea isn't a share
 * target, and whole-DB-at-rest + master-key-sealed sync already protect it
 * (plans/gifts.md §The three gift tables).
 */
export const giftIdeaSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  url: z.string().min(1).nullable(), // optional; null when absent
  notes: z.string().min(1).nullable(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type GiftIdea = z.infer<typeof giftIdeaSchema>;

/** The optional fields shared by create/update inputs. */
const optionalFields = {
  url: z.string().min(1).nullable().optional(),
  notes: z.string().min(1).nullable().optional(),
};

/**
 * The fields accepted when creating a gift idea. Only {@link title} is required;
 * the repository fills id/timestamps. (The single-payload create surface grows a
 * `suggestFor` arm in slice 2 — see plans/gifts.md — but that lives on the core
 * method, not this row-input schema.)
 */
export const createGiftIdeaInputSchema = z.object({
  title: z.string().min(1),
  ...optionalFields,
});

export type CreateGiftIdeaInput = z.infer<typeof createGiftIdeaInputSchema>;

/** Input accepted when updating a gift idea; any subset of the editable fields. */
export const updateGiftIdeaInputSchema = z.object({
  title: z.string().min(1).optional(),
  ...optionalFields,
});

export type UpdateGiftIdeaInput = z.infer<typeof updateGiftIdeaInputSchema>;
