import type {
  CaptureGiftInput,
  CreateGiftIdeaInput,
  CreateGiftRecipientInput,
  GiftIdea,
  GiftPartyType,
  GiftRecipient,
  GiftRecipientEntry,
  Tag,
  UpdateGiftIdeaInput,
  UpdateGiftRecipientInput,
} from "@leapsake/schema";
import type {
  EntityService,
  GiftIdeasRepo,
  GiftRecipientsRepo,
  SqliteDriver,
  TagsRepo,
} from "@leapsake/data";

/**
 * A gift link joined for the recipient's "Gifts" section: the row plus its idea's
 * title and url. The idea is always live (deleting an idea cascades to its
 * links), so the title is non-null.
 */
export type GiftForRecipient = GiftRecipient & {
  ideaTitle: string;
  ideaUrl: string | null;
};

/**
 * A gift link joined for an idea's "For…" section: the row plus its recipient's
 * display label. A link whose recipient is gone is dropped by the reader, so the
 * label is non-null.
 */
export type GiftForIdea = GiftRecipient & {
  recipientLabel: string;
};

/**
 * One row of the Gifts overview (the `/gifts` screen, keyed by idea): an idea
 * with its tags and everyone it is for, given or not.
 */
export interface GiftIdeaOverview {
  idea: GiftIdea;
  tags: Tag[];
  recipients: GiftForIdea[];
}

export interface GiftsApiDeps {
  giftIdeas: GiftIdeasRepo;
  giftRecipients: GiftRecipientsRepo;
  tags: TagsRepo;
  /** Attaching a gift to someone is a fact about them, so a link publishes an
   *  unpublished party the way a milestone or a contact method does. */
  entities: EntityService;
  /** Every write below is one transaction. */
  driver: SqliteDriver;
}

/**
 * Gift ideas and who each one is for — two tables, and a link that carries
 * whether the thing has actually been given.
 *
 * Small on purpose. The scope was cut to these two tables in 2026-08; what was
 * removed (a dated "giving" row of its own, price and occasion tracking) is in
 * `plans/v0-2.md`, not here.
 */
