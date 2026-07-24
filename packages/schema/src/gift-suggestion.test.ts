import { describe, expect, it } from "vitest";
import {
  createGiftSuggestionInputSchema,
  formatGiftTargetDate,
  giftSuggestionSchema,
  updateGiftSuggestionInputSchema,
} from "./gift-suggestion.js";

const validSuggestion = {
  id: crypto.randomUUID(),
  giftIdeaId: crypto.randomUUID(),
  recipientType: "person" as const,
  recipientId: crypto.randomUUID(),
  occasionType: null,
  occasionId: null,
  targetYear: null,
  targetMonth: null,
  targetDay: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

describe("giftSuggestionSchema", () => {
  it("accepts a bare suggestion", () => {
    expect(giftSuggestionSchema.parse(validSuggestion)).toEqual(
      validSuggestion,
    );
  });

  it("accepts a full occasion pointer and a target date", () => {
    const full = {
      ...validSuggestion,
      occasionType: "holiday" as const,
      occasionId: crypto.randomUUID(),
      targetYear: 2026,
      targetMonth: 12,
      targetDay: 25,
    };
    expect(giftSuggestionSchema.parse(full)).toEqual(full);
  });

  it("rejects a half occasion pointer (type without id, or vice versa)", () => {
    expect(() =>
      giftSuggestionSchema.parse({
        ...validSuggestion,
        occasionType: "milestone",
      }),
    ).toThrow();
    expect(() =>
      giftSuggestionSchema.parse({
        ...validSuggestion,
        occasionId: crypto.randomUUID(),
      }),
    ).toThrow();
  });

  it("rejects a target day without a target month", () => {
    expect(() =>
      giftSuggestionSchema.parse({
        ...validSuggestion,
        targetDay: 25,
      }),
    ).toThrow();
  });

  it("rejects an unknown recipient type", () => {
    expect(() =>
      giftSuggestionSchema.parse({
        ...validSuggestion,
        recipientType: "relationship",
      }),
    ).toThrow();
  });
});

describe("createGiftSuggestionInputSchema", () => {
  it("accepts just an idea and a recipient", () => {
    const input = {
      giftIdeaId: crypto.randomUUID(),
      recipientType: "person" as const,
      recipientId: crypto.randomUUID(),
    };
    expect(createGiftSuggestionInputSchema.parse(input)).toEqual(input);
  });

  it("accepts a nested occasion and target date", () => {
    const input = {
      giftIdeaId: crypto.randomUUID(),
      recipientType: "pet" as const,
      recipientId: crypto.randomUUID(),
      occasion: { type: "holiday" as const, id: crypto.randomUUID() },
      targetDate: { year: 2026, month: 12 },
    };
    expect(createGiftSuggestionInputSchema.parse(input)).toEqual(input);
  });

  it("rejects a target day without a month in the input", () => {
    expect(() =>
      createGiftSuggestionInputSchema.parse({
        giftIdeaId: crypto.randomUUID(),
        recipientType: "person",
        recipientId: crypto.randomUUID(),
        targetDate: { day: 3 },
      }),
    ).toThrow();
  });
});

describe("updateGiftSuggestionInputSchema", () => {
  it("accepts clearing occasion and target date to null", () => {
    expect(
      updateGiftSuggestionInputSchema.parse({
        occasion: null,
        targetDate: null,
      }),
    ).toEqual({ occasion: null, targetDate: null });
  });

  it("accepts an empty object", () => {
    expect(updateGiftSuggestionInputSchema.parse({})).toEqual({});
  });
});

describe("formatGiftTargetDate", () => {
  it("renders each precision like a milestone date", () => {
    expect(
      formatGiftTargetDate({
        targetYear: 1992,
        targetMonth: 3,
        targetDay: 9,
      }),
    ).toBe("March 9, 1992");
    expect(
      formatGiftTargetDate({
        targetYear: null,
        targetMonth: 12,
        targetDay: 25,
      }),
    ).toBe("December 25");
    expect(
      formatGiftTargetDate({
        targetYear: 2026,
        targetMonth: null,
        targetDay: null,
      }),
    ).toBe("2026");
    expect(
      formatGiftTargetDate({
        targetYear: null,
        targetMonth: null,
        targetDay: null,
      }),
    ).toBe("");
  });
});
