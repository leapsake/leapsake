// @vitest-environment jsdom
import type { Milestone, Person, Pet } from "@leapsake/schema";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PersonScreen,
  PetScreen,
  RelationshipScreen,
  type GenderResult,
} from "../src/web/index.js";
import { fakeGiftsPorts, renderWithGifts } from "./gift-support.js";

afterEach(cleanup);

const trail = [{ label: "People & Pets", href: "/people" }];
const gender: GenderResult = { value: "female", origin: "explicit" };

const person = {
  id: "p-1",
  firstName: "Ada",
  middleName: null,
  lastName: "Lovelace",
  gender: "female",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  deletedAt: null,
} as Person;

function renderPerson(over: { duplicateCount?: number } = {}) {
  const onChanged = vi.fn();
  renderWithGifts(
    <PersonScreen
      trail={trail}
      person={person}
      gender={gender}
      tags={[]}
      relationships={[]}
      timeline={[]}
      contactMethods={[]}
      mentionedIn={[]}
      holidays={[]}
      giftSuggestions={[]}
      giftsGiven={[]}
      giftIdeaPool={[]}
      duplicateCount={over.duplicateCount ?? 0}
      onSetObserves={vi.fn(async () => {})}
      onChanged={onChanged}
    />,
    fakeGiftsPorts(),
  );
  return { onChanged };
}

const sectionTitles = () =>
  screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

const href = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("href");

describe("PersonScreen", () => {
  it("leads with the person's name as the page heading", () => {
    renderPerson();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Ada Lovelace",
    );
  });

  it("carries every section a person has", () => {
    renderPerson();
    expect(sectionTitles()).toEqual([
      "Contact",
      "Relationships",
      "Milestones",
      "Holidays",
      "Gifts",
      "Tags",
      "Mentioned in",
    ]);
  });

  it("offers edit, merge and delete for the person", () => {
    renderPerson();

    expect(href("Edit")).toBe("/people/p-1/edit");
    expect(href("Merge")).toBe("/people/p-1/merge");
    expect(href("Delete")).toBe("/people/p-1/delete");
  });

  it("shows no duplicate banner when nothing looks like this person", () => {
    renderPerson({ duplicateCount: 0 });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("states the count and links to a scoped review when there are duplicates", () => {
    // Both halves of a pair carry this, so the way back is on whichever person
    // the user happens to open.
    renderPerson({ duplicateCount: 2 });

    expect(screen.getByRole("status").textContent).toContain("2 other people");
    expect(
      screen.getByRole("link", { name: "Review" }).getAttribute("href"),
    ).toBe("/duplicates?for=p-1");
  });

  it("reads as one person, not several, when only one matches", () => {
    renderPerson({ duplicateCount: 1 });
    expect(screen.getByRole("status").textContent).toContain(
      "Someone else in your list",
    );
  });

  it("renders a dash for a middle name nobody has", () => {
    renderPerson();
    expect(screen.getByText("—")).toBeTruthy();
  });
});

const pet = {
  id: "x-1",
  name: "Ada Cat",
  gender: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  deletedAt: null,
} as Pet;

describe("PetScreen", () => {
  it("omits the sections a pet has no use for", () => {
    // No contact methods, and no merge — reconciliation is person-shaped today.
    renderWithGifts(
      <PetScreen
        trail={trail}
        pet={pet}
        gender={{ value: null, origin: "derived" }}
        tags={[]}
        relationships={[]}
        timeline={[]}
        mentionedIn={[]}
        holidays={[]}
        giftSuggestions={[]}
        giftsGiven={[]}
        giftIdeaPool={[]}
        onSetObserves={vi.fn(async () => {})}
        onChanged={vi.fn()}
      />,
      fakeGiftsPorts(),
    );

    expect(sectionTitles()).toEqual([
      "Relationships",
      "Milestones",
      "Holidays",
      "Gifts",
      "Tags",
      "Mentioned in",
    ]);
    expect(screen.queryByRole("link", { name: "Merge" })).toBeNull();
  });
});

describe("RelationshipScreen", () => {
  const partners = [
    { type: "person" as const, id: "p-1", label: "Ada", roleLabel: "Wife" },
    { type: "person" as const, id: "p-2", label: "Grace", roleLabel: "Wife" },
  ];

  it("lists both partners, linking each to their own page", () => {
    renderWithGifts(
      <RelationshipScreen
        trail={trail}
        relationshipId="rel-1"
        title="Ada & Grace"
        partners={partners}
        milestones={[]}
      />,
      fakeGiftsPorts(),
    );

    expect(screen.getByRole("link", { name: "Ada" }).getAttribute("href")).toBe(
      "/people/p-1",
    );
    expect(
      screen.getByRole("link", { name: "Grace" }).getAttribute("href"),
    ).toBe("/people/p-2");
  });

  it("keeps both partners when they share a role label", () => {
    // Two wives are two rows; keying the detail list by term would drop one.
    const { container } = renderWithGifts(
      <RelationshipScreen
        trail={trail}
        relationshipId="rel-1"
        title="Ada & Grace"
        partners={partners}
        milestones={[]}
      />,
      fakeGiftsPorts(),
    );

    expect(container.querySelectorAll("dt")).toHaveLength(2);
  });

  it("treats the relationship's milestones as its own to edit", () => {
    // They surface read-only on each partner's timeline; this is where they're
    // managed.
    const milestone = {
      id: "m-1",
      kind: "wedding",
      bearerType: "relationship",
      bearerId: "rel-1",
      year: 2020,
      month: 6,
      day: 1,
      note: null,
    } as Milestone;

    renderWithGifts(
      <RelationshipScreen
        trail={trail}
        relationshipId="rel-1"
        title="Ada & Grace"
        partners={partners}
        milestones={[milestone]}
      />,
      fakeGiftsPorts(),
    );

    expect(
      screen.getByRole("link", { name: "Edit" }).getAttribute("href"),
    ).toBe("/relationships/rel-1/milestones/m-1/edit");
  });
});
