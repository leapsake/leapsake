import { describe, expect, it } from "vitest";
import { splitBearerHolidays } from "./holidays.js";

const holiday = (name: string, observes: boolean, hidden: boolean) => ({
  name,
  observes,
  hidden,
});

describe("splitBearerHolidays", () => {
  it("lists what the bearer observes and offers the rest", () => {
    const { observed, addable } = splitBearerHolidays([
      holiday("Diwali", true, false),
      holiday("Nowruz", false, false),
    ]);

    expect(observed.map((h) => h.name)).toEqual(["Diwali"]);
    expect(addable.map((h) => h.name)).toEqual(["Nowruz"]);
  });

  it("never offers a hidden holiday, since observing one would be a no-op", () => {
    const { addable } = splitBearerHolidays([
      holiday("Halloween", false, true),
    ]);

    expect(addable).toEqual([]);
  });

  it("still lists a hidden holiday the bearer already observes", () => {
    const { observed } = splitBearerHolidays([
      holiday("Halloween", true, true),
    ]);

    expect(observed.map((h) => h.name)).toEqual(["Halloween"]);
  });

  it("preserves the incoming order in both lists", () => {
    const { observed, addable } = splitBearerHolidays([
      holiday("B", true, false),
      holiday("A", false, false),
      holiday("C", true, false),
      holiday("D", false, false),
    ]);

    expect(observed.map((h) => h.name)).toEqual(["B", "C"]);
    expect(addable.map((h) => h.name)).toEqual(["A", "D"]);
  });
});
