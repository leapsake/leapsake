import { describe, expect, it } from "vitest";
import { genderLabel, genderSchema } from "./gender.js";

describe("genderSchema", () => {
  it("accepts the three gender values", () => {
    expect(genderSchema.parse("male")).toBe("male");
    expect(genderSchema.parse("female")).toBe("female");
    expect(genderSchema.parse("nonbinary")).toBe("nonbinary");
  });

  it("rejects unknown or free-text values", () => {
    expect(() => genderSchema.parse("other")).toThrow();
    expect(() => genderSchema.parse("")).toThrow();
    expect(() => genderSchema.parse("Male")).toThrow();
  });
});

describe("genderLabel", () => {
  it("maps each value to a display label", () => {
    expect(genderLabel.male).toBe("Male");
    expect(genderLabel.female).toBe("Female");
    expect(genderLabel.nonbinary).toBe("Non-binary");
  });
});
