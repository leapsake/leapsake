import {
  type CreateGiftSuggestionInput,
  type GiftPartyType,
  type GiftSuggestion,
  type UpdateGiftSuggestionInput,
  createGiftSuggestionInputSchema,
  giftSuggestionSchema,
  updateGiftSuggestionInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import {
  type EntityRepo,
  createEntityRepo,
  softDeleteWhere,
} from "./entity-repo.js";

// `update` takes the *nested* occasion/target-date input (flattened onto the row
// here), which isn't a `Partial<GiftSuggestion>` — so the base `update` is
// omitted and re-declared rather than narrowed.
export interface GiftSuggestionsRepo extends Omit<
  EntityRepo<GiftSuggestion>,
  "update"
> {
  create(input: CreateGiftSuggestionInput): Promise<GiftSuggestion>;
  update(
    id: string,
    input: UpdateGiftSuggestionInput,
  ): Promise<GiftSuggestion | undefined>;
  /** Active suggestions for one recipient — the Person/Pet "Gift ideas" section. */
  listForRecipient(type: GiftPartyType, id: string): Promise<GiftSuggestion[]>;
  /** Active suggestions of one idea — the idea's "Suggested for" section. */
  listForIdea(ideaId: string): Promise<GiftSuggestion[]>;
  /** Soft-delete every suggestion for a recipient (the recipient was deleted). */
  removeAllForRecipient(type: GiftPartyType, id: string): Promise<void>;
  /** Soft-delete every suggestion of an idea (the idea was deleted). */
  removeAllForIdea(ideaId: string): Promise<void>;
  /** Carry a recipient's suggestions onto another recipient, for a people merge. */
  repointRecipient(
    type: GiftPartyType,
    fromId: string,
    toId: string,
  ): Promise<void>;
}

/** Flatten the nested occasion/target-date input onto the row's flat columns. */
function flattenAdornments(input: {
  occasion?: { type: "milestone" | "holiday"; id: string } | null;
  targetDate?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null;
}): Partial<GiftSuggestion> {
  const patch: Partial<GiftSuggestion> = {};
  if (input.occasion !== undefined) {
    patch.occasionType = input.occasion?.type ?? null;
    patch.occasionId = input.occasion?.id ?? null;
  }
  if (input.targetDate !== undefined) {
    patch.targetYear = input.targetDate?.year ?? null;
    patch.targetMonth = input.targetDate?.month ?? null;
    patch.targetDay = input.targetDate?.day ?? null;
  }
  return patch;
}

/**
 * The gift-suggestions repository over the async {@link SqliteDriver} port.
 * Plaintext, like the other gift rows. Standard CRUD + the sync surface come from
 * {@link createEntityRepo}; `create`/`update` flatten the nested occasion/target
 * date onto the row columns, and the by-recipient / by-idea reads + cascade
 * helpers (delete, merge re-point) mirror the milestones repo. Ordered by target
 * date so a dated intent sorts ahead of an undated "someday".
 */
// A dated intent sorts ahead of an undated "someday". Passed to every scoped read
// (`listWhere` ignores the repo's default `orderBy`).
const SUGGESTION_ORDER =
  "target_year, target_month, target_day, created_at DESC";

export function createGiftSuggestionsRepo(
  driver: SqliteDriver,
): GiftSuggestionsRepo {
  const base = createEntityRepo<GiftSuggestion>({
    driver,
    table: "gift_suggestions",
    schema: giftSuggestionSchema,
    orderBy: SUGGESTION_ORDER,
  });

  return {
    ...base,

    async create(input) {
      const parsed = createGiftSuggestionInputSchema.parse(input);
      const now = Date.now();
      const adornments = flattenAdornments(parsed);
      return base.insert({
        id: crypto.randomUUID(),
        giftIdeaId: parsed.giftIdeaId,
        recipientType: parsed.recipientType,
        recipientId: parsed.recipientId,
        occasionType: adornments.occasionType ?? null,
        occasionId: adornments.occasionId ?? null,
        targetYear: adornments.targetYear ?? null,
        targetMonth: adornments.targetMonth ?? null,
        targetDay: adornments.targetDay ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: async (id, input) =>
      base.update(
        id,
        flattenAdornments(updateGiftSuggestionInputSchema.parse(input)),
      ),

    listForRecipient: (type, id) =>
      base.listWhere({
        where: "recipient_type = ? AND recipient_id = ?",
        params: [type, id],
        orderBy: SUGGESTION_ORDER,
      }),

    listForIdea: (ideaId) =>
      base.listWhere({
        where: "gift_idea_id = ?",
        params: [ideaId],
        orderBy: SUGGESTION_ORDER,
      }),

    removeAllForRecipient: (type, id) =>
      softDeleteWhere(
        driver,
        "gift_suggestions",
        "recipient_type = ? AND recipient_id = ?",
        [type, id],
      ),

    removeAllForIdea: (ideaId) =>
      softDeleteWhere(driver, "gift_suggestions", "gift_idea_id = ?", [ideaId]),

    async repointRecipient(type, fromId, toId) {
      const now = Date.now();
      // `MAX(?, updated_at + 1)` keeps the re-point strictly newer so it wins LWW
      // even when a merge lands in the row's creation millisecond (see
      // milestones-repo `repointEntity`).
      await driver.run(
        `UPDATE gift_suggestions SET recipient_id = ?, updated_at = MAX(?, updated_at + 1)
           WHERE recipient_type = ? AND recipient_id = ? AND deleted_at IS NULL`,
        [toId, now, type, fromId],
      );
    },
  };
}
