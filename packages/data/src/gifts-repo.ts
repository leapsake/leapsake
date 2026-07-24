import {
  type CreateGiftRowInput,
  type Gift,
  type GiftParty,
  type GiftPartyType,
  type UpdateGiftInput,
  createGiftRowInputSchema,
  giftSchema,
  updateGiftInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import {
  type EntityRepo,
  createEntityRepo,
  softDeleteWhere,
} from "./entity-repo.js";

// `create`/`update` take the *nested* party/date/occasion input (flattened onto
// the row here), which isn't a `Partial<Gift>` — so the base `create`/`update`
// are omitted and re-declared.
export interface GiftsRepo extends Omit<EntityRepo<Gift>, "update"> {
  create(input: CreateGiftRowInput): Promise<Gift>;
  update(id: string, input: UpdateGiftInput): Promise<Gift | undefined>;
  /** Gifts given TO one recipient — the Person/Pet "Gifts given" section. */
  listForRecipient(type: GiftPartyType, id: string): Promise<Gift[]>;
  /** Gifts given BY one giver. */
  listForGiver(type: GiftPartyType, id: string): Promise<Gift[]>;
  /** Soft-delete every gift where the entity is the giver OR the recipient. */
  removeAllForParty(type: GiftPartyType, id: string): Promise<void>;
  /** Soft-delete every gift of an idea (the idea was deleted). */
  removeAllForIdea(ideaId: string): Promise<void>;
  /**
   * Carry a party's gifts (as giver and/or recipient) onto another party, for a
   * people merge — then drop any gift the re-point made self-referential
   * (giver == recipient), which the schema forbids.
   */
  repointParty(
    type: GiftPartyType,
    fromId: string,
    toId: string,
  ): Promise<void>;
}

/** Flatten the nested party/date/occasion input onto the row's flat columns. */
function flattenGift(input: {
  giver?: GiftParty | null;
  date?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null;
  occasion?: { type: "milestone" | "holiday"; id: string } | null;
}): Partial<Gift> {
  const patch: Partial<Gift> = {};
  if (input.giver !== undefined) {
    patch.giverType = input.giver?.type ?? null;
    patch.giverId = input.giver?.id ?? null;
  }
  if (input.date !== undefined) {
    patch.year = input.date?.year ?? null;
    patch.month = input.date?.month ?? null;
    patch.day = input.date?.day ?? null;
  }
  if (input.occasion !== undefined) {
    patch.occasionType = input.occasion?.type ?? null;
    patch.occasionId = input.occasion?.id ?? null;
  }
  return patch;
}

/**
 * The gifts repository over the async {@link SqliteDriver} port. Plaintext, like
 * the other gift rows. Standard CRUD + the sync surface come from
 * {@link createEntityRepo}; `create`/`update` flatten the nested party/date/
 * occasion onto columns (the row schema re-validates the giver≠recipient and
 * both-or-neither rules). Ordered newest-happened-first — a dated giving sorts
 * ahead of an undated one (SQLite sorts NULLs last under DESC).
 */
// Newest-happened-first: a dated giving sorts ahead of an undated one (SQLite
// sorts NULLs last under DESC), so the first gift per idea is the most recent —
// which is what the "✓ given" annotation reads. Passed to every scoped read
// (`listWhere` ignores the repo's default `orderBy`).
const GIFT_ORDER = "year DESC, month DESC, day DESC, created_at DESC";

export function createGiftsRepo(driver: SqliteDriver): GiftsRepo {
  const base = createEntityRepo<Gift>({
    driver,
    table: "gifts",
    schema: giftSchema,
    orderBy: GIFT_ORDER,
  });

  return {
    ...base,

    async create(input) {
      const parsed = createGiftRowInputSchema.parse(input);
      const now = Date.now();
      const flat = flattenGift(parsed);
      return base.insert({
        id: crypto.randomUUID(),
        giftIdeaId: parsed.giftIdeaId,
        giverType: flat.giverType ?? null,
        giverId: flat.giverId ?? null,
        recipientType: parsed.recipient.type,
        recipientId: parsed.recipient.id,
        year: flat.year ?? null,
        month: flat.month ?? null,
        day: flat.day ?? null,
        occasionType: flat.occasionType ?? null,
        occasionId: flat.occasionId ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: async (id, input) =>
      base.update(id, flattenGift(updateGiftInputSchema.parse(input))),

    listForRecipient: (type, id) =>
      base.listWhere({
        where: "recipient_type = ? AND recipient_id = ?",
        params: [type, id],
        orderBy: GIFT_ORDER,
      }),

    listForGiver: (type, id) =>
      base.listWhere({
        where: "giver_type = ? AND giver_id = ?",
        params: [type, id],
        orderBy: GIFT_ORDER,
      }),

    removeAllForParty: (type, id) =>
      softDeleteWhere(
        driver,
        "gifts",
        "(giver_type = ? AND giver_id = ?) OR (recipient_type = ? AND recipient_id = ?)",
        [type, id, type, id],
      ),

    removeAllForIdea: (ideaId) =>
      softDeleteWhere(driver, "gifts", "gift_idea_id = ?", [ideaId]),

    async repointParty(type, fromId, toId) {
      const now = Date.now();
      // `MAX(?, updated_at + 1)` keeps each re-point strictly newer so it wins
      // LWW even when a merge lands in the row's creation millisecond (see
      // milestones-repo `repointEntity`).
      await driver.run(
        `UPDATE gifts SET giver_id = ?, updated_at = MAX(?, updated_at + 1)
           WHERE giver_type = ? AND giver_id = ? AND deleted_at IS NULL`,
        [toId, now, type, fromId],
      );
      await driver.run(
        `UPDATE gifts SET recipient_id = ?, updated_at = MAX(?, updated_at + 1)
           WHERE recipient_type = ? AND recipient_id = ? AND deleted_at IS NULL`,
        [toId, now, type, fromId],
      );
      // A merge can leave a gift whose giver now equals its recipient (you gave a
      // gift from A to B, then merged A into B) — which the schema forbids. Drop
      // those, so no invalid row survives to fail a later read-time parse.
      await softDeleteWhere(
        driver,
        "gifts",
        "giver_type = recipient_type AND giver_id = recipient_id",
        [],
      );
    },
  };
}
