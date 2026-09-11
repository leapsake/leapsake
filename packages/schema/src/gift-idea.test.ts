import { describe, expect, it } from "vitest";
import {
  createGiftIdeaInputSchema,
  giftIdeaSchema,
  updateGiftIdeaInputSchema,
} from "./gift-idea.js";

const validIdea = {
  id: crypto.randomUUID(),
  title: "The Adventures of Tom Sawyer",
  url: null,
  notes: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

describe("giftIdeaSchema", () => {
  it("accepts a valid gift idea", () => {
    expect(giftIdeaSchema.parse(validIdea)).toEqual(validIdea);
  });

  it("accepts a url and notes", () => {
    const full = {
      ...validIdea,
      url: "https://example.com/tom-sawyer",
      notes: "the 200-shot model",
    };
    expect(giftIdeaSchema.parse(full)).toEqual(full);
  });

  it("rejects an empty title", () => {
    expect(() => giftIdeaSchema.parse({ ...validIdea, title: "" })).toThrow();
  });

  it("rejects an empty (non-null) url or notes", () => {
    expect(() => giftIdeaSchema.parse({ ...validIdea, url: "" })).toThrow();
    expect(() => giftIdeaSchema.parse({ ...validIdea, notes: "" })).toThrow();
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      giftIdeaSchema.parse({ ...validIdea, id: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("createGiftIdeaInputSchema", () => {
  it("accepts just a title", () => {
    expect(createGiftIdeaInputSchema.parse({ title: "Tom Sawyer" })).toEqual({
      title: "Tom Sawyer",
    });
  });

  it("accepts optional url and notes", () => {
    expect(
      createGiftIdeaInputSchema.parse({
        title: "Tom Sawyer",
        url: "https://example.com",
        notes: "n",
      }),
    ).toEqual({ title: "Tom Sawyer", url: "https://example.com", notes: "n" });
  });

  it("rejects a missing title", () => {
    expect(() => createGiftIdeaInputSchema.parse({ url: "x" })).toThrow();
  });
});

describe("updateGiftIdeaInputSchema", () => {
  it("accepts a partial update", () => {
    expect(updateGiftIdeaInputSchema.parse({ notes: "cheaper here" })).toEqual({
      notes: "cheaper here",
    });
  });

  it("accepts clearing url/notes to null", () => {
    expect(updateGiftIdeaInputSchema.parse({ url: null, notes: null })).toEqual(
      {
        url: null,
        notes: null,
      },
    );
  });

  it("accepts an empty object", () => {
    expect(updateGiftIdeaInputSchema.parse({})).toEqual({});
  });

  it("rejects an empty title when present", () => {
    expect(() => updateGiftIdeaInputSchema.parse({ title: "" })).toThrow();
  });
});
