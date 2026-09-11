import type { EntityRow } from "@leapsake/core";
import type { Person, Pet, SearchHit, Tag } from "@leapsake/schema";
import { entityLabel } from "@leapsake/schema";
import { describe, expect, it } from "vitest";
import {
  entityHref,
  entityRowHref,
  headerTitle,
  holidayHref,
  holidayTitle,
  mentionHref,
  personHref,
  personTitle,
  petHref,
  petTitle,
  searchHitHref,
  tagHref,
  tagTitle,
  titleFromLink,
} from "./record-title";

/**
 * How expo-router turns a path into `route.params` — `new URL(href, "file:")`,
 * whose `searchParams` decode on the way in (see `parseQueryParams` in
 * `expo-router/build/fork/getStateFromPath-forks.js`). Reimplemented rather than
 * imported so the assumption is stated where it is tested, and so a change to it
 * fails here: it is what says the encoding on the way out is needed and the lack
 * of one on the way back is right.
 */
function paramsFromHref(href: string): Record<string, string> {
  const { searchParams } = new URL(href, "file:");
  return Object.fromEntries(searchParams.entries());
}

/** The title a link carries, read back exactly as the navigator will read it. */
const titleIn = (href: string) => titleFromLink(paramsFromHref(href));

/** The path with the title stripped off — where the link actually goes. */
const pathIn = (href: string) => href.split("?")[0];

const person = (over: Partial<Person> = {}): Person =>
  ({
    id: "p1",
    firstName: "Mary",
    middleName: null,
    lastName: "Bailey",
    ...over,
  }) as Person;

const pet = (over: Partial<Pet> = {}): Pet =>
  ({ id: "a1", name: "Jimmy", ...over }) as Pet;

const tag = (over: Partial<Tag> = {}): Tag =>
  ({ id: "t1", name: "birthdays", normalized: "birthdays", ...over }) as Tag;

const holiday = { id: "h1", name: "Lunar New Year" };

/** A row of the People & Pets catalog, labelled the way core labels one. */
const row = (type: "person" | "pet", entity: Person | Pet): EntityRow => ({
  type,
  id: entity.id,
  label: entityLabel(type, entity),
});

const hit = (over: Partial<SearchHit>): SearchHit =>
  ({ entityId: "x1", title: "", reasons: [], ...over }) as SearchHit;

/** A route as react-navigation hands one to a header renderer. */
const route = (name: string, params?: object) => ({ name, params });

/**
 * The invariant the whole module exists for: a link's title is the title its
 * destination will show. Both come from one function per kind, so what these pin
 * is the wiring — that each builder reaches for the right one, and that nothing
 * decorates the string on the way past.
 */
describe("a link carries the title its destination will show", () => {
  it("for a person", () => {
    expect(titleIn(personHref(person()))).toBe(personTitle(person()));
    expect(pathIn(personHref(person()))).toBe("/people/p1");
  });

  it("for a pet", () => {
    expect(titleIn(petHref(pet()))).toBe(petTitle(pet()));
    expect(pathIn(petHref(pet()))).toBe("/pets/a1");
  });

  it("for a tag, sigil and all", () => {
    expect(titleIn(tagHref(tag()))).toBe(tagTitle(tag()));
    expect(titleIn(tagHref(tag()))).toBe("#birthdays");
    expect(pathIn(tagHref(tag()))).toBe("/tags/t1");
  });

  it("for a holiday", () => {
    expect(titleIn(holidayHref(holiday))).toBe(holidayTitle(holiday));
    expect(pathIn(holidayHref(holiday))).toBe("/holidays/h1");
  });

  it("for either kind of entity, from the add form", () => {
    expect(titleIn(entityHref("person", person()))).toBe(personTitle(person()));
    expect(titleIn(entityHref("pet", pet()))).toBe(petTitle(pet()));
    expect(pathIn(entityHref("pet", pet()))).toBe("/pets/a1");
  });
});

/**
 * The three links built from a name someone else resolved rather than from the
 * record. These are the only places a string reaches a link without passing
 * through a title function, so they are the only places the two ends can drift —
 * which makes them the assertions with something to say.
 */
