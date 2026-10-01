import { describe, expect, it } from "vitest";
import type { PersonView } from "@leapsake/core";
import { comparePair } from "@leapsake/view-models";
import { personFacts } from "./duplicate-pair";

/** Only the fields `personFacts` reads; the rest of a view is irrelevant. */
function view(
  firstName: string,
  extra: {
    phones?: string[];
    milestones?: { kind: string; origin: "own" | "relationship" }[];
  } = {},
): PersonView {
  return {
    person: { firstName, middleName: null, lastName: "Bailey" },
    gender: { value: null },
    tags: [],
    relationships: [],
    contactMethods: (extra.phones ?? []).map((number) => ({
      kind: "phone",
      method: {
        number,
        normalized: number.replace(/\D/g, ""),
        extension: null,
        smsCapable: true,
      },
    })),
    timeline: (extra.milestones ?? []).map(({ kind, origin }) => ({
      milestone: { kind, note: null, year: 1907, month: 3, day: 9 },
      origin,
    })),
  } as unknown as PersonView;
}

describe("comparing two people for the duplicates review", () => {
  it("counts one phone number written two ways as shared", () => {
    const { shared } = comparePair(
      personFacts(view("George", { phones: ["+1 415 555 2671"] }), "US"),
      personFacts(view("George", { phones: ["(415) 555-2671"] }), "US"),
    );

    expect(shared).toEqual([
      { field: "Name", values: ["George Bailey"] },
      { field: "Phone", values: ["+1 415 555 2671"] },
    ]);
  });

  it("marks a name spelled differently as different", () => {
    const { differing } = comparePair(
      personFacts(view("George"), null),
      personFacts(view("Georgie"), null),
    );

    expect(differing).toEqual([
      { field: "Name", a: ["George Bailey"], b: ["Georgie Bailey"] },
    ]);
  });

  it("compares only each person’s own milestones", () => {
    const { shared, differing } = comparePair(
      personFacts(
        view("George", { milestones: [{ kind: "birthday", origin: "own" }] }),
        null,
      ),
      personFacts(
        view("George", {
          milestones: [{ kind: "anniversary", origin: "relationship" }],
        }),
        null,
      ),
    );

    expect(shared.map((s) => s.field)).toEqual(["Name"]);
    expect(differing).toEqual([
      { field: "Birthday", a: ["March 9, 1907"], b: [] },
    ]);
  });
});
