// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DateFields,
  GiftOccasionFields,
  emptyDate,
  parseDateFields,
} from "../src/web/gifts/GiftOccasionFields.js";
import type { GiftOccasion } from "@leapsake/schema";
import { fakeGiftsPorts, renderWithGifts } from "./gift-support.js";

afterEach(cleanup);

const occasions = [
  { type: "milestone" as const, id: "m-1", label: "Birthday" },
  { type: "holiday" as const, id: "h-1", label: "Christmas" },
];

function Host() {
  const [occasion, setOccasion] = useState<GiftOccasion | null>(null);
  const [date, setDate] = useState<DateFields>(emptyDate());
  return (
    <GiftOccasionFields
      legend="For…"
      occasions={occasions}
      occasion={occasion}
      onOccasionChange={setOccasion}
      date={date}
      onDateChange={setDate}
    />
  );
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
const type = (name: string, value: string) =>
  fireEvent.change(field(name), { target: { value } });

describe("parseDateFields", () => {
  it("is null when wholly blank — “someday”, not a date", () => {
    expect(parseDateFields(emptyDate())).toBeNull();
  });

  it("drops a day with no month, mirroring the schema's rule", () => {
    expect(parseDateFields({ year: "", month: "", day: "25" })).toBeNull();
  });

  it("keeps a year alone — a standing intent with no day", () => {
    expect(parseDateFields({ year: "2026", month: "", day: "" })).toEqual({
      year: 2026,
      month: null,
      day: null,
    });
  });

  it("ignores junk in a part rather than submitting NaN", () => {
    expect(parseDateFields({ year: "abc", month: "", day: "" })).toBeNull();
  });
});

describe("GiftOccasionFields", () => {
  it("groups occasions by what they are", () => {
    const { container } = renderWithGifts(<Host />, fakeGiftsPorts());
    expect(
      [...container.querySelectorAll("optgroup")].map((g) =>
        g.getAttribute("label"),
      ),
    ).toEqual(["Milestones", "Holidays"]);
  });

  it("disables the day until a month is given", () => {
    renderWithGifts(<Host />, fakeGiftsPorts());
    expect(field("Day").disabled).toBe(true);

    type("Month", "12");
    expect(field("Day").disabled).toBe(false);
  });

  it("clears a day when its month is cleared", () => {
    // A day is only meaningful alongside a month; leaving it behind would submit
    // a value the schema rejects.
    renderWithGifts(<Host />, fakeGiftsPorts());
    type("Month", "12");
    type("Day", "25");
    type("Month", "");
    expect(field("Day").value).toBe("");
  });

  it("asks for a holiday's real dates only once a year is known", async () => {
    const loadOccurrences = vi.fn(async () => []);
    renderWithGifts(<Host />, fakeGiftsPorts({ loadOccurrences }));

    fireEvent.change(screen.getByLabelText("Occasion"), {
      target: { value: "holiday:h-1" },
    });
    await act(async () => {});
    expect(loadOccurrences).not.toHaveBeenCalled();

    type("Year", "2026");
    await act(async () => {});
    expect(loadOccurrences).toHaveBeenCalledWith("h-1", 2026);
  });

  it("offers every occurrence and fills none on its own", async () => {
    // A lunisolar holiday can fall twice in one Gregorian year, so the date is
    // the user's to pick — the occasion is only a label.
    renderWithGifts(
      <Host />,
      fakeGiftsPorts({
        loadOccurrences: async () => ["2026-02-17", "2026-12-25"],
      }),
    );

    fireEvent.change(screen.getByLabelText("Occasion"), {
      target: { value: "holiday:h-1" },
    });
    type("Year", "2026");
    await act(async () => {});

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Use 2026-02-17",
      "Use 2026-12-25",
    ]);
    expect(field("Month").value).toBe("");

    await act(async () => screen.getByText("Use 2026-12-25").click());
    expect(field("Month").value).toBe("12");
    expect(field("Day").value).toBe("25");
  });

  it("stops offering a date once it is the one chosen", async () => {
    renderWithGifts(
      <Host />,
      fakeGiftsPorts({ loadOccurrences: async () => ["2026-12-25"] }),
    );

    fireEvent.change(screen.getByLabelText("Occasion"), {
      target: { value: "holiday:h-1" },
    });
    type("Year", "2026");
    await act(async () => {});

    await act(async () => screen.getByText("Use 2026-12-25").click());
    expect(screen.queryByText("Use 2026-12-25")).toBeNull();
  });
});
