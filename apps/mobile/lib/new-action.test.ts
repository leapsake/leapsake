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

  it("goes straight to the form when a search is filtered to a category", () => {
    expect(newActionFor("/search", { type: "people" })).toEqual(route("/add"));
    expect(newActionFor("/search", { type: "gifts" })).toEqual(
      route("/gifts/new"),
    );
  });

  it("falls back to asking for a category nothing can create", () => {
    // A holiday comes from the seeded catalog and a tag exists only because
    // something wears it. Neither has a create screen, so New must not pretend
    // the filter answered the question.
    expect(newActionFor("/search", { type: "holidays" })).toEqual(sheet);
    expect(newActionFor("/search", { type: "tags" })).toEqual(sheet);
  });

  it("does not trust an unrecognised filter", () => {
    expect(newActionFor("/search", { type: "nonsense" })).toEqual(sheet);
  });

  it("goes straight to the form on the two catalogs a user can add to", () => {
    // The catalogs sit in the tab navigator, so New is on screen there — and it
    // is the only way in, since neither carries a "+ Add" of its own any more.
    expect(newActionFor("/people")).toEqual(route("/add"));
    expect(newActionFor("/gifts")).toEqual(route("/gifts/new"));
  });

  it("asks on the two catalogs nothing can be added to", () => {
    // Same reason as the filtered-search case above, arrived at from the other
    // direction: New is on screen here too, and must not open a form that would
    // have nothing to write.
    expect(newActionFor("/holidays")).toEqual(sheet);
    expect(newActionFor("/tags")).toEqual(sheet);
  });

  it("asks on a screen it has never heard of", () => {
    expect(newActionFor("/holidays/abc/observers/person/xyz")).toEqual(sheet);
  });
});
