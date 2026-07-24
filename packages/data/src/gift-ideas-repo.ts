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

/**
 * The gift-ideas repository over the async {@link SqliteDriver} port. Plaintext —
 * no {@link ContentCipher}, like reminders; a gift idea isn't a share target and
 * is already covered by whole-DB-at-rest + master-key-sealed sync. Standard CRUD +
 * the sync surface come from {@link createEntityRepo}; only `create` (parse +
 * assemble) and `update` (parse the patch) are bespoke. Listed newest-first — a
 * capture list surfaces what you just added; the "not-yet-given" ordering the
 * design mentions is a later, UI-side concern once givings exist (slice 3).
 */
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
        notes = null,
      } = createGiftIdeaInputSchema.parse(input);
      const now = Date.now();
      return base.insert({
        id: crypto.randomUUID(),
        title,
        url,
        notes,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: async (id, input) =>
      base.update(id, updateGiftIdeaInputSchema.parse(input)),
  };
}
