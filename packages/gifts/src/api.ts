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

/** A gift link with its idea's title and url, for a recipient's Gifts. */
export type GiftForRecipient = GiftRecipient & {
  ideaTitle: string;
  ideaUrl: string | null;
};

/** A gift link with its recipient's label, for an idea's “For…” section. */
export type GiftForIdea = GiftRecipient & {
  recipientLabel: string;
};

/** One idea on the Gifts screen, with its tags and everyone it is for. */
export interface GiftIdeaOverview {
  idea: GiftIdea;
  tags: Tag[];
  recipients: GiftForIdea[];
}

export interface GiftsApiDeps {
  giftIdeas: GiftIdeasRepo;
  giftRecipients: GiftRecipientsRepo;
  tags: TagsRepo;
  /** Publishes an unpublished party a gift is attached to. */
  entities: EntityService;
  /** Every write below is one transaction. */
  driver: SqliteDriver;
}

/** Gift ideas and who each one is for, a link carrying whether it was given. */
export function createGiftsApi(deps: GiftsApiDeps) {
  const { giftIdeas, giftRecipients, tags, entities, driver } = deps;

  // An idea's links with each live recipient's current label.
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
      // An idea, its whole tag set and any recipients, in one transaction.
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
      // An omitted `tagNames` leaves tags alone; `[]` clears them.
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

      // Cascades to its links and taggings: a live link needs a live idea.
      softDelete: (id: string): Promise<void> =>
        driver.transaction(async () => {
          await giftIdeas.softDelete(id);
          await giftRecipients.removeAllForIdea(id);
          await tags.removeAllForEntity("gift_idea", id);
        }),
    },

    // The links: an idea paired with a person or pet, ticked or not.
    recipients: {
      // Each link with its idea's title and url; a dangling link is dropped.
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
      // Each link with its recipient's current label.
      listForIdea: (ideaId: string): Promise<GiftForIdea[]> =>
        giftRecipientsForIdea(ideaId),
      // Publishes an unpublished party, as a milestone does.
      create: (input: CreateGiftRecipientInput): Promise<GiftRecipient> =>
        driver.transaction(async () => {
          await entities.publishBearerIfUnpublished(
            input.party.type,
            input.party.id,
          );
          return giftRecipients.create(input);
        }),
      // Ticks or unticks, a no-op when unchanged; named `update` so a tick
      // kicks a sync.
      update: (
        id: string,
        input: UpdateGiftRecipientInput,
      ): Promise<GiftRecipient | undefined> =>
        driver.transaction(() => giftRecipients.update(id, input)),
      softDelete: (id: string): Promise<void> =>
        driver.transaction(() => giftRecipients.softDelete(id)),
    },

    // An idea, existing or minted, with any recipients, in one transaction.
    capture: (input: CaptureGiftInput): Promise<GiftIdea> =>
      driver.transaction(async () => {
        // Resolved once, so N links to a new idea mint one idea.
        let idea: GiftIdea;
        if ("id" in input.giftIdea) {
          const found = await giftIdeas.get(input.giftIdea.id);
          if (found === undefined) throw new Error("gift idea not found");
          idea = found;
        } else {
          idea = await giftIdeas.create({
            title: input.giftIdea.title,
            url: input.giftIdea.url ?? null,
            imageUrl: input.giftIdea.imageUrl ?? null,
          });
        }

        for (const entry of input.recipients) {
          // Being someone to give something to is a fact about the recipient.
          await entities.publishBearerIfUnpublished(
            entry.party.type,
            entry.party.id,
          );
          // A party already on the idea is updated, not doubled; ticking is
          // one-way here.
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

    // Every idea, newest first, with everyone it is for.
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
