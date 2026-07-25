// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTypeahead } from "../src/headless/index.js";

afterEach(cleanup);

/**
 * A minimal host for the hook: an input wired to its keyboard handler, with the
 * active index rendered so a test can watch the highlight move.
 */
function Host({
  options,
  onSelect,
  onEscape,
}: {
  options: string[];
  onSelect: (option: string) => void;
  onEscape?: (event: { preventDefault: () => void }) => void;
}) {
  const [query, setQuery] = useState("");
  // Below two characters the caller supplies nothing — the same floor the real
  // comboboxes apply before they search.
  const results = query.length < 2 ? [] : options;
  const { open, activeIndex, onKeyDown, optionId, listboxId } = useTypeahead({
    query,
    results,
    onSelect,
    onEscape,
  });

  return (
    <>
      <input
        aria-label="field"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <output data-testid="state">
        {open ? "open" : "closed"}:{activeIndex}:{optionId(activeIndex)}:
        {listboxId}
      </output>
    </>
  );
}

const state = () => screen.getByTestId("state").textContent ?? "";
const type = (value: string) =>
  fireEvent.change(screen.getByLabelText("field"), { target: { value } });
const press = (key: string) =>
  fireEvent.keyDown(screen.getByLabelText("field"), { key });

describe("useTypeahead", () => {
  it("stays closed until there are results", () => {
    render(<Host options={["a", "b", "c"]} onSelect={vi.fn()} />);
    expect(state()).toMatch(/^closed:/);

    type("ab");
    expect(state()).toMatch(/^open:/);
  });

  it("moves the highlight down and stops at the last option", () => {
    render(<Host options={["a", "b"]} onSelect={vi.fn()} />);
    type("ab");

    press("ArrowDown");
    expect(state()).toMatch(/^open:1:/);
    press("ArrowDown");
    expect(state()).toMatch(/^open:1:/); // clamped, no wrap
  });

  it("moves the highlight up and stops at the first option", () => {
    render(<Host options={["a", "b"]} onSelect={vi.fn()} />);
    type("ab");

    press("ArrowDown");
    press("ArrowUp");
    expect(state()).toMatch(/^open:0:/);
    press("ArrowUp");
    expect(state()).toMatch(/^open:0:/);
  });

  it("selects the highlighted option on Enter", () => {
    const onSelect = vi.fn();
    render(<Host options={["a", "b", "c"]} onSelect={onSelect} />);
    type("ab");

    press("ArrowDown");
    press("Enter");
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("ignores Enter and the arrows while closed, so a form can still submit", () => {
    const onSelect = vi.fn();
    render(<Host options={["a"]} onSelect={onSelect} />);

    press("Enter");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("returns the highlight to the top when the query changes", () => {
    // Otherwise the index survives into a different list and points at whatever
    // now happens to sit in that slot.
    render(<Host options={["a", "b", "c"]} onSelect={vi.fn()} />);
    type("ab");
    press("ArrowDown");
    press("ArrowDown");
    expect(state()).toMatch(/^open:2:/);

    type("abc");
    expect(state()).toMatch(/^open:0:/);
  });

  it("forwards Escape with its event and never acts on it itself", () => {
    // The three call sites mean different things by Escape, and one of them must
    // not suppress the browser default.
    const onEscape = vi.fn();
    const onSelect = vi.fn();
    render(<Host options={["a"]} onSelect={onSelect} onEscape={onEscape} />);
    type("ab");

    press("Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(state()).toMatch(/^open:0:/); // the hook closed nothing
  });

  it("gives each option a distinct id under one listbox", () => {
    render(<Host options={["a", "b"]} onSelect={vi.fn()} />);
    type("ab");
    const [, , optionId, listboxId] = state().split(":");
    expect(optionId).toContain(listboxId);
    expect(optionId).toMatch(/-opt-0$/);
  });
});
