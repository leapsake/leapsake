import { describe, expect, it } from "vitest";
import {
  DATE_FORMATS,
  type DateFormat,
  datePartOrder,
  defaultDateFormat,
  formatDate,
  formatDateTime,
  formatPartialDate,
} from "./date-format.js";

const NOV_9 = { year: 2026, month: 11, day: 9 };

describe("formatDate", () => {
  it("writes a whole date in each format", () => {
    const expected: Record<DateFormat, string> = {
      "Month D, YYYY": "November 9, 2026",
      "D Month YYYY": "9 November 2026",
      "MM/DD/YYYY": "11/09/2026",
      "DD/MM/YYYY": "09/11/2026",
      "DD.MM.YYYY": "09.11.2026",
      "DD-MM-YYYY": "09-11-2026",
      "YYYY-MM-DD": "2026-11-09",
      "YYYY/MM/DD": "2026/11/09",
      "YYYY.MM.DD": "2026.11.09",
    };
    for (const format of DATE_FORMATS) {
      expect(formatDate(NOV_9, format)).toBe(expected[format]);
    }
  });
});

describe("formatDateTime", () => {
  it("writes the local date in the format, then the time", () => {
    const at = new Date(2026, 10, 9, 11, 41).getTime();
    expect(formatDateTime(at, "DD.MM.YYYY")).toMatch(/^09\.11\.2026, \S/);
  });
});

describe("formatPartialDate", () => {
  it("writes a day without a year in words, in the format's order", () => {
    const birthday = { year: null, month: 3, day: 9 };
    expect(formatPartialDate(birthday, "Month D, YYYY")).toBe("March 9");
    expect(formatPartialDate(birthday, "MM/DD/YYYY")).toBe("March 9");
    expect(formatPartialDate(birthday, "YYYY-MM-DD")).toBe("March 9");
    expect(formatPartialDate(birthday, "D Month YYYY")).toBe("9 March");
    expect(formatPartialDate(birthday, "DD.MM.YYYY")).toBe("9 March");
  });

  it("never turns a month and year into digits", () => {
    for (const format of DATE_FORMATS) {
      expect(
        formatPartialDate({ year: 1992, month: 3, day: null }, format),
      ).toBe("March 1992");
    }
  });

  it("says only what is known", () => {
    const f: DateFormat = "DD/MM/YYYY";
    expect(formatPartialDate({ year: 1992, month: null, day: null }, f)).toBe(
      "1992",
    );
    expect(formatPartialDate({ year: null, month: 3, day: null }, f)).toBe(
      "March",
    );
    expect(formatPartialDate({ year: null, month: null, day: null }, f)).toBe(
      "",
    );
  });

  it("writes a whole date as formatDate does", () => {
    expect(formatPartialDate(NOV_9, "DD.MM.YYYY")).toBe("09.11.2026");
  });
});

describe("datePartOrder", () => {
  it("follows the format's order, words or digits", () => {
    expect(datePartOrder("Month D, YYYY")).toEqual(["month", "day", "year"]);
    expect(datePartOrder("MM/DD/YYYY")).toEqual(["month", "day", "year"]);
    expect(datePartOrder("D Month YYYY")).toEqual(["day", "month", "year"]);
    expect(datePartOrder("DD-MM-YYYY")).toEqual(["day", "month", "year"]);
    expect(datePartOrder("YYYY.MM.DD")).toEqual(["year", "month", "day"]);
  });
});

describe("defaultDateFormat", () => {
  it("writes month-first regions in words", () => {
    expect(defaultDateFormat("US")).toBe("Month D, YYYY");
    expect(defaultDateFormat("ph")).toBe("Month D, YYYY");
  });

  it("writes day-first regions in words, day first", () => {
    expect(defaultDateFormat("GB")).toBe("D Month YYYY");
    expect(defaultDateFormat("BR")).toBe("D Month YYYY");
    expect(defaultDateFormat("DE")).toBe("D Month YYYY");
  });

  it("writes year-first regions in their own digits", () => {
    expect(defaultDateFormat("CN")).toBe("YYYY-MM-DD");
    expect(defaultDateFormat("JP")).toBe("YYYY/MM/DD");
    expect(defaultDateFormat("KR")).toBe("YYYY.MM.DD");
  });

  it("falls back to month-first words with no region", () => {
    expect(defaultDateFormat(null)).toBe("Month D, YYYY");
  });
});
