// @vitest-environment jsdom
import type {
  ContactMethod,
  MilestoneTimelineEntry,
  RelationshipNeighbor,
  Reminder,
  Tag,
} from "@leapsake/schema";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContactMethodsSection,
  MentionedInSection,
  MilestonesSection,
  RelationshipsSection,
  TagsSection,
} from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

const href = (name: string) =>
  screen.getByRole("link", { name }).getAttribute("href");

describe("TagsSection", () => {
  const tags = [{ id: "t-1", name: "friend", normalized: "friend" }] as Tag[];

  it("links each tag to its own page", () => {
    renderWithUi(
      <TagsSection bearerType="person" bearerId="p-1" tags={tags} />,
    );
    expect(href("#friend")).toBe("/tags/t-1");
  });

  it("sends Edit tags to the bearer's own edit form", () => {
    // Tags are saved with the entity, so there is no tag editor of its own.
    renderWithUi(<TagsSection bearerType="pet" bearerId="x-1" tags={tags} />);
    expect(href("Edit tags")).toBe("/pets/x-1/edit");
  });

  it("says so when there are none", () => {
    renderWithUi(<TagsSection bearerType="person" bearerId="p-1" tags={[]} />);
    expect(screen.getByText("No tags yet.")).toBeTruthy();
  });
});

describe("MentionedInSection", () => {
  it("opens a reminder's edit screen, where the mention actually lives", () => {
    const reminders = [
      { id: "r-1", title: "Call Mary", body: null },
    ] as Reminder[];
    renderWithUi(<MentionedInSection reminders={reminders} />);
    expect(href("Call Mary")).toBe("/reminders/r-1/edit");
  });

  it("always renders, with a placeholder when empty", () => {
    renderWithUi(<MentionedInSection reminders={[]} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Mentioned in",
    );
    expect(screen.getByText("Not mentioned in any reminders.")).toBeTruthy();
  });
});

const ownBirthday = {
  milestone: {
    id: "m-1",
    kind: "birthday",
    bearerType: "person",
    bearerId: "p-1",
    year: 1990,
    month: 10,
    day: 31,
    note: null,
  },
  origin: "own",
  relationshipId: null,
  otherLabel: null,
} as MilestoneTimelineEntry;

describe("MilestonesSection", () => {
  it("offers Edit and Remove on a bearer's own milestone", () => {
    renderWithUi(
      <MilestonesSection
        bearerType="person"
        bearerId="p-1"
        entries={[ownBirthday]}
      />,
    );

    expect(href("Edit")).toBe("/people/p-1/milestones/m-1/edit");
    expect(href("Remove")).toBe("/people/p-1/milestones/m-1/delete");
  });

  it("shows a relationship's milestone read-only, pointing at its one edit surface", () => {
    const fromRelationship = {
      ...ownBirthday,
      milestone: { ...ownBirthday.milestone, kind: "wedding" },
      origin: "relationship",
      relationshipId: "rel-9",
      otherLabel: "Henry",
    } as MilestoneTimelineEntry;

    renderWithUi(
      <MilestonesSection
        bearerType="person"
        bearerId="p-1"
        entries={[fromRelationship]}
      />,
    );

    expect(href("View")).toBe("/relationships/rel-9");
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Remove" })).toBeNull();
    expect(screen.getByRole("cell", { name: /with Henry/ })).toBeTruthy();
  });

  it("offers Set spouse only for an unbound relationship-kind milestone", () => {
    // A wedding stored on the person while the spouse was unknown can be bound
    // later; a birthday never needs binding.
    const unboundWedding = {
      ...ownBirthday,
      milestone: { ...ownBirthday.milestone, id: "m-2", kind: "wedding" },
    } as MilestoneTimelineEntry;

    renderWithUi(
      <MilestonesSection
        bearerType="person"
        bearerId="p-1"
        entries={[ownBirthday, unboundWedding]}
      />,
    );

    expect(href("Set spouse")).toBe("/people/p-1/milestones/m-2/rebind");
    expect(screen.getAllByRole("link", { name: "Set spouse" })).toHaveLength(1);
  });

  it("renders a dash when the milestone has no date at all", () => {
    const undated = {
      ...ownBirthday,
      milestone: {
        ...ownBirthday.milestone,
        year: null,
        month: null,
        day: null,
      },
    } as MilestoneTimelineEntry;

    renderWithUi(
      <MilestonesSection
        bearerType="person"
        bearerId="p-1"
        entries={[undated]}
      />,
    );
    expect(screen.getByRole("cell", { name: "—" })).toBeTruthy();
  });
});

