// @vitest-environment jsdom
import { type SearchHit, mentionToken } from "@leapsake/schema";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChipTextField, StackedField } from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

const DAVID = "7d921dfc-daad-46b4-9a14-c05674e212f3";
const davidToken = mentionToken("David Taylor", "person", DAVID);

const davidHit = {
  entityType: "person",
  entityId: DAVID,
  title: "David Taylor",
  reasons: [],
} as unknown as SearchHit;
const familyHit = {
  entityType: "tag",
  entityId: "t-1",
  title: "family",
  reasons: [],
} as unknown as SearchHit;

const search = vi.fn(async () => [davidHit, familyHit]);

/**
 * The field as a form uses it: labelled, and holding the *stored* text — so a
 * test can read back both what the user sees and what the write path would get.
 */
function Host({
  initial = "",
  grammar = "prose",
}: {
  initial?: string;
  grammar?: "prose" | "tags";
}) {
  const [value, setValue] = useState(initial);
  return (
    <StackedField label="Title">
      <ChipTextField
        name="title"
        grammar={grammar}
        value={value}
        onChange={setValue}
        search={search}
      />
    </StackedField>
  );
}

/** What the write path reads — the hidden input in prose, the field in tags. */
function stored(container: HTMLElement): string | null {
  const hidden = container.querySelector("input[type=hidden][name=title]");
  if (hidden) return hidden.getAttribute("value");
  return (
    container.querySelector<HTMLInputElement>("input[name=title]")?.value ??
    null
  );
}

/** The chip runs the backdrop paints, in order. */
function chips(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[aria-hidden=true] span[class]")].map(
    (s) => s.getAttribute("data-run") ?? "",
  );
}

/**
 * Take a picker option. The combobox commits on `mousedown` (a `click` fires
 * after the field has blurred, by which point the listbox is gone), but the
 * `mouseup` still has to follow — React suppresses selection events between the
 * two, so a lone `mousedown` leaves every later caret assertion deaf. It goes to
 * the field because the option itself is unmounted by then, exactly as the
 * pointer ends up over the field in a real click.
 */
function clickOption(option: HTMLElement, field: HTMLElement) {
  fireEvent.mouseDown(option);
  fireEvent.mouseUp(field);
}

/** Type `text` into the field, leaving the caret at its end. */
function type(field: HTMLElement, text: string) {
  fireEvent.change(field, { target: { value: text } });
  // A change event doesn't move the caret in jsdom; the field reads it back.
  (field as HTMLInputElement).setSelectionRange(text.length, text.length);
  fireEvent.select(field);
}

/**
 * Move the caret to `to`, as if from `from` — a click, or an arrow-key step.
 * Focus first: React only reports a selection change for the focused element.
 */
function moveCaret(field: HTMLElement, from: number, to: number) {
  const el = field as HTMLInputElement;
  el.focus();
  el.setSelectionRange(from, from);
  fireEvent.select(el);
  el.setSelectionRange(to, to);
  fireEvent.select(el);
}

describe("ChipTextField — mentions", () => {
  it("shows a picked mention as '@Name' while storing the token", async () => {
    const { container } = renderWithUi(<Host />);
    const field = screen.getByLabelText("Title");

    type(field, "call @dav");
    clickOption(await screen.findByRole("option"), field);

    expect(field).toHaveProperty("value", "call @David Taylor ");
    expect(stored(container)).toBe(`call ${davidToken} `);
  });

  it("opens an existing reminder's text as a draft, not as markup", () => {
    const { container } = renderWithUi(
      <Host initial={`call ${davidToken} today`} />,
    );

    expect(screen.getByLabelText("Title")).toHaveProperty(
      "value",
      "call @David Taylor today",
    );
    // Untouched: what came in is what would go back out.
    expect(stored(container)).toBe(`call ${davidToken} today`);
  });

  it("chips the mention and the saved #tag, and nothing else", () => {
    const { container } = renderWithUi(
      <Host initial={`hi ${davidToken} #family!`} />,
    );
    expect(chips(container)).toEqual(["@David Taylor", "#family"]);
  });

  it("keeps the mirrored text out of the label", () => {
    renderWithUi(<Host initial={`call ${davidToken}`} />);
    // Would throw if the backdrop's copy of the text counted as label text.
    expect(screen.getByLabelText("Title")).toHaveProperty(
      "value",
      "call @David Taylor",
    );
  });

  it("deletes the whole mention when backspace lands at its end", async () => {
    const { container } = renderWithUi(<Host initial={`call ${davidToken}`} />);
    const field = screen.getByLabelText("Title");

    type(field, "call @David Taylo"); // backspace at the end of the name

    expect(stored(container)).toBe("call ");
    await waitFor(() => expect(chips(container)).toEqual([]));
  });

  it("does not treat a placed mention as a name still being typed", async () => {
    renderWithUi(<Host initial={davidToken} />);
    const field = screen.getByLabelText("Title");

    // Carry on typing after the mention. Read as raw text, everything back to
    // the leading "@" looks like one long fragment — "David Taylor and" — and
    // the picker would open again on it; the chip is what says otherwise.
    type(field, "@David Taylor and");

    // Past the search debounce, so "no picker" means it never opened rather
    // than that we looked too early.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole("option")).toBeNull();
  });
});

