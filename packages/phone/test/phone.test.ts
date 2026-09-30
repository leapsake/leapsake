import { describe, expect, it } from "vitest";
import { phoneE164 } from "../src/index.js";

describe("phoneE164", () => {
  it("reads a number without a country code as the region's", () => {
    expect(phoneE164("(412) 606-2561", "US")).toBe("+14126062561");
    expect(phoneE164("07911 123456", "GB")).toBe("+447911123456");
  });

  it("keeps the country code a number was written with", () => {
    expect(phoneE164("+44 7911 123456", "US")).toBe("+447911123456");
    expect(phoneE164("+1 (412) 606-2561", null)).toBe("+14126062561");
  });

  it("resolves nothing without a country code or a region", () => {
    expect(phoneE164("(412) 606-2561")).toBe("");
    expect(phoneE164("(412) 606-2561", "ZZ")).toBe("");
  });

  it("resolves nothing for a number that is not valid in its region", () => {
    expect(phoneE164("07911 123456", "US")).toBe("");
    expect(phoneE164("555 0109", "US")).toBe("");
    expect(phoneE164("ask my mum", "US")).toBe("");
  });
});