const explicitNeighbor = {
  origin: "explicit",
  relationshipId: "rel-1",
  otherType: "person",
  otherId: "p-2",
  otherRole: "mother",
  otherRoleLabel: "Mother",
  otherRoleNote: null,
  otherLabel: "Mary",
} as RelationshipNeighbor;

describe("RelationshipsSection", () => {
  it("links a stored edge to its details page and addresses it by id", () => {
    renderWithUi(
      <RelationshipsSection
        subjectType="person"
        subjectId="p-1"
        relationships={[explicitNeighbor]}
      />,
    );

    expect(href("Details")).toBe("/relationships/rel-1");
    expect(href("Edit")).toBe("/people/p-1/relationships/rel-1/edit");
    expect(href("Remove")).toBe("/people/p-1/relationships/rel-1/delete");
  });

  it("offers no Details for a derived edge, which has no page to open", () => {
    // The explicit/derived split is a backend detail: the row otherwise looks
    // identical, and Edit/Remove still work — by identity rather than by id.
    const derived = {
      ...explicitNeighbor,
      origin: "derived",
    } as RelationshipNeighbor;

    renderWithUi(
      <RelationshipsSection
        subjectType="person"
        subjectId="p-1"
        relationships={[derived]}
      />,
    );

    expect(screen.queryByRole("link", { name: "Details" })).toBeNull();
    expect(href("Edit")).toContain("/relationships/edit?");
    expect(href("Remove")).toContain("/relationships/dismiss?");
  });

  it("prefers a free-text note over the generic “Other” label", () => {
    const other = {
      ...explicitNeighbor,
      otherRole: "other",
      otherRoleLabel: "Other",
      otherRoleNote: "Chess partner",
    } as RelationshipNeighbor;

    renderWithUi(
      <RelationshipsSection
        subjectType="person"
        subjectId="p-1"
        relationships={[other]}
      />,
    );
    expect(screen.getByRole("cell", { name: "Chess partner" })).toBeTruthy();
  });
});

describe("ContactMethodsSection", () => {
  const phone = {
    kind: "phone",
    method: {
      id: "c-1",
      label: "Mobile",
      number: "555-0100",
      extension: null,
      smsCapable: true,
    },
  } as ContactMethod;

  it("creates one kind per Add link", () => {
    renderWithUi(<ContactMethodsSection personId="p-1" methods={[]} />);

    expect(href("Add email")).toBe("/people/p-1/contact/email/new");
    expect(href("Add phone")).toBe("/people/p-1/contact/phone/new");
    expect(href("Add address")).toBe("/people/p-1/contact/postal/new");
  });

  it("addresses Edit and Remove by kind and method id", () => {
    renderWithUi(<ContactMethodsSection personId="p-1" methods={[phone]} />);

    expect(href("Edit")).toBe("/people/p-1/contact/phone/c-1/edit");
    expect(href("Remove")).toBe("/people/p-1/contact/phone/c-1/delete");
  });

  it("flags a phone that can't receive texts, since texting is assumed", () => {
    const noSms = {
      ...phone,
      method: { ...phone.method, smsCapable: false },
    } as ContactMethod;

    renderWithUi(<ContactMethodsSection personId="p-1" methods={[noSms]} />);
    expect(screen.getByRole("cell", { name: /\(no texts\)/ })).toBeTruthy();
  });

  it("suffixes an extension onto the number", () => {
    const withExt = {
      ...phone,
      method: { ...phone.method, extension: "12" },
    } as ContactMethod;

    renderWithUi(<ContactMethodsSection personId="p-1" methods={[withExt]} />);
    expect(screen.getByRole("cell", { name: "555-0100 ext. 12" })).toBeTruthy();
  });
});
