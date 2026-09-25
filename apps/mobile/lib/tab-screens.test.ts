import { describe, expect, it } from "vitest";
import { SEARCH_CATEGORIES, categoryFor, facetsOf } from "./search-categories";
import { TAB_SCREENS } from "./tab-screens";

const screen = (name: string) => {
  const found = TAB_SCREENS.find((s) => s.name === name);
  if (found === undefined) throw new Error(`no tab screen "${name}"`);
  return found;
};

const routeOf = (href: string) => href.replace(/^\//, "");

describe("the tab bar", () => {
  it("holds Home, Search, People and Settings, in that order", () => {
    const buttons = TAB_SCREENS.flatMap((s) => (s.tab ? [s.tab] : []));
    expect(buttons.map((b) => [b.label, b.testID])).toEqual([
      ["Home", "tab-home"],
      ["Search", "tab-search"],
      ["People", "tab-people"],
      ["Settings", "tab-settings"],
    ]);
  });

  it("titles Home with the app's name and People with both kinds it holds", () => {
    expect(screen("index").title).toBe("Leapsake");
    expect(screen("people").title).toBe("People & Pets");
  });
});

describe("each screen's ➕", () => {
  it("opens the create screen for what that screen lists", () => {
    const creates = TAB_SCREENS.flatMap((s) =>
      s.create
        ? [[s.name, s.create.href, s.create.label, s.create.testID]]
        : [],
    );
    expect(creates).toEqual([
      ["index", "/reminders/new", "New reminder", "header-new-home"],
      ["people", "/add", "New person or pet", "header-new-people"],
      ["gifts", "/gifts/new", "New gift idea", "header-new-gifts"],
    ]);
  });
});

describe("the catalogs", () => {
  it("sit in the tab navigator, so the bar stays under them and Back never shows", () => {
    const names = TAB_SCREENS.map((s) => s.name);
    for (const category of SEARCH_CATEGORIES) {
      expect(names).toContain(routeOf(category.browseHref));
    }
  });

  it("have no button of their own, except People", () => {
    const hidden = TAB_SCREENS.filter((s) => s.tab === undefined);
    expect(hidden.map((s) => s.name)).toEqual(["gifts", "holidays", "tags"]);
  });

  it("each carry a 🔍 that narrows search to the kinds that catalog lists", () => {
    for (const category of SEARCH_CATEGORIES) {
      const key = screen(routeOf(category.browseHref)).search;
      expect(key).toBe(category.key);
    }
    expect(
      facetsOf(categoryFor(screen("people").search)!).map((f) => f.type),
    ).toEqual(["person", "pet"]);
    expect(
      facetsOf(categoryFor(screen("gifts").search)!).map((f) => f.type),
    ).toEqual(["gift_idea"]);
  });

  it("leave Home, Search and Settings without a 🔍", () => {
    const searchable = TAB_SCREENS.filter((s) => s.search !== undefined);
    expect(searchable.map((s) => s.name)).toEqual([
      "people",
      "gifts",
      "holidays",
      "tags",
    ]);
  });
});
