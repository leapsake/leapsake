// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Combobox, ComboboxOptionDetail } from "../src/web/index.js";

afterEach(cleanup);

function renderCombobox({
  results = ["Mary", "Henry"],
  activeIndex = 0,
  onSelect = vi.fn(),
  announcement,
}: {
  results?: string[];
  activeIndex?: number;
  onSelect?: (option: string) => void;
  announcement?: string;
} = {}) {
  return render(
    <Combobox
      results={results}
      activeIndex={activeIndex}
      listboxId="lb"
      optionId={(i) => `lb-opt-${i}`}
      getKey={(o) => o}
      onSelect={onSelect}
      renderOption={(o) => o}
      announcement={announcement}
      renderField={(aria) => <input aria-label="field" {...aria} />}
    />,
  );
}

describe("Combobox", () => {
  it("hides the listbox when there is nothing to suggest", () => {
    renderCombobox({ results: [] });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByLabelText("field").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("ties the field to the listbox and the active option", () => {
    renderCombobox({ activeIndex: 1 });

    const field = screen.getByLabelText("field");
    expect(field.getAttribute("aria-expanded")).toBe("true");
    expect(field.getAttribute("aria-controls")).toBe("lb");
    expect(field.getAttribute("aria-activedescendant")).toBe("lb-opt-1");
    expect(screen.getByRole("listbox").id).toBe("lb");
  });

  it("points at no active option while closed", () => {
    renderCombobox({ results: [] });
    expect(
      screen.getByLabelText("field").hasAttribute("aria-activedescendant"),
    ).toBe(false);
  });

  it("marks only the active option as selected", () => {
    renderCombobox({ activeIndex: 1 });

    expect(
      screen.getAllByRole("option").map((o) => o.getAttribute("aria-selected")),
    ).toEqual(["false", "true"]);
  });

  it("commits a pick on mousedown, before the field can blur", () => {
    // click fires after blur, by which point the listbox is gone and the pick
    // is lost — this is why the handler is mousedown.
    const onSelect = vi.fn();
    renderCombobox({ onSelect });

    fireEvent.mouseDown(screen.getByText("Henry"));
    expect(onSelect).toHaveBeenCalledWith("Henry");
  });

  it("announces politely when given something to say", () => {
    const { container } = renderCombobox({ announcement: "Mary added" });

    const live = container.querySelector("[aria-live=polite]");
    expect(live?.textContent).toBe("Mary added");
  });

  it("renders no live region when there is nothing to announce", () => {
    const { container } = renderCombobox();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("renders option detail inside the option", () => {
    render(
      <Combobox
        results={["Mary"]}
        activeIndex={0}
        listboxId="lb"
        optionId={(i) => `lb-opt-${i}`}
        getKey={(o) => o}
        onSelect={vi.fn()}
        renderOption={(o) => (
          <>
            {o}
            <ComboboxOptionDetail>matched on tag</ComboboxOptionDetail>
          </>
        )}
        renderField={(aria) => <input aria-label="field" {...aria} />}
      />,
    );

    expect(screen.getByRole("option").textContent).toBe("Marymatched on tag");
  });
});
