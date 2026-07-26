// @vitest-environment jsdom
import type { GiftIdea, Reminder } from "@leapsake/schema";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Field,
  FormShell,
  GiftIdeaForm,
  ReminderForm,
  StackedField,
} from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

const noSearch = vi.fn(async () => []);

describe("FormShell", () => {
  it("posts to the route it is on, so the write path needs no target", () => {
    renderWithUi(
      <FormShell submitLabel="Save" cancelTo="/back" submitting={false}>
        <input name="x" aria-label="x" />
      </FormShell>,
    );

    const form = screen.getByRole("button", { name: "Save" }).closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.hasAttribute("action")).toBe(false);
  });

  it("puts the actions in a header when the form is the whole screen", () => {
    renderWithUi(
      <FormShell
        title="Add a person"
        submitLabel="Add"
        cancelTo="/back"
        submitting={false}
      >
        <input name="x" aria-label="x" />
      </FormShell>,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Add a person",
    );
    // Outside the fieldset, so it stays legible while the fields grey out.
    expect(
      screen.getByRole("button", { name: "Add" }).closest("fieldset"),
    ).toBeNull();
  });

  it("puts the actions at the foot when the screen owns the heading", () => {
    renderWithUi(
      <FormShell submitLabel="Save" cancelTo="/back" submitting={false}>
        <input name="x" aria-label="x" />
      </FormShell>,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Save" }).closest("fieldset"),
    ).not.toBeNull();
  });

  it("disables the fields and the submit while a submission is in flight", () => {
    renderWithUi(
      <FormShell
        title="Add a person"
        submitLabel="Add"
        cancelTo="/back"
        submitting
      >
        <input name="x" aria-label="x" />
      </FormShell>,
    );

    expect(screen.getByLabelText("x").matches(":disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Add" }).matches(":disabled"),
    ).toBe(true);
  });

  it("holds the submit closed while the form says it isn't ready", () => {
    renderWithUi(
      <FormShell
        submitLabel="Save"
        cancelTo="/back"
        submitting={false}
        canSubmit={false}
      >
        <input name="x" aria-label="x" />
      </FormShell>,
    );

    expect(
      screen.getByRole("button", { name: "Save" }).matches(":disabled"),
    ).toBe(true);
  });
});

describe("Field", () => {
  it("associates the label with its control without needing an id", () => {
    renderWithUi(
      <Field label="First name">
        <input name="firstName" />
      </Field>,
    );
    expect(screen.getByLabelText("First name")).toHaveProperty(
      "name",
      "firstName",
    );
  });

  it("associates a stacked label the same way", () => {
    renderWithUi(
      <StackedField label="Notes">
        <textarea name="notes" />
      </StackedField>,
    );
    expect(screen.getByLabelText("Notes")).toHaveProperty("name", "notes");
  });
});

describe("GiftIdeaForm", () => {
  const idea = {
    id: "i-1",
    title: "Kite",
    url: "https://example.test",
    notes: "the big one",
  } as GiftIdea;

  it("submits under the names the write path reads", () => {
    renderWithUi(<GiftIdeaForm submitting={false} />);

    expect(
      screen.getAllByRole("textbox").map((f) => f.getAttribute("name")),
    ).toEqual(["title", "url", "notes", "tags"]);
  });

  it("requires a title and nothing else", () => {
    renderWithUi(<GiftIdeaForm submitting={false} />);

    expect(screen.getByLabelText("Title")).toHaveProperty("required", true);
    expect(screen.getByLabelText("Link")).toHaveProperty("required", false);
    expect(screen.getByLabelText("Notes")).toHaveProperty("required", false);
  });

  it("pre-fills from an existing idea on edit", () => {
    renderWithUi(
      <GiftIdeaForm idea={idea} tagNames="#books" submitting={false} />,
    );

    expect(screen.getByLabelText("Title")).toHaveProperty("value", "Kite");
    expect(screen.getByLabelText("Link")).toHaveProperty(
      "value",
      "https://example.test",
    );
    expect(screen.getByLabelText("Tags")).toHaveProperty("value", "#books");
  });

  it("returns to the gift list unless told otherwise", () => {
    renderWithUi(<GiftIdeaForm submitting={false} />);
    expect(
      screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
    ).toBe("/gifts");
  });
});

describe("ReminderForm", () => {
  it("submits title, body and due date under their stored names", () => {
    renderWithUi(<ReminderForm search={noSearch} submitting={false} />);

    expect(screen.getByLabelText("Title")).toHaveProperty("name", "title");
    expect(screen.getByLabelText("Details")).toHaveProperty("name", "body");
    expect(screen.getByLabelText("Due date")).toHaveProperty("name", "dueDate");
  });

  it("starts empty when adding", () => {
    renderWithUi(<ReminderForm search={noSearch} submitting={false} />);
    expect(screen.getByLabelText("Title")).toHaveProperty("value", "");
  });

  it("pre-fills text and date when editing", () => {
    const reminder = {
      id: "r-1",
      title: "Call mom",
      body: "ask about the trip",
      dueDate: Date.UTC(2026, 0, 15),
    } as Reminder;

    renderWithUi(
      <ReminderForm reminder={reminder} search={noSearch} submitting={false} />,
    );

    expect(screen.getByLabelText("Title")).toHaveProperty("value", "Call mom");
    expect(screen.getByLabelText("Due date")).toHaveProperty(
      "value",
      "2026-01-15",
    );
  });

  it("leaves the date empty rather than inventing one", () => {
    const undated = { id: "r-1", title: "x", body: null } as Reminder;
    renderWithUi(
      <ReminderForm reminder={undated} search={noSearch} submitting={false} />,
    );
    expect(screen.getByLabelText("Due date")).toHaveProperty("value", "");
  });
});
