import { describe, expect, it } from "vitest";
import { headerTitle, titleFromLink, withTitle } from "./record-title";

/**
 * How expo-router turns a path into `route.params` — `new URL(href, "file:")`,
 * whose `searchParams` decode on the way in (see `parseQueryParams` in
 * `expo-router/build/fork/getStateFromPath-forks.js`). The two ends of
 * `record-title` are only correct *together*, and only against this: it is what
 * says {@link withTitle}'s encoding is needed and {@link titleFromLink}'s lack of
 * decoding is right. Reimplemented rather than imported so the assumption is
 * stated where it is tested, and so a change to it fails here.
 */
function paramsFromHref(href: string): Record<string, string> {
  const { searchParams } = new URL(href, "file:");
  return Object.fromEntries(searchParams.entries());
}

/** A title sent, then read back the way the navigator will read it. */
const roundTrip = (path: string, title: string) =>
  titleFromLink(paramsFromHref(withTitle(path, title)));

describe("withTitle / titleFromLink", () => {
  it("carries an ordinary name to the screen it opens", () => {
    expect(roundTrip("/people/p1", "Ada Lovelace")).toBe("Ada Lovelace");
  });

  it("keeps the record's id readable beside it", () => {
    expect(paramsFromHref(withTitle("/people/p1", "Ada"))).toEqual({
      title: "Ada",
    });
    expect(withTitle("/people/p1", "Ada")).toBe("/people/p1?title=Ada");
  });

  it("survives the punctuation a URL would otherwise eat", () => {
    // Each of these ends the query, or a value in it, if it goes in raw.
    for (const name of [
      "Ben & Jerry",
      "#birthdays",
      "Who? Knows",
      "Anne-Marie O’Neill",
      "50% Off",
      "C++ Study Group",
      "Ann/Bob",
    ]) {
      expect(roundTrip("/tags/t1", name)).toBe(name);
    }
  });

  it("does not double-decode a name that looks encoded", () => {
    // The one case a decode on the reading end would quietly corrupt.
    expect(roundTrip("/people/p1", "A%20B")).toBe("A%20B");
  });

  it("appends to a path that already carries a parameter", () => {
    expect(roundTrip("/people/p1?pick=self", "Ada")).toBe("Ada");
    expect(withTitle("/people/p1?pick=self", "Ada")).toBe(
      "/people/p1?pick=self&title=Ada",
    );
  });

  it("sends nothing for a record with no name yet", () => {
    expect(withTitle("/people/p1", "")).toBe("/people/p1");
    expect(roundTrip("/people/p1", "")).toBe("");
  });

  it("reads a blank title from a link that sent none", () => {
    expect(titleFromLink(undefined)).toBe("");
    expect(titleFromLink({})).toBe("");
    expect(titleFromLink({ id: "p1" })).toBe("");
    // Repeated in the path, so react-navigation hands over an array.
    expect(titleFromLink({ title: ["Ada", "Grace"] })).toBe("");
  });
});

describe("headerTitle", () => {
  /** A route as react-navigation hands one to a header renderer. */
  const route = (name: string, params?: object) => ({ name, params });

  it("shows the title the screen declared", () => {
    expect(headerTitle({ title: "Holidays" }, route("holidays"))).toBe(
      "Holidays",
    );
  });

  it("keeps a screen's deliberate empty title", () => {
    // The reminder detail sets `""`: its own first words are its heading, and a
    // title bar repeating them would say the same sentence twice.
    expect(
      headerTitle({ title: "" }, route("reminders/[id]/index", { id: "r1" })),
    ).toBe("");
  });

  it("never names a screen after its route", () => {
    // The regression this whole module exists for. Every one of these is a real
    // route in the app, with a screen that has not declared its title yet.
    for (const name of [
      "reminders/[id]/index",
      "people/[id]/index",
      "pets/[id]/index",
      "tags/[id]/index",
      "holidays/[id]/index",
    ]) {
      expect(headerTitle({}, route(name, { id: "x1" }))).toBe("");
    }
  });

  it("falls back to the name the link sent", () => {
    expect(
      headerTitle({}, route("people/[id]/index", { id: "p1", title: "Ada" })),
    ).toBe("Ada");
  });

  it("prefers the screen's own title once it has one", () => {
    // The instant the record's read lands, its answer replaces the link's — which
    // is what keeps a stale sent name from outliving the load that used it.
    expect(
      headerTitle(
        { title: "Ada Lovelace" },
        route("people/[id]/index", { id: "p1", title: "Ada Lovelce" }),
      ),
    ).toBe("Ada Lovelace");
  });

  it("copes with a route carrying no parameters at all", () => {
    expect(headerTitle({}, route("data"))).toBe("");
  });
});
