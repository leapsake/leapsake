// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PersonForm,
  PetForm,
  RelationshipFields,
  RelationshipForm,
  type RelationshipCandidate,
} from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

/** The Tags field's existing-tag picker; nothing to suggest in these tests. */
const noSearch = vi.fn(async () => []);

const candidates: RelationshipCandidate[] = [
  { type: "person", id: "p-2", label: "Ada Lovelace" },
  { type: "pet", id: "x-1", label: "Mrs Chippy" },
];

/** The hidden values the write path actually reads. */
const hidden = (container: HTMLElement) =>
  Object.fromEntries(
    [...container.querySelectorAll("input[type=hidden]")].map((i) => [
      i.getAttribute("name"),
      (i as HTMLInputElement).value,
    ]),
  );

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const submitButton = () => screen.getByRole("button", { name: "Add" });

describe("RelationshipForm", () => {
  function render() {
    return renderWithUi(
      <RelationshipForm
        subjectType="person"
        candidates={candidates}
        cancelTo="/people/p-1"
        submitting={false}
      />,
    );
  }

  it("holds the submit closed until both ends resolve", () => {
    // A half-typed name is a relationship to nobody.
    render();

    expect(submitButton().matches(":disabled")).toBe(true);
    type("Name", "Ada Lovelace");
    expect(submitButton().matches(":disabled")).toBe(true);
    type("Role", "Mother");
    expect(submitButton().matches(":disabled")).toBe(false);
  });

  it("resolves the typed labels into the machine values the write path reads", () => {
    const { container } = render();

    type("Name", "Ada Lovelace");
    type("Role", "Mother");

    expect(hidden(container)).toEqual({
      bType: "person",
      bId: "p-2",
      bRole: "mother",
      // The subject's own role is the inverse, submitted rather than shown.
      aRole: expect.any(String) as unknown as string,
    });
    expect(hidden(container).aRole).not.toBe("");
  });

  it("posts empty machine values while the name is unmatched", () => {
    const { container } = render();
    type("Name", "Nobody At All");
    expect(hidden(container).bId).toBe("");
  });

  it("suggests candidates by name and roles by label", () => {
    // Both inputs are free text backed by a datalist — a typed value that
    // matches nothing is allowed to sit there, it just doesn't resolve.
    const { container } = render();
    const lists = [...container.querySelectorAll("datalist")].map((d) =>
      [...d.querySelectorAll("option")].map((o) => o.getAttribute("value")),
    );

    expect(lists[0]).toEqual(["Ada Lovelace", "Mrs Chippy"]);
    expect(lists[1]).toContain("Mother");
  });

  it("asks for a note only when the role is the catch-all", () => {
    render();
    type("Name", "Ada Lovelace");
    expect(screen.queryByLabelText("Note")).toBeNull();

    type("Role", "Other");
    expect(screen.getByLabelText("Note")).toHaveProperty("name", "bRoleNote");
  });
});

describe("RelationshipFields", () => {
  it("starts with no rows unless the form asks for one", () => {
    renderWithUi(
      <RelationshipFields
        subjectType="person"
        candidates={candidates}
        submitting={false}
      />,
    );
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("opens with a row when the form nudges for one", () => {
    // The pet form does this, so a pet's name and owner can be set together.
    renderWithUi(
      <RelationshipFields
        subjectType="pet"
        candidates={candidates}
        submitting={false}
        initialRows={1}
      />,
    );
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });

  it("emits one hidden row per fully-resolved relationship, and none before", () => {
    const { container } = renderWithUi(
      <RelationshipFields
        subjectType="person"
        candidates={candidates}
        submitting={false}
        initialRows={1}
      />,
    );

    type("Name", "Ada Lovelace");
    expect(container.querySelectorAll("input[type=hidden]")).toHaveLength(0);

    type("Role", "Mother");
    const rows = [...container.querySelectorAll("input[name=relationships]")];
    expect(rows).toHaveLength(1);
    expect(JSON.parse((rows[0] as HTMLInputElement).value)).toEqual({
      bType: "person",
      bId: "p-2",
      bRole: "mother",
      bRoleNote: null,
    });
  });

  it("drops a row on Remove", () => {
    renderWithUi(
      <RelationshipFields
        subjectType="person"
        candidates={candidates}
        submitting={false}
        initialRows={1}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});

describe("PersonForm", () => {
  it("submits the three name parts and the gender under their stored names", () => {
    renderWithUi(
      <PersonForm
        title="Add a person"
        search={noSearch}
        submitLabel="Add"
        cancelTo="/"
        submitting={false}
      />,
    );

    expect(screen.getByLabelText("First name")).toHaveProperty(
      "name",
      "firstName",
    );
    expect(screen.getByLabelText("Middle name")).toHaveProperty(
      "name",
      "middleName",
    );
    expect(screen.getByLabelText("Last name")).toHaveProperty(
      "name",
      "lastName",
    );
    expect(screen.getByLabelText("Gender")).toHaveProperty("name", "gender");
  });

  // No single name part is required any more: a person needs *some* name, not a
  // first and a last one (`hasAnyName`). HTML5 has no way to say "at least one
  // of these three", so the rule is enforced by `personSchema` — the only place
  // that sees all three — and none of the inputs carries `required`.
  it("marks no name part as individually required", () => {
    renderWithUi(
      <PersonForm
        title="Add a person"
        search={noSearch}
        submitLabel="Add"
        cancelTo="/"
        submitting={false}
      />,
    );

    for (const label of ["First name", "Middle name", "Last name"]) {
      expect(screen.getByLabelText(label)).toHaveProperty("required", false);
    }
  });

  it("omits relationships on edit, which manages them on the view page", () => {
    renderWithUi(
      <PersonForm
        title="Edit Ada"
        search={noSearch}
        submitLabel="Save"
        cancelTo="/"
        submitting={false}
      />,
    );
    expect(screen.queryByRole("group", { name: "Relationships" })).toBeNull();
  });

  it("shows relationships on create, where candidates are passed", () => {
    renderWithUi(
      <PersonForm
        title="Add a person"
        candidates={candidates}
        search={noSearch}
        submitLabel="Add"
        cancelTo="/"
        submitting={false}
      />,
    );
    expect(screen.getByRole("group", { name: "Relationships" })).toBeTruthy();
  });
});

describe("PetForm", () => {
  it("submits one name and opens a relationship row for the owner", () => {
    renderWithUi(
      <PetForm
        title="Add a pet"
        candidates={candidates}
        search={noSearch}
        submitLabel="Add"
        cancelTo="/"
        submitting={false}
      />,
    );

    expect(screen.getAllByLabelText("Name")[0]).toHaveProperty("name", "name");
    // The nudge: one blank row, so the owner can be named in the same pass.
    expect(screen.getAllByLabelText("Name")).toHaveLength(2);
  });
});
