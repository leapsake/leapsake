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

// `create`/`update` take the *nested* party / boolean input (flattened onto the
// row here), which isn't a `Partial<GiftRecipient>` — so the base `update` is
// omitted and re-declared rather than narrowed.
export interface GiftRecipientsRepo extends Omit<
  EntityRepo<GiftRecipient>,
  "update"
> {
  create(input: CreateGiftRecipientInput): Promise<GiftRecipient>;
  /** Tick or untick the box. A no-op when the row already says so — see below. */
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

/**
 * Not-yet-given first, then newest — the shopping list stays on top, which is the
 * posture every gift list takes. `given_at IS NOT NULL` evaluates to 0/1, so a
 * plain ASC on it sorts the outstanding ones ahead of the done ones without a
 * CASE. Passed to every scoped read (`listWhere` ignores the repo's default
 * `orderBy`).
 */
const RECIPIENT_ORDER = "given_at IS NOT NULL, created_at DESC";

/**
 * The gift-recipients repository over the async {@link SqliteDriver} port —
 * one {@link GiftIdea} paired with one person or pet, and whether it has been
 * given to them.
 *
 * **This was two repos.** `gift_suggestions` (a candidate) and `gifts` (a dated
 * giving) collapsed into one table when dates left v0.1 scope, because without a
 * date the second table only ever answered a yes/no about the first. See
 * `gift-recipient.ts` for the full reasoning, and `git log` at `41ee888` for the
 * model that had both.
 *
 * Plaintext, like the gift ideas it points at. Standard CRUD + the sync surface
 * come from {@link createEntityRepo}; `create`/`update` translate the caller's
 * boolean into the {@link GiftRecipient.givenAt} stamp, which is this repo's job
 * and nobody else's.
 */
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
      // Only write when the answer actually changes. Ticking an already-ticked
      // box is not an edit, and re-stamping it would move `givenAt` for no
      // reason, bump `updated_at`, and push a sync row that says nothing.
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
      // `MAX(?, updated_at + 1)` keeps the re-point strictly newer so it wins LWW
      // even when a merge lands in the row's creation millisecond (see
      // milestones-repo `repointEntity`).
      await driver.run(
        `UPDATE gift_recipients SET recipient_id = ?, updated_at = MAX(?, updated_at + 1)
           WHERE recipient_type = ? AND recipient_id = ? AND deleted_at IS NULL`,
        [toId, now, type, fromId],
      );
      // A merge can leave the survivor holding the *same* idea twice — both
      // people were down for socks — which reads as a duplicated row in their
      // gift list. Collapse each idea to one row, keeping the earliest, and let a
      // ✓ on either survive: whether they have been given the thing is the fact
      // worth preserving, and the losing row's stamp is the only place it lives.
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
