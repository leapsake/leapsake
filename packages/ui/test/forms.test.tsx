// @vitest-environment jsdom
import type { GiftIdea, Reminder } from "@leapsake/schema";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Field,
  FormShell,
  GiftIdeaForm,
  ReminderForm,
  StackedField,
} from "../src/web/index.js";
import { recordSubmits, renderWithUi } from "./support.js";

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

  it("ignores a second submit while one is in flight, without disabling", () => {
    const stopped = recordSubmits();
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

    const add = screen.getByRole("button", { name: "Add" });

    expect(screen.getByLabelText("x").matches(":disabled")).toBe(false);
    expect(add.matches(":disabled")).toBe(false);
    expect(add.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(add);
    expect(stopped()).toEqual([true]);
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
    renderWithUi(<GiftIdeaForm search={noSearch} submitting={false} />);

    expect(
      screen.getAllByRole("textbox").map((f) => f.getAttribute("name")),
    ).toEqual(["title", "url", "notes"]);
    // Tags is a chip field, so it reports as a combobox rather than a plain
    // textbox — but it still carries `name`, since its text is what gets saved.
    expect(screen.getByRole("combobox")).toHaveProperty("name", "tags");
  });

  it("requires a title and nothing else", () => {
    renderWithUi(<GiftIdeaForm search={noSearch} submitting={false} />);

    expect(screen.getByLabelText("Title")).toHaveProperty("required", true);
    expect(screen.getByLabelText("Link")).toHaveProperty("required", false);
    expect(screen.getByLabelText("Notes")).toHaveProperty("required", false);
  });

  it("pre-fills from an existing idea on edit", () => {
    renderWithUi(
      <GiftIdeaForm
        idea={idea}
        tagNames="#books"
        search={noSearch}
        submitting={false}
      />,
    );

    expect(screen.getByLabelText("Title")).toHaveProperty("value", "Kite");
    expect(screen.getByLabelText("Link")).toHaveProperty(
      "value",
      "https://example.test",
    );
    expect(screen.getByLabelText("Tags")).toHaveProperty("value", "#books");
  });

  it("never disables Save, and explains a press before there is a title", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const stopped = recordSubmits();
    renderWithUi(<GiftIdeaForm search={noSearch} submitting={false} />);
    const save = screen.getByRole("button", { name: "Save" });

    expect(save).toHaveProperty("disabled", false);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "  " },
    });
    fireEvent.click(save);
    expect(alert).toHaveBeenCalledWith(
      "Give the gift idea a title before saving.",
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Kite" },
    });
    fireEvent.click(save);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(stopped()).toEqual([true, false]);
    alert.mockRestore();
  });

  it("returns to the gift list unless told otherwise", () => {
    renderWithUi(<GiftIdeaForm search={noSearch} submitting={false} />);
    expect(
      screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
    ).toBe("/gifts");
  });
});

describe("ReminderForm", () => {
  it("submits title, body and due date under their stored names", () => {
    const { container } = renderWithUi(
      <ReminderForm search={noSearch} submitting={false} />,
    );

    expect(screen.getByLabelText("Due date")).toHaveProperty("name", "dueDate");
    // Title and Details show a mention *draft* (`@Violet Bick`), so the stored text
    // — tokens and all — is what their hidden inputs carry to the write path.
    expect(
      [...container.querySelectorAll("input[type=hidden]")].map((i) =>
        i.getAttribute("name"),
      ),
    ).toEqual(["title", "body"]);
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

  it("explains a Save pressed before there is a title or details", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const stopped = recordSubmits();
    renderWithUi(<ReminderForm search={noSearch} submitting={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(alert).toHaveBeenCalledWith(
      "Give the reminder a title or some details before saving.",
    );
    expect(stopped()).toEqual([true]);
    alert.mockRestore();
  });

  it("lets the browser refuse a past day, but keeps a past day already saved", () => {
    const pastDue = {
      id: "r-1",
      title: "x",
      body: null,
      dueDate: 0,
    } as Reminder;
    renderWithUi(<ReminderForm search={noSearch} submitting={false} />);
    const min = screen.getByLabelText("Due date").getAttribute("min");
    expect(min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    cleanup();

    renderWithUi(
      <ReminderForm reminder={pastDue} search={noSearch} submitting={false} />,
    );
    expect(screen.getByLabelText("Due date").getAttribute("min")).toBe(
      "1970-01-01",
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
