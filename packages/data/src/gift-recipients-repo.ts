import {
  type CreateGiftRecipientInput,
  type GiftPartyType,
  type GiftRecipient,
  type UpdateGiftRecipientInput,
  createGiftRecipientInputSchema,
  giftRecipientSchema,
  updateGiftRecipientInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import {
  type EntityRepo,
  createEntityRepo,
  softDeleteWhere,
} from "./entity-repo.js";

// `create`/`update` take nested party and boolean input, so the base `update`
// is omitted and re-declared.
export interface GiftRecipientsRepo extends Omit<
  EntityRepo<GiftRecipient>,
  "update"
> {
  create(input: CreateGiftRecipientInput): Promise<GiftRecipient>;
  /** Tick or untick the box; a no-op when the row already says so. */
  update(
    id: string,
    input: UpdateGiftRecipientInput,
  ): Promise<GiftRecipient | undefined>;
  /** Active links for one party — the Person/Pet "Gifts" section. */
  listForRecipient(type: GiftPartyType, id: string): Promise<GiftRecipient[]>;
  /** Active links of one idea — the idea's "For…" section, and the overview. */
  listForIdea(ideaId: string): Promise<GiftRecipient[]>;
  /** Soft-delete every link to a party (the party was deleted). */
  removeAllForRecipient(type: GiftPartyType, id: string): Promise<void>;
  /** Soft-delete every link of an idea (the idea was deleted). */
  removeAllForIdea(ideaId: string): Promise<void>;
  /** Carry a party's links onto another party, for a people merge. */
  repointRecipient(
    type: GiftPartyType,
    fromId: string,
    toId: string,
  ): Promise<void>;
}

/** Not-yet-given first, then newest. Passed to every scoped read, since
 *  `listWhere` ignores `orderBy`. */
const RECIPIENT_ORDER = "given_at IS NOT NULL, created_at DESC";

/** Gift ideas paired with a person or pet. Turns the caller's boolean into the
 *  {@link GiftRecipient.givenAt} stamp. */
export function createGiftRecipientsRepo(
  driver: SqliteDriver,
): GiftRecipientsRepo {
  const base = createEntityRepo<GiftRecipient>({
    driver,
    table: "gift_recipients",
    schema: giftRecipientSchema,
    orderBy: RECIPIENT_ORDER,
  });

  return {
    ...base,

    async create(input) {
      const parsed = createGiftRecipientInputSchema.parse(input);
      const now = Date.now();
      return base.insert({
        id: crypto.randomUUID(),
        giftIdeaId: parsed.giftIdeaId,
        recipientType: parsed.party.type,
        recipientId: parsed.party.id,
        // The caller says whether it has been given; the timestamp is ours.
        givenAt: parsed.given === true ? now : null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    async update(id, input) {
      const { given } = updateGiftRecipientInputSchema.parse(input);
      const row = await base.get(id);
      if (row === undefined) return undefined;
      // Write only on a real change: re-ticking would move the stamp and sync
      // nothing new.
      if (given === (row.givenAt !== null)) return row;
      return base.update(id, { givenAt: given ? Date.now() : null });
    },

    listForRecipient: (type, id) =>
      base.listWhere({
        where: "recipient_type = ? AND recipient_id = ?",
        params: [type, id],
        orderBy: RECIPIENT_ORDER,
      }),

    listForIdea: (ideaId) =>
      base.listWhere({
        where: "gift_idea_id = ?",
        params: [ideaId],
        orderBy: RECIPIENT_ORDER,
      }),

    removeAllForRecipient: (type, id) =>
      softDeleteWhere(
        driver,
        "gift_recipients",
        "recipient_type = ? AND recipient_id = ?",
        [type, id],
      ),

    removeAllForIdea: (ideaId) =>
      softDeleteWhere(driver, "gift_recipients", "gift_idea_id = ?", [ideaId]),

    async repointRecipient(type, fromId, toId) {
      const now = Date.now();
      // `MAX(?, updated_at + 1)`: see the README's re-point rule.
      await driver.run(
        `UPDATE gift_recipients SET recipient_id = ?, updated_at = MAX(?, updated_at + 1)
           WHERE recipient_type = ? AND recipient_id = ? AND deleted_at IS NULL`,
        [toId, now, type, fromId],
      );
      // A merge can leave one idea twice on the survivor: keep the earliest
      // row, and a ✓ from either, since that stamp is the fact worth keeping.
      await driver.run(
        `UPDATE gift_recipients
            SET given_at   = COALESCE(given_at, (
                  SELECT MIN(dupe.given_at) FROM gift_recipients dupe
                   WHERE dupe.gift_idea_id   = gift_recipients.gift_idea_id
                     AND dupe.recipient_type = gift_recipients.recipient_type
                     AND dupe.recipient_id   = gift_recipients.recipient_id
                     AND dupe.deleted_at IS NULL)),
                updated_at = MAX(?, updated_at + 1)
          WHERE recipient_type = ? AND recipient_id = ? AND deleted_at IS NULL
            AND rowid = (
                  SELECT MIN(keep.rowid) FROM gift_recipients keep
                   WHERE keep.gift_idea_id   = gift_recipients.gift_idea_id
                     AND keep.recipient_type = gift_recipients.recipient_type
                     AND keep.recipient_id   = gift_recipients.recipient_id
                     AND keep.deleted_at IS NULL)`,
        [now, type, toId],
      );
      await softDeleteWhere(
        driver,
        "gift_recipients",
        `recipient_type = ? AND recipient_id = ? AND rowid > (
           SELECT MIN(keep.rowid) FROM gift_recipients keep
            WHERE keep.gift_idea_id   = gift_recipients.gift_idea_id
              AND keep.recipient_type = gift_recipients.recipient_type
              AND keep.recipient_id   = gift_recipients.recipient_id
              AND keep.deleted_at IS NULL)`,
        [type, toId],
      );
    },
  };
}
