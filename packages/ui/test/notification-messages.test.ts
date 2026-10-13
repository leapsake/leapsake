import { describe, expect, it } from "vitest";
import { en } from "../src/messages/index.js";

const digest = en.notifications.digest;
const situation = {
  followUp: false,
  partOfDay: "day" as const,
  labels: ["Call Harry"],
  variant: 0,
};

describe("en.notifications.digest", () => {
  it("names a lone reminder in full", () => {
    expect(digest(situation).body).toBe("Call Harry");
  });

  it("names both of two reminders", () => {
    expect(
      digest({ ...situation, labels: ["Call Harry", "Gift Tilly"] }).body,
    ).toBe("Call Harry and Gift Tilly");
  });

  it("names the first of several and counts the rest", () => {
    expect(
      digest({
        ...situation,
        labels: ["Call Harry", "Gift Tilly", "Wish Violet", "Visit Mary"],
      }).body,
    ).toBe("Call Harry and 3 more");
  });

  it("greets the morning's first digest", () => {
    for (let variant = 0; variant < 10; variant++)
      expect(
        digest({ ...situation, partOfDay: "morning", variant }).title,
      ).toMatch(/morning/i);
  });

  it("titles an evening follow-up apart from the day's first digest", () => {
    const firsts = new Set<string>();
    const followUps = new Set<string>();
    for (let variant = 0; variant < 10; variant++) {
      firsts.add(digest({ ...situation, partOfDay: "evening", variant }).title);
      followUps.add(
        digest({ ...situation, followUp: true, partOfDay: "evening", variant })
          .title,
      );
    }

    expect([...followUps].filter((t) => firsts.has(t))).toEqual([]);
  });

  it("reads the same for the same variant, and differently across them", () => {
    const titles = Array.from(
      { length: 10 },
      (_, variant) => digest({ ...situation, variant }).title,
    );

    expect(digest({ ...situation, variant: 4 }).title).toBe(titles[4]);
    expect(new Set(titles).size).toBeGreaterThan(1);
  });
});
