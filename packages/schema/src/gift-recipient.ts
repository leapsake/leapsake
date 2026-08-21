import { z } from "zod";

/**
 * The party a gift idea is for. Its own enum per the house convention that each
 * concern owns its bearer enum (see `tagging.ts`). `relationship` is a plausible
 * third party later ("we gave the Smiths a wedding present") — one line here, no
 * migration, exactly as {@link milestoneBearerTypeSchema} reserved room.
 */
export const giftPartyTypeSchema = z.enum(["person", "pet"]);

export type GiftPartyType = z.infer<typeof giftPartyTypeSchema>;

/** A person or pet a gift idea is attached to. */
export const giftPartySchema = z.object({
  type: giftPartyTypeSchema,
  id: z.uuid(),
});

export type GiftParty = z.infer<typeof giftPartySchema>;

/**
 * How a write surface names the idea it is attaching a party to: an **existing**
 * idea by id, or a **new** one to mint in the same transaction ("I gave Ralphie a
 * BB gun" mints the idea and the link in one transaction if 'BB gun' doesn't
 * exist yet). A share-from-the-web capture may arrive URL-first, so the new-idea
 * arm accepts an optional url too.
 */
export const giftIdeaRefSchema = z.union([
  z.object({ id: z.uuid() }),
  z.object({
    title: z.string().min(1),
    url: z.string().min(1).nullable().optional(),
  }),
]);

export type GiftIdeaRef = z.infer<typeof giftIdeaRefSchema>;

/**
 * A GiftRecipient — one {@link GiftIdea} paired with one person or pet, and
 * whether it has been given to them. "Ralphie would like a Red Ryder BB Gun",
 * and later, "…and now he has one."
 *
 * **This was three tables.** A `gift_suggestions` row was a candidate, a `gifts`
 * row was a *dated* giving, and "✓ given" was a query over
 * `(gift_idea_id, recipient)` rather than a column — because the cardinalities
 * genuinely differed: the scotch you give your dad every Christmas was one
 * suggestion and N givings, each with its own date and occasion.
 *
 * That split was load-bearing only while a giving carried a date. With dates and
 * occasions out of scope for v0.1, "given twice" is unrepresentable and means
 * nothing, and the query over the second table returns a boolean — so the two
 * rows are one row with a flag, and whole-row LWW is the correct merge for a
 * flag. The richer model is in `git log` at `41ee888` if it is ever wanted back.
 *
 * Nothing here is unique-indexed on `(gift_idea_id, recipient_*)`: two devices
 * can each mint a row for the same pair, and the rest of the sync model dedupes
 * on read rather than at the constraint.
 *
 * Sync-safe conventions (see AGENTS.md): client UUID id, epoch-ms UTC timestamps,
 * nullable `deletedAt`. Plaintext, like the gift idea it points at.
 */
export const giftRecipientSchema = z.object({
  id: z.uuid(),
  giftIdeaId: z.uuid(),
  recipientType: giftPartyTypeSchema,
  recipientId: z.uuid(),
  /**
   * When the box was ticked — **not** when the gift changed hands.
   *
   * An audit stamp in the same family as {@link createdAt}: written by the app,
   * never typed by anyone, never rendered. Every read treats it as a boolean
   * (`givenAt !== null`); nothing formats it, and no date field hangs off it. It
   * is a timestamp rather than a `0`/`1` only because a timestamp answers "which
   * of these did I tick most recently" for free, and costs nothing to ignore.
   *
   * If a future slice wants the date a gift was *actually* given, that is a
   * different column with a different type (a partial date, as milestones have) —
   * do not repurpose this one.
   */
  givenAt: z.number().int().nullable(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type GiftRecipient = z.infer<typeof giftRecipientSchema>;

/**
 * One party in a write, with the only thing there is to say about them. Shared by
 * the capture payload and the standalone create, which is why it names the party
 * rather than repeating the idea: the enclosing write already knows the idea.
 *
 * `given` is the caller's **intent**, a boolean — the repo is what turns it into
 * a {@link giftRecipientSchema.givenAt} stamp. Callers never pick the timestamp.
 */
export const giftRecipientEntrySchema = z.object({
  party: giftPartySchema,
  given: z.boolean().optional(), // absent ⇒ not given
});

export type GiftRecipientEntry = z.infer<typeof giftRecipientEntrySchema>;

/** The fields accepted when attaching a party to an idea that already exists. */
export const createGiftRecipientInputSchema = giftRecipientEntrySchema.extend({
  giftIdeaId: z.uuid(),
});

export type CreateGiftRecipientInput = z.infer<
  typeof createGiftRecipientInputSchema
>;

/**
 * The one editable bit of a link: whether it has been given. The idea and the
 * recipient are the row's identity — pointing it at someone else is a different
 * row, not an edit.
 */
export const updateGiftRecipientInputSchema = z.object({
  given: z.boolean(),
});

export type UpdateGiftRecipientInput = z.infer<
  typeof updateGiftRecipientInputSchema
>;

/**
 * The **one consolidated create** surface: an idea (existing or new) captured
 * with zero-to-many recipients, in one transaction. It expresses the whole "type
 * a gift → say who it's for → tick the ones you've given" flow as data:
 *
 * - **no recipients** → just the {@link GiftIdea} (typing a name on the Gifts
 *   screen).
 * - **a recipient** → one {@link GiftRecipient}, given or not.
 *
 * There is no second arm and no giver. The form that drives this used to open by
 * asking which of two tables you were writing to ("Idea" / "Already gave it");
 * with one table there is nothing to ask, and the answer is a checkbox on each
 * recipient's row.
 */
export const captureGiftInputSchema = z.object({
  giftIdea: giftIdeaRefSchema,
  recipients: z.array(giftRecipientEntrySchema),
});

export type CaptureGiftInput = z.infer<typeof captureGiftInputSchema>;
