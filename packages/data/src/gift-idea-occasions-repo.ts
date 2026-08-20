import {
  type GiftIdeaOccasion,
  type GiftIdeaOccasionInput,
  giftIdeaOccasionInputSchema,
  giftIdeaOccasionSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import {
  type EntityRepo,
  createEntityRepo,
  softDeleteWhere,
} from "./entity-repo.js";

// `create`/`update` take the *nested* occasion/target-date input (flattened onto
// the row here), which isn't a `Partial<GiftIdeaOccasion>` — so the base `update`
// is omitted and re-declared rather than narrowed, as in the suggestions repo.
export interface GiftIdeaOccasionsRepo extends Omit<
  EntityRepo<GiftIdeaOccasion>,
  "update"
> {
  create(
    giftIdeaId: string,
    input: GiftIdeaOccasionInput,
  ): Promise<GiftIdeaOccasion>;
  update(
    id: string,
    input: GiftIdeaOccasionInput,
  ): Promise<GiftIdeaOccasion | undefined>;
  /** One idea's occasions — what the idea's own form and the catalog row read. */
  listForIdea(giftIdeaId: string): Promise<GiftIdeaOccasion[]>;
  /** Soft-delete every occasion of an idea (the idea was deleted). */
  removeAllForIdea(giftIdeaId: string): Promise<void>;
}

/** Oldest first, so the list reads in the order the user built it. */
const OCCASION_ORDER = "created_at";

/**
 * The gift-idea-occasions repository over the async {@link SqliteDriver} port —
 * "this idea is a Christmas thing", the one gift adornment that needs no
 * recipient. Plaintext, like the other gift rows. Standard CRUD + the sync
 * surface come from {@link createEntityRepo}; `create`/`update` flatten the
 * nested occasion/target date onto the row columns exactly as
 * `gift-suggestions-repo` does.
 *
 * No uniqueness on `(gift_idea_id, occasion_*)`: core's set-replace keeps the
 * list clean, and a constraint here would turn two devices adding the same
 * occasion — the ordinary sync case — into a failed insert instead of a merge.
 */
export function createGiftIdeaOccasionsRepo(
  driver: SqliteDriver,
): GiftIdeaOccasionsRepo {
  const base = createEntityRepo<GiftIdeaOccasion>({
    driver,
    table: "gift_idea_occasions",
    schema: giftIdeaOccasionSchema,
    orderBy: OCCASION_ORDER,
  });

  /** The nested input as the row's flat columns. */
  function flatten(input: GiftIdeaOccasionInput) {
    const parsed = giftIdeaOccasionInputSchema.parse(input);
    return {
      occasionType: parsed.occasion.type,
      occasionId: parsed.occasion.id,
      targetYear: parsed.targetDate?.year ?? null,
      targetMonth: parsed.targetDate?.month ?? null,
      targetDay: parsed.targetDate?.day ?? null,
    };
  }

  return {
    ...base,

    async create(giftIdeaId, input) {
      const now = Date.now();
      return base.insert({
        id: crypto.randomUUID(),
        giftIdeaId,
        ...flatten(input),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: (id, input) => base.update(id, flatten(input)),

    listForIdea: (giftIdeaId) =>
      base.listWhere({
        where: "gift_idea_id = ?",
        params: [giftIdeaId],
        orderBy: OCCASION_ORDER,
      }),

    removeAllForIdea: (giftIdeaId) =>
      softDeleteWhere(driver, "gift_idea_occasions", "gift_idea_id = ?", [
        giftIdeaId,
      ]),
  };
}
