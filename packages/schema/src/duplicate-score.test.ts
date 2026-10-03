import { describe, expect, it } from "vitest";
import {
  type DuplicateInput,
  pairsSharingAKey,
  scoreDuplicate,
} from "./duplicate-score.js";

const person = (over: Partial<DuplicateInput> = {}): DuplicateInput => ({
  name: "Jane Wainwright",
  foldedName: "jane wainwright",
  emails: [],
  phones: [],
  handles: [],
  ...over,
});

describe("scoreDuplicate — social handles", () => {
  it("treats a shared handle on one platform as a shared contact", () => {
    const handles = [{ platform: "instagram", handle: "janewainwright" }];
    const { tier, reasons } = scoreDuplicate(
      person({ handles }),
      person({ handles }),
    );
    expect(tier).toBe("high");
    expect(reasons).toContain("Shared instagram handle janewainwright");
  });

  it("does not pair the same handle held on different platforms", () => {
    // "@jane" on Instagram and "@jane" on TikTok are routinely different people,
    // so this must fall back to the name-only signal rather than reading as a
    // shared contact.
    const { tier, reasons } = scoreDuplicate(
      person({ handles: [{ platform: "instagram", handle: "jane" }] }),
      person({ handles: [{ platform: "tiktok", handle: "jane" }] }),
    );
    expect(tier).toBe("medium");
    expect(reasons).toEqual(['Same name "Jane Wainwright"']);
  });

  it("rates a shared handle alone as medium, with no name match", () => {
    const handles = [{ platform: "x", handle: "janewainwright" }];
    const { tier } = scoreDuplicate(
      person({
        name: "Jane Wainwright",
        foldedName: "jane wainwright",
        handles,
      }),
      person({ name: "J. Wainwright", foldedName: "j wainwright", handles }),
    );
    expect(tier).toBe("medium");
  });

  it("reports one reason for a handle listed twice", () => {
    const handles = [
      { platform: "instagram", handle: "janewainwright" },
      { platform: "instagram", handle: "janewainwright" },
    ];
    const { reasons } = scoreDuplicate(
      person({ handles }),
      person({ handles }),
    );
    expect(
      reasons.filter((r) => r.startsWith("Shared instagram")),
    ).toHaveLength(1);
  });
});

describe("scoreDuplicate", () => {
  it("rates a shared contact + equal name as high, with both reasons", () => {
    const a = person({ emails: ["jane@x.com"] });
    const b = person({ emails: ["jane@x.com"] });
    const { tier, reasons } = scoreDuplicate(a, b);
    expect(tier).toBe("high");
    expect(reasons).toContain("Shared email jane@x.com");
    expect(reasons).toContain('Same name "Jane Wainwright"');
  });

  it("rates an equal name with no shared contact as medium", () => {
    const { tier, reasons } = scoreDuplicate(person(), person());
    expect(tier).toBe("medium");
    expect(reasons).toEqual(['Same name "Jane Wainwright"']);
  });

  it("rates a shared contact with different names as medium", () => {
    const a = person({
      name: "William Bailey",
      foldedName: "william bailey",
      phones: ["+15551234567"],
    });
    const b = person({
      name: "Billy Bailey",
      foldedName: "billy bailey",
      phones: ["+15551234567"],
    });
    const { tier, reasons } = scoreDuplicate(a, b);
    expect(tier).toBe("medium");
    expect(reasons).toEqual(["Shared phone +15551234567"]);
  });

  it("rates no shared signal as none", () => {
    const a = person({
      name: "Harry Martini",
      foldedName: "harry martini",
      emails: ["harry@x.com"],
    });
    const b = person({
      name: "Jane Wainwright",
      foldedName: "jane wainwright",
      emails: ["jane@x.com"],
    });
    expect(scoreDuplicate(a, b).tier).toBe("none");
  });

  it("never pairs two people with empty folded names", () => {
    const a = person({ name: "", foldedName: "" });
    const b = person({ name: "", foldedName: "" });
    expect(scoreDuplicate(a, b).tier).toBe("none");
  });

  it("still pairs two nameless people who share a contact", () => {
    const a = person({ name: "", foldedName: "", emails: ["shared@x.com"] });
    const b = person({ name: "", foldedName: "", emails: ["shared@x.com"] });
    expect(scoreDuplicate(a, b).tier).toBe("medium");
  });

  it("reports every shared contact value as a reason", () => {
    const a = person({ emails: ["jane@x.com"], phones: ["+1555"] });
    const b = person({ emails: ["jane@x.com"], phones: ["+1555"] });
    const { reasons } = scoreDuplicate(a, b);
    expect(reasons).toContain("Shared email jane@x.com");
    expect(reasons).toContain("Shared phone +1555");
  });
});

/** A seeded generator, so each randomized fixture is the same every run. */
function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

/** Up to `max` draws from `pool`, repeats allowed. */
function some<T>(random: () => number, pool: readonly T[], max: number): T[] {
  return Array.from(
    { length: Math.floor(random() * (max + 1)) },
    () => pool[Math.floor(random() * pool.length)],
  );
}

function randomPeople(seed: number, count: number): DuplicateInput[] {
  const random = seededRandom(seed);
  const names = ["George Bailey", "Mary Hatch", "Violet Bick", ""];
  return Array.from({ length: count }, () => {
    const name = names[Math.floor(random() * names.length)];
    return person({
      name,
      foldedName: name.toLowerCase(),
      emails: some(random, ["george@example.com", "mary@example.com"], 2),
      phones: some(random, ["+15550100", "+15550101"], 2),
      handles: some(
        random,
        [
          { platform: "instagram", handle: "georgebailey" },
          { platform: "x", handle: "georgebailey" },
        ],
        2,
      ),
    });
  });
}

describe("pairsSharingAKey", () => {
  it("leaves out a pair that shares nothing", () => {
    const people = [
      person(),
      person({ name: "Harry Bailey", foldedName: "harry bailey" }),
      person(),
    ];
    expect(pairsSharingAKey(people)).toEqual([[0, 2]]);
  });

  it("finds every pair the scorer rates, in nested-loop order", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const people = randomPeople(seed, 12);
      const rated = (i: number, j: number) =>
        scoreDuplicate(people[i], people[j]).tier !== "none";

      const everyPair: [number, number][] = [];
      for (let i = 0; i < people.length; i++) {
        for (let j = i + 1; j < people.length; j++) everyPair.push([i, j]);
      }
      expect(pairsSharingAKey(people).filter(([i, j]) => rated(i, j))).toEqual(
        everyPair.filter(([i, j]) => rated(i, j)),
      );
    }
  });
});
