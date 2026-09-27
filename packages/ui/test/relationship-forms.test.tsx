// @vitest-environment jsdom
import type { Person } from "@leapsake/schema";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PersonForm,
  PetForm,
  RelationshipForm,
  StagedRelationshipsFields,
  type RelationshipCandidate,
} from "../src/web/index.js";
import { recordSubmits, renderWithUi } from "./support.js";

afterEach(cleanup);

/** The Tags field's existing-tag picker; nothing to suggest in these tests. */
const noSearch = vi.fn(async () => []);

const candidates: RelationshipCandidate[] = [
  { type: "person", id: "p-2", label: "Mary Bailey" },
  { type: "pet", id: "x-1", label: "Jimmy" },
];

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const submitButton = () => screen.getByRole("button", { name: /^(Add|Save)$/ });

/** Everything the form would post, read the way the route action reads it. */
const posted = (container: HTMLElement) =>
  Object.fromEntries(
    new FormData(container.querySelector("form") as HTMLFormElement),
  );

describe("RelationshipForm", () => {
  function render(over: Partial<Parameters<typeof RelationshipForm>[0]> = {}) {
    return renderWithUi(
      <RelationshipForm
        subjectType="person"
        candidates={candidates}
        cancelTo="/people/p-1"
        submitting={false}
        {...over}
      />,
    );
  }

  it("posts the typed name and the picked role, for the action to resolve", () => {
    const stopped = recordSubmits();
    const { container } = render();

    type("Role", "mother");
    type("Name", "Mary Bailey");
    fireEvent.click(submitButton());

    expect(stopped()).toEqual([false]);
    expect(posted(container)).toEqual({
      otherRole: "mother",
      otherName: "Mary Bailey",
    });
  });

  it("never disables Save, and explains a press on a name that matches nobody", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const stopped = recordSubmits();
    render();

    type("Role", "friend");
    type("Name", "Clarence Odbody");
    expect(submitButton().matches(":disabled")).toBe(false);
    fireEvent.click(submitButton());
    expect(alert).toHaveBeenCalledWith(
      "Nobody in Leapsake has that name. Pick someone from the list, or add them first.",
    );
    expect(stopped()).toEqual([true]);
    alert.mockRestore();
  });

  it("ignores a second press while saving, without disabling Save", () => {
    const stopped = recordSubmits();
    render({ submitting: true });
    type("Role", "mother");
    type("Name", "Mary Bailey");

    expect(submitButton().matches(":disabled")).toBe(false);
    expect(submitButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(submitButton());
    expect(stopped()).toEqual([true]);
  });

  it("keeps both fields required, so the browser asks first", () => {
    render();
    expect(screen.getByLabelText("Role")).toHaveProperty("required", true);
    expect(screen.getByLabelText("Name")).toHaveProperty("required", true);
  });

  it("offers every role up front, and narrows the names to who can hold one", () => {
    const { container } = render();
    const names = () =>
      [...container.querySelectorAll("datalist option")].map((o) =>
        o.getAttribute("value"),
      );

    expect(names()).toEqual(["Mary Bailey", "Jimmy"]);
    const roles = [
      ...screen.getByLabelText("Role").querySelectorAll("option"),
    ].map((o) => o.getAttribute("value"));
    expect(roles).toContain("mother");
    expect(roles).toContain("pet");

    type("Role", "pet");
    expect(names()).toEqual(["Jimmy"]);
  });

  it("asks for a note only when the role is the catch-all", () => {
    render();
    expect(screen.queryByLabelText("Note")).toBeNull();
    type("Role", "other");
    expect(screen.getByLabelText("Note")).toHaveProperty(
      "name",
      "otherRoleNote",
    );
  });

  it("edits only the role when the other end is fixed", () => {
    const { container } = render({
      candidates: [],
      initial: {
        other: {
          kind: "existing",
          type: "person",
          id: "p-2",
          label: "Mary Bailey",
        },
        role: "friend",
        note: "",
      },
    });

    expect(screen.queryByRole("combobox", { name: "Name" })).toBeNull();
    expect(screen.getByText("Mary Bailey")).toBeTruthy();
    // Only roles a person can hold opposite a person: never a pet.
    const roles = [
      ...screen.getByLabelText("Role").querySelectorAll("option"),
    ].map((o) => o.getAttribute("value"));
    expect(roles).not.toContain("pet");
    expect(posted(container)).toEqual({ otherRole: "friend" });
  });
});

describe("StagedRelationshipsFields", () => {
  it("starts with no rows unless the form asks for one", () => {
    renderWithUi(
      <StagedRelationshipsFields
        subjectType="person"
        candidates={candidates}
      />,
    );
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("opens with a row that requires nothing, so an empty one never blocks", () => {
    // The pet form does this, so a pet's name and owner can be set together.
    renderWithUi(
      <StagedRelationshipsFields
        subjectType="pet"
        candidates={candidates}
        initialRows={1}
      />,
    );
    expect(screen.getByLabelText("Name")).toHaveProperty("required", false);
    expect(screen.getByLabelText("Role")).toHaveProperty("required", false);
  });

  it("emits one hidden row per fully-resolved relationship, and none before", () => {
    const { container } = renderWithUi(
      <StagedRelationshipsFields
        subjectType="person"
        candidates={candidates}
        initialRows={1}
      />,
    );

    type("Name", "Mary Bailey");
    expect(container.querySelectorAll("input[type=hidden]")).toHaveLength(0);

    type("Role", "mother");
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
      <StagedRelationshipsFields
        subjectType="person"
        candidates={candidates}
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

  // Any one part is enough, which HTML can't say, so none carries `required`.
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

  it("never disables Add, and explains a press with no name at all", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const stopped = recordSubmits();
    renderWithUi(
      <PersonForm
        title="Add a person"
        search={noSearch}
        submitLabel="Add"
        cancelTo="/"
        submitting={false}
      />,
    );
    const add = screen.getByRole("button", { name: "Add" });

    expect(add.matches(":disabled")).toBe(false);
    fireEvent.click(add);
    expect(alert).toHaveBeenCalledWith(
      "Enter a first, middle or last name before saving.",
    );
    fireEvent.change(screen.getByLabelText("Last name"), {
      target: { value: "Bailey" },
    });
    fireEvent.click(add);
    expect(stopped()).toEqual([true, false]);
    alert.mockRestore();
  });

  it("pre-fills the person being edited, gender included", () => {
    renderWithUi(
      <PersonForm
        title="Edit George"
        person={
          {
            id: "p-1",
            firstName: "George",
            middleName: null,
            lastName: "Bailey",
            gender: "male",
          } as Person
        }
        tagNames="#family"
        search={noSearch}
        submitLabel="Save"
        cancelTo="/"
        submitting={false}
      />,
    );

    expect(screen.getByLabelText("First name")).toHaveProperty(
      "value",
      "George",
    );
    expect(screen.getByLabelText("Middle name")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Gender")).toHaveProperty("value", "male");
  });

  it("omits relationships on edit, which manages them on the view page", () => {
    renderWithUi(
      <PersonForm
        title="Edit Mary"
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