describe("a link built from an already-resolved name", () => {
  it("agrees with the page title, for a catalog row", () => {
    expect(titleIn(entityRowHref(row("person", person())))).toBe(
      personTitle(person()),
    );
    expect(titleIn(entityRowHref(row("pet", pet())))).toBe(petTitle(pet()));
    expect(pathIn(entityRowHref(row("pet", pet())))).toBe("/pets/a1");
  });

  it("agrees with the page title, for a search hit", () => {
    expect(
      titleIn(
        searchHitHref(hit({ entityType: "person", title: "Mary Bailey" })),
      ),
    ).toBe(personTitle(person()));
    expect(
      titleIn(searchHitHref(hit({ entityType: "pet", title: "Jimmy" }))),
    ).toBe(petTitle(pet()));
    expect(
      titleIn(
        searchHitHref(hit({ entityType: "holiday", title: "Lunar New Year" })),
      ),
    ).toBe(holidayTitle(holiday));
  });

  it("adds the sigil a tag hit leaves off", () => {
    // The search service indexes a tag under its stored name; the tag page shows
    // it with the "#". Handing the hit's title straight over would flicker.
    const tagHit = hit({
      entityType: "tag",
      entityId: "t1",
      title: "birthdays",
    });
    expect(titleIn(searchHitHref(tagHit))).toBe(tagTitle(tag()));
    expect(pathIn(searchHitHref(tagHit))).toBe("/tags/t1");
  });

  it("sends no name to a gift idea, which titles itself", () => {
    expect(
      searchHitHref(
        hit({
          entityType: "gift_idea",
          entityId: "g1",
          title: "A copy of Tom Sawyer",
        }),
      ),
    ).toBe("/gifts/g1/edit");
  });

  it("agrees with the page title, for an @mention", () => {
    // A mention's label is the target's current `entityLabel`, and it is carried
    // bare: the "@" belongs to the sentence it was written in, not to the page.
    expect(
      titleIn(
        mentionHref({
          targetType: "person",
          targetId: "p1",
          label: entityLabel("person", person()),
        }),
      ),
    ).toBe(personTitle(person()));
    expect(
      titleIn(
        mentionHref({
          targetType: "pet",
          targetId: "a1",
          label: entityLabel("pet", pet()),
        }),
      ),
    ).toBe(petTitle(pet()));
  });
});

describe("the name survives the trip", () => {
  it("carries punctuation a URL would otherwise eat", () => {
    // Each of these ends the query, or a value in it, if it goes in raw.
    for (const name of [
      "Pete & Jerry",
      "Who? Knows",
      "Anne-Marie O’Neill",
      "50% Off",
      "C++ Study Group",
      "Ann/Harry",
    ]) {
      expect(titleIn(petHref({ id: "a1", name }))).toBe(name);
    }
    expect(titleIn(tagHref(tag({ name: "back-to-school" })))).toBe(
      "#back-to-school",
    );
  });

  it("does not double-decode a name that looks encoded", () => {
    // The one case a decode on the reading end would quietly corrupt.
    expect(titleIn(petHref({ id: "a1", name: "A%20B" }))).toBe("A%20B");
  });

  it("sends nothing for a record with no name yet", () => {
    // A person can be saved before they are named; the page falls back to a bare
    // header rather than to an empty parameter saying so.
    const unnamed = person({
      firstName: null,
      middleName: null,
      lastName: null,
    });
    expect(personHref(unnamed)).toBe("/people/p1");
    expect(titleIn(personHref(unnamed))).toBe("");
  });

  it("reads a blank title from a link that sent none", () => {
    expect(titleFromLink(undefined)).toBe("");
    expect(titleFromLink({})).toBe("");
    expect(titleFromLink({ id: "p1" })).toBe("");
    // Repeated in the path, so react-navigation hands over an array.
    expect(titleFromLink({ title: ["Mary", "Henry"] })).toBe("");
  });
});

describe("headerTitle", () => {
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
      headerTitle(
        {},
        route("people/[id]/index", paramsFromHref(personHref(person()))),
      ),
    ).toBe("Mary Bailey");
  });

  it("prefers the screen's own title once it has one", () => {
    // The instant the record's read lands, its answer replaces the link's — which
    // is what keeps a stale sent name from outliving the load that used it.
    expect(
      headerTitle(
        { title: "Mary Bailey" },
        route("people/[id]/index", { id: "p1", title: "Mary Baily" }),
      ),
    ).toBe("Mary Bailey");
  });

  it("copes with a route carrying no parameters at all", () => {
    expect(headerTitle({}, route("data"))).toBe("");
  });
});
