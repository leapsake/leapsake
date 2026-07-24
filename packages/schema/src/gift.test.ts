import { describe, expect, it } from "vitest";
import { createGiftInputSchema, formatGiftDate, giftSchema } from "./gift.js";

const alice = crypto.randomUUID();
const bob = crypto.randomUUID();

const validGift = {
  id: crypto.randomUUID(),
  giftIdeaId: crypto.randomUUID(),
  giverType: null,
  giverId: null,
  recipientType: "person" as const,
  recipientId: alice,
  year: null,
  month: null,
  day: null,
  occasionType: null,
  occasionId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

describe("giftSchema", () => {
  it("accepts a bare gift with a null (unknown) giver", () => {
    expect(giftSchema.parse(validGift)).toEqual(validGift);
  });

  it("accepts a giver, a what-happened date, and an occasion", () => {
    const full = {
      ...validGift,
      giverType: "person" as const,
      giverId: bob,
      year: 1941,
      month: 12,
      day: 25,
      occasionType: "holiday" as const,
      occasionId: crypto.randomUUID(),
    };
    expect(giftSchema.parse(full)).toEqual(full);
  });

  it("rejects a half giver pointer", () => {
    expect(() =>
      giftSchema.parse({ ...validGift, giverType: "person" }),
    ).toThrow();
    expect(() => giftSchema.parse({ ...validGift, giverId: bob })).toThrow();
  });

  it("rejects a giver that equals the recipient", () => {
    expect(() =>
      giftSchema.parse({
        ...validGift,
        giverType: "person",
        giverId: alice,
      }),
    ).toThrow();
  });

  it("allows a giver of a different type but same id (not the same party)", () => {
    // Same uuid on a person giver and a pet recipient is not the same party.
    const g = {
      ...validGift,
      recipientType: "pet" as const,
      recipientId: alice,
      giverType: "person" as const,
      giverId: alice,
    };
    expect(giftSchema.parse(g)).toEqual(g);
  });

  it("rejects a day without a month", () => {
    expect(() => giftSchema.parse({ ...validGift, day: 25 })).toThrow();
  });

  it("rejects a half occasion pointer", () => {
    expect(() =>
      giftSchema.parse({ ...validGift, occasionType: "milestone" }),
    ).toThrow();
  });
});

describe("createGiftInputSchema", () => {
  it("accepts an existing-idea reference", () => {
    const input = {
      giftIdea: { id: crypto.randomUUID() },
      recipient: { type: "person" as const, id: alice },
    };
    expect(createGiftInputSchema.parse(input)).toEqual(input);
  });

  it("accepts a new-idea reference with a title and optional url", () => {
    const input = {
      giftIdea: { title: "BB Gun", url: "https://example.com" },
      recipient: { type: "person" as const, id: alice },
      giver: { type: "person" as const, id: bob },
      date: { year: 1941, month: 12, day: 25 },
    };
    expect(createGiftInputSchema.parse(input)).toEqual(input);
  });

  it("rejects a new-idea reference with an empty title", () => {
    expect(() =>
      createGiftInputSchema.parse({
        giftIdea: { title: "" },
        recipient: { type: "person", id: alice },
      }),
    ).toThrow();
  });

  it("rejects a date day without a month", () => {
    expect(() =>
      createGiftInputSchema.parse({
        giftIdea: { id: crypto.randomUUID() },
        recipient: { type: "person", id: alice },
        date: { day: 25 },
      }),
    ).toThrow();
  });
});

describe("formatGiftDate", () => {
  it("renders each precision like a milestone date", () => {
    expect(formatGiftDate({ year: 1941, month: 12, day: 25 })).toBe(
      "December 25, 1941",
    );
    expect(formatGiftDate({ year: null, month: 12, day: 25 })).toBe(
      "December 25",
    );
    expect(formatGiftDate({ year: 2023, month: null, day: null })).toBe("2023");
    expect(formatGiftDate({ year: null, month: null, day: null })).toBe("");
  });
});