describe("ChipTextField — tags", () => {
  it("submits under its own name: the text is the stored value", () => {
    const { container } = renderWithUi(
      <Host grammar="tags" initial="#Friend" />,
    );
    expect(screen.getByLabelText("Title")).toHaveProperty("name", "title");
    expect(container.querySelector("input[type=hidden]")).toBeNull();
    expect(stored(container)).toBe("#Friend");
  });

  it("opens a saved record's tags as chips", () => {
    const { container } = renderWithUi(
      <Host grammar="tags" initial="#Friend Colleague" />,
    );
    // Every word is stored as a tag, so every word chips — bare ones included.
    expect(chips(container)).toEqual(["#Friend", "Colleague"]);
  });

  it("chips a new tag only once a character ends it", () => {
    const { container } = renderWithUi(<Host grammar="tags" />);
    const field = screen.getByLabelText("Title");

    type(field, "Friend");
    expect(chips(container)).toEqual([]);
    type(field, "Friend ");
    expect(chips(container)).toEqual(["Friend"]);
  });

  it("keeps the chip when its terminator is deleted, then takes it whole", () => {
    const { container } = renderWithUi(<Host grammar="tags" />);
    const field = screen.getByLabelText("Title");

    type(field, "Friend ");
    type(field, "Friend"); // the space goes; the chip is sticky
    expect(chips(container)).toEqual(["Friend"]);

    type(field, "Frien"); // now backspace lands in the chip
    expect(stored(container)).toBe("");
    expect(chips(container)).toEqual([]);
  });

  it("chips a picked tag at once, without waiting for a terminator", async () => {
    const { container } = renderWithUi(<Host grammar="tags" />);
    const field = screen.getByLabelText("Title");

    type(field, "fam");
    // The tags picker keeps only tag hits, so the one option is #family.
    clickOption(await screen.findByRole("option"), field);

    expect(stored(container)).toBe("#family ");
    expect(chips(container)).toEqual(["#family"]);
  });

  it("carries an arrow step over a chip rather than into it", () => {
    renderWithUi(<Host grammar="tags" initial="#Friend x" />);
    const field = screen.getByLabelText("Title") as HTMLInputElement;

    // ← from the chip's end: one step lands inside it, so it continues to 0.
    moveCaret(field, 7, 6);
    expect(field.selectionStart).toBe(0);

    // → from the chip's start goes the other way, to its end.
    moveCaret(field, 0, 1);
    expect(field.selectionStart).toBe(7);
  });

  it("sends a click inside a chip to the nearer edge", () => {
    renderWithUi(<Host grammar="tags" initial="#Friend x" />);
    const field = screen.getByLabelText("Title") as HTMLInputElement;

    field.focus();
    field.setSelectionRange(2, 2);
    fireEvent.select(field);
    expect(field.selectionStart).toBe(0);
  });
});

describe("ChipTextField — completing from the keyboard", () => {
  /** Press `key`, reporting whether the field swallowed it. */
  const press = (field: HTMLElement, key: string, shiftKey = false) =>
    !fireEvent.keyDown(field, { key, shiftKey });

  it("completes the highlighted mention on Enter", async () => {
    const { container } = renderWithUi(<Host />);
    const field = screen.getByLabelText("Title");

    type(field, "call @dav");
    await screen.findByRole("option");

    expect(press(field, "Enter")).toBe(true);
    expect(field).toHaveProperty("value", "call @David Taylor ");
    expect(stored(container)).toBe(`call ${davidToken} `);
  });

  it("completes the highlighted mention on Tab", async () => {
    const { container } = renderWithUi(<Host />);
    const field = screen.getByLabelText("Title");

    type(field, "call @dav");
    await screen.findByRole("option");

    // Swallowed, so focus stays put rather than moving on to the next control.
    expect(press(field, "Tab")).toBe(true);
    expect(field).toHaveProperty("value", "call @David Taylor ");
    expect(stored(container)).toBe(`call ${davidToken} `);
  });

  it("completes the highlighted tag on Tab", async () => {
    const { container } = renderWithUi(<Host grammar="tags" />);
    const field = screen.getByLabelText("Title");

    type(field, "fam");
    await screen.findByRole("option");

    expect(press(field, "Tab")).toBe(true);
    expect(stored(container)).toBe("#family ");
    expect(chips(container)).toEqual(["#family"]);
  });

  it("lets Tab move focus when there is no picker open", () => {
    const { container } = renderWithUi(<Host grammar="tags" />);
    const field = screen.getByLabelText("Title");

    type(field, "f"); // below the search floor, so nothing is suggested

    expect(press(field, "Tab")).toBe(false);
    expect(stored(container)).toBe("f");
  });

  it("lets Shift+Tab move focus even with the picker open", async () => {
    // Stepping backwards is how you leave a field without committing what you
    // were part-way through typing.
    const { container } = renderWithUi(<Host grammar="tags" />);
    const field = screen.getByLabelText("Title");

    type(field, "fam");
    await screen.findByRole("option");

    expect(press(field, "Tab", true)).toBe(false);
    expect(stored(container)).toBe("fam");
    expect(chips(container)).toEqual([]);
  });
});