export function createGiftsApi(deps: GiftsApiDeps) {
  const { giftIdeas, giftRecipients, tags, entities, driver } = deps;

  // An idea's links joined with each recipient's current label (a link whose
  // recipient is gone is dropped). Shared by the idea's "For…" section and the
  // Gifts overview.
  async function giftRecipientsForIdea(ideaId: string): Promise<GiftForIdea[]> {
    const rows = await giftRecipients.listForIdea(ideaId);
    const joined = await Promise.all(
      rows.map(async (row) => {
        const recipientLabel = await entities.label(
          row.recipientType,
          row.recipientId,
        );
        if (recipientLabel === undefined) return null;
        return { ...row, recipientLabel };
      }),
    );
    return joined.filter((row): row is GiftForIdea => row !== null);
  }

  return {
    ideas: {
      list: (): Promise<GiftIdea[]> => giftIdeas.list(),
      get: (id: string): Promise<GiftIdea | undefined> => giftIdeas.get(id),
      // Single-payload create (share-target ready): capture an idea and,
      // optionally, attach it to zero-to-many people or pets in one
      // transaction. `tagNames` rides along the same way a Person's does — the
      // whole desired set, committed with the row.
      create: (
        {
          recipients,
          ...ideaInput
        }: CreateGiftIdeaInput & { recipients?: GiftRecipientEntry[] },
        tagNames?: string[],
      ): Promise<GiftIdea> =>
        driver.transaction(async () => {
          const idea = await giftIdeas.create(ideaInput);
          for (const entry of recipients ?? []) {
            await giftRecipients.create({ giftIdeaId: idea.id, ...entry });
          }
          if (tagNames) {
            await tags.setEntityTags("gift_idea", idea.id, tagNames);
          }
          return idea;
        }),
      // An **omitted** `tagNames` leaves the idea's tags alone; passing the
      // array makes them exactly that set (`[]` clears them), so a caller that
      // only renames an idea can't silently drop its tags.
      update: (
        id: string,
        input: UpdateGiftIdeaInput,
        tagNames?: string[],
      ): Promise<GiftIdea | undefined> =>
        driver.transaction(async () => {
          const idea = await giftIdeas.update(id, input);
          if (idea && tagNames) {
            await tags.setEntityTags("gift_idea", id, tagNames);
          }
          return idea;
        }),

      // Removing an idea cascades to its recipient links and taggings —
      // nothing references a deleted idea, and a live link must always point at
      // a live idea.
      softDelete: (id: string): Promise<void> =>
        driver.transaction(async () => {
          await giftIdeas.softDelete(id);
          await giftRecipients.removeAllForIdea(id);
          await tags.removeAllForEntity("gift_idea", id);
        }),
    },

    // The links themselves — an idea paired with a person or pet, ticked or
    // not. This was two namespaces, `suggestions` and `given`, back when a
    // giving was a separate dated row; "has it been given" is now a column, so
    // it is one namespace with a `setGiven`.
    recipients: {
      // A party's "Gifts" section: each link joined with its idea's title/url.
      // A link whose idea is somehow gone is dropped (defensive — the idea
      // cascade prevents it).
      listForRecipient: async (
        type: GiftPartyType,
        id: string,
      ): Promise<GiftForRecipient[]> => {
        const rows = await giftRecipients.listForRecipient(type, id);
        const joined = await Promise.all(
          rows.map(async (row) => {
            const idea = await giftIdeas.get(row.giftIdeaId);
            if (idea === undefined) return null;
            return { ...row, ideaTitle: idea.title, ideaUrl: idea.url };
          }),
        );
        return joined.filter((row): row is GiftForRecipient => row !== null);
      },
      // An idea's "For…" section: each link joined with its recipient's current
      // label (dropped when the recipient is gone).
      listForIdea: (ideaId: string): Promise<GiftForIdea[]> =>
        giftRecipientsForIdea(ideaId),
      // Attaching a gift to someone is a fact about them, so it publishes an
      // unpublished party the same way a milestone or a contact method does.
      create: (input: CreateGiftRecipientInput): Promise<GiftRecipient> =>
        driver.transaction(async () => {
          await entities.publishBearerIfUnpublished(
            input.party.type,
            input.party.id,
          );
          return giftRecipients.create(input);
        }),
      // Tick or untick the box — the only edit a link has, which is why it is
      // the ordinary `update` rather than a `setGiven`: anything else would
      // fall outside `withSyncKick`'s mutating-method predicate and a ticked
      // box would never kick a sync. The repo makes it a no-op when the row
      // already says so, so this is safe to call from a checkbox that doesn't
      // track its own previous state.
      update: (
        id: string,
        input: UpdateGiftRecipientInput,
      ): Promise<GiftRecipient | undefined> =>
        driver.transaction(() => giftRecipients.update(id, input)),
      softDelete: (id: string): Promise<void> =>
        driver.transaction(() => giftRecipients.softDelete(id)),
    },

    // The one consolidated create: an idea (existing or minted) captured with
    // zero-to-many recipients, all in one transaction. No recipients ⇒ just the
    // idea; each recipient ⇒ one link, ticked or not. Returns the resolved
    // idea.
    capture: (input: CaptureGiftInput): Promise<GiftIdea> =>
      driver.transaction(async () => {
        // Resolve (or mint) the idea once, so N links to a new idea don't mint
        // N ideas.
        let idea: GiftIdea;
        if ("id" in input.giftIdea) {
          const found = await giftIdeas.get(input.giftIdea.id);
          if (found === undefined) throw new Error("gift idea not found");
          idea = found;
        } else {
          idea = await giftIdeas.create({
            title: input.giftIdea.title,
            url: input.giftIdea.url ?? null,
          });
        }

        for (const entry of input.recipients) {
          // Being someone to give something to is a fact about the recipient.
          await entities.publishBearerIfUnpublished(
            entry.party.type,
            entry.party.id,
          );
          // Capture is an *add* surface — it can name an existing idea — so a
          // party already on this idea is updated rather than doubled. Ticking
          // is one-way here: capture says "and I gave them this", never "and I
          // did not", which is the checkbox's job on a row that already exists.
          const existing = (await giftRecipients.listForIdea(idea.id)).find(
            (row) =>
              row.recipientType === entry.party.type &&
              row.recipientId === entry.party.id,
          );
          if (existing !== undefined) {
            if (entry.given === true) {
              await giftRecipients.update(existing.id, { given: true });
            }
            continue;
          }
          await giftRecipients.create({ giftIdeaId: idea.id, ...entry });
        }

        return idea;
      }),

    // The Gifts screen, keyed by idea: every idea with everyone it is for.
    // Ideas keep their newest-first list order.
    overview: async (): Promise<GiftIdeaOverview[]> => {
      const ideas = await giftIdeas.list();
      return Promise.all(
        ideas.map(async (idea) => ({
          idea,
          tags: await tags.listForEntity("gift_idea", idea.id),
          recipients: await giftRecipientsForIdea(idea.id),
        })),
      );
    },
  };
}
