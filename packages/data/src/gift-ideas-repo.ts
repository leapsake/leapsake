import {
  type CreateGiftIdeaInput,
  type GiftIdea,
  type UpdateGiftIdeaInput,
  createGiftIdeaInputSchema,
  giftIdeaSchema,
  updateGiftIdeaInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { type EntityRepo, createEntityRepo } from "./entity-repo.js";

export interface GiftIdeasRepo extends EntityRepo<GiftIdea> {
  create(input: CreateGiftIdeaInput): Promise<GiftIdea>;
  update(id: string, input: UpdateGiftIdeaInput): Promise<GiftIdea | undefined>;
}

/** The gift-ideas repository: plaintext, newest first. */
export function createGiftIdeasRepo(driver: SqliteDriver): GiftIdeasRepo {
  const base = createEntityRepo<GiftIdea>({
    driver,
    table: "gift_ideas",
    schema: giftIdeaSchema,
    orderBy: "created_at DESC",
  });

  return {
    ...base,

    async create(input) {
      const {
        title,
        url = null,
        imageUrl = null,
        notes = null,
      } = createGiftIdeaInputSchema.parse(input);
      const now = Date.now();
      return base.insert({
        id: crypto.randomUUID(),
        title,
        url,
        imageUrl,
        notes,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    // A new link drops the old link's picture unless one comes with it.
    async update(id, input) {
      const parsed = updateGiftIdeaInputSchema.parse(input);
      if (parsed.url !== undefined && parsed.imageUrl === undefined) {
        const current = await base.get(id);
        if (current !== undefined && current.url !== parsed.url) {
          parsed.imageUrl = null;
        }
      }
      return base.update(id, parsed);
    },
  };
}
