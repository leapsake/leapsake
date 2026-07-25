// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HolidaysSection, type BearerHoliday } from "../src/web/index.js";
import { renderWithUi } from "./support.js";

afterEach(cleanup);

const holiday = (over: Partial<BearerHoliday> = {}): BearerHoliday => ({
  id: "h-1",
  name: "Diwali",
  observes: false,
  hidden: false,
  nextOccurrence: "2026-11-08",
  ...over,
});

function renderSection({
  holidays,
  onSetObserves = vi.fn(async () => {}),
}: {
  holidays: BearerHoliday[];
  onSetObserves?: (id: string, observes: boolean) => Promise<unknown>;
}) {
  const onChanged = vi.fn();
  const result = renderWithUi(
    <HolidaysSection
      bearerType="person"
      bearerId="p-1"
      holidays={holidays}
      onSetObserves={onSetObserves}
      onChanged={onChanged}
    />,
  );
  return { ...result, onChanged };
}

/** Type into the add field and read back what it suggests. */
function suggestionsFor(query: string): string[] {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: query } });
  return screen.queryAllByRole("option").map((o) => o.textContent ?? "");
}

const flush = () => act(async () => {});

describe("HolidaysSection", () => {
  it("lists only the holidays this bearer observes", () => {
    renderSection({
      holidays: [
        holiday({ id: "h-1", name: "Diwali", observes: true }),
        holiday({ id: "h-2", name: "Nowruz", observes: false }),
      ],
    });

    expect(screen.getByRole("cell", { name: /Diwali/ })).toBeTruthy();
    expect(screen.queryByRole("cell", { name: /Nowruz/ })).toBeNull();
  });

  it("says so when the bearer observes none", () => {
    renderSection({ holidays: [holiday()] });
    expect(screen.getByText("No holidays yet.")).toBeTruthy();
  });

  it("does not suggest a hidden holiday, which would generate no reminders", () => {
    // Adding an observance to a hidden holiday would appear to do nothing, so
    // offering it would be offering a no-op.
    renderSection({
      holidays: [
        holiday({ id: "h-1", name: "Diwali", hidden: true }),
        holiday({ id: "h-2", name: "Diwali Eve", hidden: false }),
      ],
    });

    expect(suggestionsFor("diwali")).toEqual(["Diwali Eve"]);
  });

  it("still lists a hidden holiday already observed, and marks it", () => {
    // Otherwise the state would be unexplainable: observed, but silent.
    renderSection({
      holidays: [holiday({ observes: true, hidden: true })],
    });
    expect(screen.getByRole("cell", { name: "Diwali (hidden)" })).toBeTruthy();
  });

  it("does not suggest a holiday already observed", () => {
    renderSection({ holidays: [holiday({ observes: true })] });
    expect(suggestionsFor("diwali")).toEqual([]);
  });

  it("records an observance when one is picked", async () => {
    const onSetObserves = vi.fn(async () => {});
    const { onChanged } = renderSection({
      holidays: [holiday()],
      onSetObserves,
    });

    suggestionsFor("diwali");
    fireEvent.mouseDown(screen.getByRole("option", { name: "Diwali" }));
    await flush();

    expect(onSetObserves).toHaveBeenCalledWith("h-1", true);
    expect(onChanged).toHaveBeenCalled();
  });

  it("clears an observance from the row's Remove", async () => {
    const onSetObserves = vi.fn(async () => {});
    renderSection({
      holidays: [holiday({ observes: true })],
      onSetObserves,
    });

    await act(async () =>
      screen.getByRole("button", { name: "Remove" }).click(),
    );
    expect(onSetObserves).toHaveBeenCalledWith("h-1", false);
  });

  it("surfaces a failed write instead of failing silently", async () => {
    renderSection({
      holidays: [holiday({ observes: true })],
      onSetObserves: () => Promise.reject(new Error("relay down")),
    });

    await act(async () =>
      screen.getByRole("button", { name: "Remove" }).click(),
    );
    expect(screen.getByText(/relay down/)).toBeTruthy();
  });

  it("points each row at that observance's own reminder schedule", () => {
    // The rule bears on the observance, not the holiday: two people observing
    // one holiday can be reminded about entirely different things.
    renderSection({ holidays: [holiday({ observes: true })] });

    expect(
      screen.getByRole("link", { name: "Reminders" }).getAttribute("href"),
    ).toBe("/holidays/h-1/observers/person/p-1");
  });

  it("renders a dash when nothing is known about the next occurrence", () => {
    renderSection({
      holidays: [holiday({ observes: true, nextOccurrence: null })],
    });
    expect(screen.getByRole("cell", { name: "—" })).toBeTruthy();
  });
});
