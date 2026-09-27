import { describe, expect, it } from "vitest";
import { petDraftOf, petInputOf } from "./pet.js";

describe("petInputOf", () => {
  it("trims the name and parses the tags", () => {
    expect(
      petInputOf({ name: " Zuzu ", gender: "female", tags: "#family" }),
    ).toEqual({
      ok: true,
      input: { name: "Zuzu", gender: "female" },
      tags: ["family"],
    });
  });

  it("refuses a blank name", () => {
    expect(petInputOf({ ...petDraftOf(), name: "  " })).toEqual({
      ok: false,
      errors: { name: "required" },
    });
  });
});

describe("petDraftOf", () => {
  it("starts from the pet being edited", () => {
    expect(petDraftOf({ name: "Zuzu", gender: null }, "#family")).toEqual({
      name: "Zuzu",
      gender: null,
      tags: "#family",
    });
  });
});
