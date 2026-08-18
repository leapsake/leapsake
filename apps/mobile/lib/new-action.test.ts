import { describe, expect, it } from "vitest";
import { newActionFor } from "./new-action";

const route = (href: string) => ({ kind: "route", href });
const sheet = { kind: "sheet" };

describe("newActionFor", () => {
  it("asks on Home, which is about everything", () => {
    expect(newActionFor("/")).toEqual(sheet);
  });

  it("asks on Settings for the same reason", () => {
    expect(newActionFor("/menu")).toEqual(sheet);
  });

  it("asks on an unfiltered search, where nothing has been narrowed yet", () => {
    expect(newActionFor("/search")).toEqual(sheet);
    expect(newActionFor("/search", {})).toEqual(sheet);
  });

  it("goes straight to the form when a search is filtered to a type", () => {
    expect(newActionFor("/search", { type: "person" })).toEqual(route("/add"));
    expect(newActionFor("/search", { type: "pet" })).toEqual(route("/add"));
    expect(newActionFor("/search", { type: "gift_idea" })).toEqual(
      route("/gifts/new"),
    );
  });

  it("falls back to asking for a filtered type nothing can create", () => {
    // A holiday comes from the seeded catalog and a tag exists only because
    // something wears it. Neither has a create screen, so New must not pretend
    // the filter answered the question.
    expect(newActionFor("/search", { type: "holiday" })).toEqual(sheet);
    expect(newActionFor("/search", { type: "tag" })).toEqual(sheet);
  });

  it("does not trust an unrecognised filter", () => {
    expect(newActionFor("/search", { type: "nonsense" })).toEqual(sheet);
  });

  it("answers for the list screens by what they are, not who hosts them", () => {
    // Neither can reach New today (both push over the tab bar), but the table
    // is about the screen's subject rather than this month's navigator.
    expect(newActionFor("/people")).toEqual(route("/add"));
    expect(newActionFor("/gifts")).toEqual(route("/gifts/new"));
  });

  it("asks on a screen it has never heard of", () => {
    expect(newActionFor("/holidays/abc/observers/person/xyz")).toEqual(sheet);
  });
});
