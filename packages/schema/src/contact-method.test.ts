import { describe, expect, it } from "vitest";
import {
  contactOwnerTypeSchema,
  countryCodeSchema,
  createPostalInputSchema,
  formatPostalAddress,
  normalizeEmail,
  normalizePhone,
} from "./contact-method.js";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jane@Example.COM ")).toBe("jane@example.com");
  });
});

describe("normalizePhone", () => {
  it("keeps digits only for a national number", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("5551234567");
  });
  it("preserves a single leading +", () => {
    expect(normalizePhone("+1 555.123.4567")).toBe("+15551234567");
  });
  it("returns an empty string when there are no digits", () => {
    expect(normalizePhone("front desk")).toBe("");
  });
});

describe("contactOwnerTypeSchema", () => {
  it("reserves household alongside person", () => {
    expect(contactOwnerTypeSchema.options).toEqual(["person", "household"]);
  });
});

describe("countryCodeSchema", () => {
  it("accepts a two-letter uppercase code", () => {
    expect(countryCodeSchema.parse("US")).toBe("US");
  });
  it("rejects other shapes", () => {
    expect(() => countryCodeSchema.parse("us")).toThrow();
    expect(() => countryCodeSchema.parse("USA")).toThrow();
  });
});

describe("formatPostalAddress", () => {
  it("joins present fields, grouping region + postal code", () => {
    expect(
      formatPostalAddress({
        line1: "1 Main St",
        line2: "Apt 3",
        locality: "Springfield",
        region: "IL",
        postalCode: "62704",
        country: "US",
      }),
    ).toBe("1 Main St, Apt 3, Springfield, IL 62704, US");
  });
  it("omits absent fields", () => {
    expect(
      formatPostalAddress({
        line1: "PO Box 5",
        line2: null,
        locality: null,
        region: null,
        postalCode: null,
        country: null,
      }),
    ).toBe("PO Box 5");
  });
});

describe("createPostalInputSchema", () => {
  it("requires line1", () => {
    expect(() =>
      createPostalInputSchema.parse({
        ownerType: "person",
        ownerId: crypto.randomUUID(),
        label: "home",
      }),
    ).toThrow();
  });
});
