import { z } from "zod";
import { parseTagNames } from "./tag.js";

/**
 * A thing that could be given, saying nothing about who wants it; a
 * {@link GiftRecipient} pairs it with someone. Similar titles are not merged.
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

/** The fields accepted when creating a gift idea; only a title is needed. */
export const createGiftIdeaInputSchema = z.object({
  title: z.string().min(1),
  ...optionalFields,
});

export type CreateGiftIdeaInput = z.infer<typeof createGiftIdeaInputSchema>;

/** Input accepted when updating a gift idea; any subset of its fields. */
export const updateGiftIdeaInputSchema = z.object({
  title: z.string().min(1).optional(),
  ...optionalFields,
});

export type UpdateGiftIdeaInput = z.infer<typeof updateGiftIdeaInputSchema>;

/** A gift idea as a form holds it: every field the text the user typed. */
export interface GiftIdeaDraft {
  title: string;
  url: string;
  notes: string;
  /** Raw tag text, parsed by {@link parseTagNames}. */
  tags: string;
}

/** Why a draft field cannot be saved; the catalog owns the sentence. */
export type GiftIdeaDraftError = "required";

export type GiftIdeaDraftResult =
  | {
      ok: true;
      input: { title: string; url: string | null; notes: string | null };
      tags: string[];
    }
  | {
      ok: false;
      errors: Partial<Record<keyof GiftIdeaDraft, GiftIdeaDraftError>>;
    };

/** The draft a form starts from: the idea being edited, or blanks. */
export function giftIdeaDraftOf(
  idea?: Pick<GiftIdea, "title" | "url" | "notes">,
  tags = "",
): GiftIdeaDraft {
  return {
    title: idea?.title ?? "",
    url: idea?.url ?? "",
    notes: idea?.notes ?? "",
    tags,
  };
}

const blankToNull = (text: string) => (text.trim() === "" ? null : text.trim());

/** Trims the draft and turns blanks into null; only a title is required. */
export function giftIdeaInputOf(draft: GiftIdeaDraft): GiftIdeaDraftResult {
  const input = {
    title: draft.title.trim(),
    url: blankToNull(draft.url),
    notes: blankToNull(draft.notes),
  };
  if (!createGiftIdeaInputSchema.safeParse(input).success) {
    return { ok: false, errors: { title: "required" } };
  }
  return { ok: true, input, tags: parseTagNames(draft.tags) };
}
