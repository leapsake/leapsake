// @vitest-environment jsdom
import { type SearchHit, mentionToken } from "@leapsake/schema";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MentionTextField, StackedField } from "../src/web/index.js";
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

const search = vi.fn(async () => [davidHit]);

/**
 * The field as a form uses it: labelled, and holding the *stored* text — so a
 * test can read back both what the user sees and what the write path would get.
 */
function Host({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <StackedField label="Title">
      <MentionTextField
        name="title"
        value={value}
        onChange={setValue}
        search={search}
      />
    </StackedField>
  );
}

/** What the write path reads: the hidden input carrying the stored markup. */
function stored(container: HTMLElement): string | null {
  return container
    .querySelector("input[type=hidden][name=title]")
    ?.getAttribute("value") as string | null;
}

function type(field: HTMLElement, text: string) {
  fireEvent.change(field, { target: { value: text } });
  // A change event doesn't move the caret in jsdom; the field reads it back.
  (field as HTMLInputElement).setSelectionRange(text.length, text.length);
  fireEvent.select(field);
}

describe("MentionTextField", () => {
  it("shows a picked mention as '@Name' while storing the token", async () => {
    const { container } = renderWithUi(<Host />);
    const field = screen.getByLabelText("Title");

    type(field, "call @dav");
    fireEvent.mouseDown(await screen.findByRole("option"));

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

  it("paints a chip behind the mention, and nothing behind ordinary text", () => {
    const { container } = renderWithUi(<Host initial={`hi ${davidToken}!`} />);

    // The mirror carries its text as data attributes, so it stays out of the
    // label's accessible name — hence reading `data-run` rather than text.
    const runs = [...container.querySelectorAll("[aria-hidden=true] span")].map(
      (s) => [s.getAttribute("data-run"), s.className !== ""],
    );
    expect(runs).toEqual([
      ["hi ", false],
      ["@David Taylor", true],
      ["!", false],
    ]);
  });

  it("keeps the mirrored text out of the label", () => {
    renderWithUi(<Host initial={`call ${davidToken}`} />);
    // Would throw if the backdrop's copy of the text counted as label text.
    expect(screen.getByLabelText("Title")).toHaveProperty(
      "value",
      "call @David Taylor",
    );
  });

  it("decays a mention to plain text when it is edited into", async () => {
    const { container } = renderWithUi(<Host initial={`call ${davidToken}`} />);
    const field = screen.getByLabelText("Title");

    // Backspace at the end of the name.
    type(field, "call @David Taylo");

    expect(stored(container)).toBe("call @David Taylo");
    // And the chip is gone with it.
    await waitFor(() =>
      expect(container.querySelectorAll("[aria-hidden=true] span").length).toBe(
        1,
      ),
    );
  });

  it("does not treat a placed mention as a name still being typed", async () => {
    renderWithUi(<Host initial={davidToken} />);
    const field = screen.getByLabelText("Title");

    // Carry on typing after the mention. Read as raw text, everything back to
    // the leading "@" looks like one long fragment — "David Taylor and" — and
    // the picker would open again on it; the span is what says otherwise.
    type(field, "@David Taylor and");

    // Past the search debounce, so "no picker" means it never opened rather
    // than that we looked too early.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole("option")).toBeNull();
  });
});
