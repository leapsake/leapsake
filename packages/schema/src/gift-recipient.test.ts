import { describe, expect, it } from "vitest";
import {
  captureGiftInputSchema,
  createGiftRecipientInputSchema,
  giftRecipientSchema,
  updateGiftRecipientInputSchema,
} from "./gift-recipient.js";

const alice = crypto.randomUUID();
const rufus = crypto.randomUUID();

const validRow = {
  id: crypto.randomUUID(),
  giftIdeaId: crypto.randomUUID(),
  recipientType: "person" as const,
  recipientId: alice,
  givenAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

describe("giftRecipientSchema", () => {
  it("accepts a link nobody has given yet", () => {
    expect(giftRecipientSchema.parse(validRow)).toEqual(validRow);
  });

  it("accepts a given link, stamped", () => {
    const given = { ...validRow, givenAt: 1_760_000_000_000 };
    expect(giftRecipientSchema.parse(given)).toEqual(given);
  });

  it("accepts a pet recipient", () => {
    const pet = {
      ...validRow,
      recipientType: "pet" as const,
      recipientId: rufus,
    };
    expect(giftRecipientSchema.parse(pet)).toEqual(pet);
  });

  it("rejects a non-uuid id or idea", () => {
    expect(() =>
      giftRecipientSchema.parse({ ...validRow, id: "not-a-uuid" }),
    ).toThrow();
    expect(() =>
      giftRecipientSchema.parse({ ...validRow, giftIdeaId: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects a recipient type outside the enum", () => {
    expect(() =>
      giftRecipientSchema.parse({ ...validRow, recipientType: "relationship" }),
    ).toThrow();
  });

  it("rejects a non-integer givenAt", () => {
    expect(() =>
      giftRecipientSchema.parse({ ...validRow, givenAt: 1.5 }),
    ).toThrow();
  });

  it("requires givenAt to be present, even as null", () => {
    const { givenAt: _omitted, ...without } = validRow;
    expect(() => giftRecipientSchema.parse(without)).toThrow();
  });
});

describe("createGiftRecipientInputSchema", () => {
  it("accepts an idea and a party, given omitted", () => {
    const input = {
      giftIdeaId: crypto.randomUUID(),
      party: { type: "person" as const, id: alice },
    };
    expect(createGiftRecipientInputSchema.parse(input)).toEqual(input);
  });

  it("accepts an explicit given flag", () => {
    const input = {
      giftIdeaId: crypto.randomUUID(),
      party: { type: "pet" as const, id: rufus },
      given: true,
    };
    expect(createGiftRecipientInputSchema.parse(input)).toEqual(input);
  });

  it("takes a boolean, never a timestamp — the repo does the stamping", () => {
    expect(() =>
      createGiftRecipientInputSchema.parse({
        giftIdeaId: crypto.randomUUID(),
        party: { type: "person", id: alice },
        given: Date.now(),
      }),
    ).toThrow();
  });
});

describe("updateGiftRecipientInputSchema", () => {
  it("accepts either state", () => {
    expect(updateGiftRecipientInputSchema.parse({ given: true })).toEqual({
      given: true,
    });
    expect(updateGiftRecipientInputSchema.parse({ given: false })).toEqual({
      given: false,
    });
  });

  it("requires the flag — there is nothing else to update", () => {
    expect(() => updateGiftRecipientInputSchema.parse({})).toThrow();
  });
});

describe("captureGiftInputSchema", () => {
  it("accepts an idea with no recipients (just create the idea)", () => {
    const input = { giftIdea: { title: "Socks" }, recipients: [] };
    expect(captureGiftInputSchema.parse(input)).toEqual(input);
  });

  it("accepts an existing idea attached to several parties", () => {
    const input = {
      giftIdea: { id: crypto.randomUUID() },
      recipients: [
        { party: { type: "person" as const, id: alice } },
        { party: { type: "pet" as const, id: rufus }, given: true },
      ],
    };
    expect(captureGiftInputSchema.parse(input)).toEqual(input);
  });

  it("accepts a new idea named URL-first", () => {
    const input = {
      giftIdea: { title: "Tom Sawyer", url: "https://example.com/tom-sawyer" },
      recipients: [{ party: { type: "person" as const, id: alice } }],
    };
    expect(captureGiftInputSchema.parse(input)).toEqual(input);
  });

  it("rejects a new-idea reference with an empty title", () => {
    expect(() =>
      captureGiftInputSchema.parse({
        giftIdea: { title: "" },
        recipients: [],
      }),
    ).toThrow();
  });

  it("rejects a recipient with no party", () => {
    expect(() =>
      captureGiftInputSchema.parse({
        giftIdea: { title: "Socks" },
        recipients: [{ given: true }],
      }),
    ).toThrow();
  });
});
