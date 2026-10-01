import { describe, expect, it } from "vitest";
import { comparePair } from "./duplicate-pair.js";

const fact = (field: string, key: string, text = key) => ({ field, key, text });

describe("comparePair", () => {
  it("lists what both people have as shared, worded as the first", () => {
    const { shared, differing } = comparePair(
      [fact("Email", "george@bailey.com", "George@Bailey.com")],
      [fact("Email", "george@bailey.com", "george@bailey.com")],
    );

    expect(shared).toEqual([{ field: "Email", values: ["George@Bailey.com"] }]);
    expect(differing).toEqual([]);
  });

  it("lists what only one person has as differing, on that person’s side", () => {
    const { shared, differing } = comparePair(
      [fact("Phone", "+15550100")],
      [fact("Phone", "+15550199"), fact("Birthday", "1907-03-09", "March 9")],
    );

    expect(shared).toEqual([]);
    expect(differing).toEqual([
      { field: "Phone", a: ["+15550100"], b: ["+15550199"] },
      { field: "Birthday", a: [], b: ["March 9"] },
    ]);
  });

  it("puts one field in both lists when some values match and some do not", () => {
    const { shared, differing } = comparePair(
      [fact("Email", "george@bailey.com"), fact("Email", "gb@work.com")],
      [fact("Email", "george@bailey.com")],
    );

    expect(shared).toEqual([{ field: "Email", values: ["george@bailey.com"] }]);
    expect(differing).toEqual([{ field: "Email", a: ["gb@work.com"], b: [] }]);
  });

  it("lists a value once however many times one person has it", () => {
    const { shared } = comparePair(
      [fact("Phone", "+15550100", "555-0100"), fact("Phone", "+15550100")],
      [fact("Phone", "+15550100")],
    );

    expect(shared).toEqual([{ field: "Phone", values: ["555-0100"] }]);
  });

  it("keeps fields in the order they were first seen", () => {
    const { differing } = comparePair(
      [fact("Name", "george"), fact("Email", "a@x.com")],
      [fact("Gender", "male"), fact("Name", "georgie")],
    );

    expect(differing.map((d) => d.field)).toEqual(["Name", "Email", "Gender"]);
  });
});
