import { describe, expect, it } from "vitest";
import {
  createMilestoneInputSchema,
  datePrecisionOf,
  formatMilestoneDate,
  kindDefs,
  kindsForBearerType,
  milestoneLabel,
  milestoneSchema,
  preferredBearerType,
} from "./milestone.js";

const validMilestone = {
  id: crypto.randomUUID(),
  kind: "birthday" as const,
  bearerType: "person" as const,
  bearerId: crypto.randomUUID(),
  year: 1992,
  month: 3,
  day: 9,
  note: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

describe("milestoneSchema", () => {
  it("accepts a valid full-date milestone", () => {
    expect(milestoneSchema.parse(validMilestone)).toEqual(validMilestone);
  });

  it("accepts partial dates: year only, month+day, and nothing", () => {
    expect(
      milestoneSchema.parse({ ...validMilestone, month: null, day: null }).year,
    ).toBe(1992);
    expect(milestoneSchema.parse({ ...validMilestone, year: null }).day).toBe(
      9,
    );
    expect(
      milestoneSchema.parse({
        ...validMilestone,
        year: null,
        month: null,
        day: null,
      }).month,
    ).toBeNull();
  });

  it("rejects a day without a month (day ⇒ month)", () => {
    expect(() =>
      milestoneSchema.parse({ ...validMilestone, month: null }),
    ).toThrow();
    // year + day but no month is the same violation.
    expect(() =>
      milestoneSchema.parse({ ...validMilestone, month: null, year: 1992 }),
    ).toThrow();
  });

  it("rejects an out-of-range month or day", () => {
    expect(() =>
      milestoneSchema.parse({ ...validMilestone, month: 13 }),
    ).toThrow();
    expect(() =>
      milestoneSchema.parse({ ...validMilestone, day: 0 }),
    ).toThrow();
  });

  it("enforces allowed bearer types per kind", () => {
    // A pet can have a birthday…
    expect(
      milestoneSchema.parse({ ...validMilestone, bearerType: "pet" })
        .bearerType,
    ).toBe("pet");
    // …but graduation is a person-only kind.
    expect(() =>
      milestoneSchema.parse({
        ...validMilestone,
        kind: "graduation",
        bearerType: "pet",
      }),
    ).toThrow();
    // A first date may sit on a relationship.
    expect(
      milestoneSchema.parse({
        ...validMilestone,
        kind: "first-date",
        bearerType: "relationship",
      }).bearerType,
    ).toBe("relationship");
  });

  it("rejects an unknown kind and a non-uuid id", () => {
    expect(() =>
      milestoneSchema.parse({ ...validMilestone, kind: "promotion" }),
    ).toThrow();
    expect(() =>
      milestoneSchema.parse({ ...validMilestone, id: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("createMilestoneInputSchema", () => {
  it("accepts a bearer + kind with no date parts", () => {
    const input = {
      kind: "birthday" as const,
      bearerType: "person" as const,
      bearerId: crypto.randomUUID(),
    };
    expect(createMilestoneInputSchema.parse(input)).toEqual(input);
  });

  it("rejects a day without a month", () => {
    expect(() =>
      createMilestoneInputSchema.parse({
        kind: "birthday",
        bearerType: "person",
        bearerId: crypto.randomUUID(),
        day: 9,
      }),
    ).toThrow();
  });

  it("rejects a kind its bearer type can't hold", () => {
    expect(() =>
      createMilestoneInputSchema.parse({
        kind: "graduation",
        bearerType: "pet",
        bearerId: crypto.randomUUID(),
      }),
    ).toThrow();
  });
});

describe("kind registry", () => {
  it("lists the kinds a bearer type may hold, in registry order", () => {
    const personKinds = kindsForBearerType("person").map((k) => k.kind);
    expect(personKinds).toContain("birthday");
    expect(personKinds).toContain("graduation");
    expect(personKinds[0]).toBe("birthday");

    const petKinds = kindsForBearerType("pet").map((k) => k.kind);
    expect(petKinds).toContain("birthday");
    expect(petKinds).not.toContain("graduation");

    const relKinds = kindsForBearerType("relationship").map((k) => k.kind);
    expect(relKinds).toContain("first-date");
    expect(relKinds).not.toContain("birthday");
  });

  it("reports the preferred bearer type per kind", () => {
    expect(preferredBearerType("birthday")).toBe("person");
    expect(preferredBearerType("first-date")).toBe("relationship");
  });

  it("enables a default reminder only for birthdays (death offers only an off 'remember')", () => {
    // The engine mints a reminder for every `enabledByDefault` entry, so "reminds
    // by default" now means "has an enabled-by-default rule" — the birthday wish
    // is the only one anywhere.
    const hasEnabledDefault = (kind: keyof typeof kindDefs) =>
      kindDefs[kind].defaultReminderSchedule.some((r) => r.enabledByDefault);
    const remindingKinds = (
      Object.keys(kindDefs) as (keyof typeof kindDefs)[]
    ).filter(hasEnabledDefault);
    expect(remindingKinds).toEqual(["birthday"]);
    // A death offers a "remember", but it ships off — nothing fires unprompted.
    expect(kindDefs.death.defaultReminderSchedule).toEqual([
      { action: "remember", offsetDays: 0, enabledByDefault: false },
    ]);
  });
});

describe("datePrecisionOf", () => {
  it("derives precision from the present parts", () => {
    expect(datePrecisionOf({ year: 1992, month: 3, day: 9 })).toBe("full");
    expect(datePrecisionOf({ year: 1992, month: null, day: null })).toBe(
      "year",
    );
    expect(datePrecisionOf({ year: 1992, month: 3, day: null })).toBe(
      "year-month",
    );
    expect(datePrecisionOf({ year: null, month: 3, day: 9 })).toBe("recurring");
    expect(datePrecisionOf({ year: null, month: 3, day: null })).toBe(
      "year-month",
    );
    expect(datePrecisionOf({ year: null, month: null, day: null })).toBe(
      "none",
    );
  });
});

describe("formatMilestoneDate", () => {
  it("renders each precision with the right parts", () => {
    expect(formatMilestoneDate({ year: 1992, month: 3, day: 9 })).toBe(
      "March 9, 1992",
    );
    expect(formatMilestoneDate({ year: 1992, month: 3, day: null })).toBe(
      "March 1992",
    );
    expect(formatMilestoneDate({ year: 1992, month: null, day: null })).toBe(
      "1992",
    );
    expect(formatMilestoneDate({ year: null, month: 3, day: 9 })).toBe(
      "March 9",
    );
    expect(formatMilestoneDate({ year: null, month: 3, day: null })).toBe(
      "March",
    );
    expect(formatMilestoneDate({ year: null, month: null, day: null })).toBe(
      "",
    );
  });
});

describe("milestoneLabel", () => {
  it("uses the kind label for known kinds", () => {
    expect(milestoneLabel({ kind: "birthday", note: null })).toBe("Birthday");
  });

  it("uses the note for the 'other' kind, falling back to 'Other'", () => {
    expect(milestoneLabel({ kind: "other", note: "Adoption day" })).toBe(
      "Adoption day",
    );
    expect(milestoneLabel({ kind: "other", note: null })).toBe("Other");
  });
});

// Unqualified, "anniversary" means a wedding anniversary, so every other kind
// has to say which anniversary it is.
describe("the word anniversary", () => {
  const copyOf = (kind: keyof typeof kindDefs) => {
    const def = kindDefs[kind];
    return [
      def.label,
      def.greeting,
      def.belatedGreeting,
      def.selfWish?.plain,
      def.selfWish?.belated,
      def.prompt?.occasion,
    ].filter((text): text is string => text !== undefined);
  };

  it("stands alone only for a wedding", () => {
    expect(kindDefs.wedding.label).toBe("Anniversary");
    for (const kind of Object.keys(kindDefs) as (keyof typeof kindDefs)[]) {
      if (kind === "wedding") continue;
      for (const text of copyOf(kind))
        if (/anniversary/i.test(text))
          expect(text).toMatch(/first date anniversary|anniversary of/);
    }
  });
});
