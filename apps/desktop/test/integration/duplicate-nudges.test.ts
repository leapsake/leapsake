import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The duplicates surfaces, end to end through the real core: the scoped/count
 * readers each client gates its links on, and the Home nudge the engine mints
 * for outstanding pairs.
 *
 * The point of the increment these cover: nothing about duplicates is shown
 * unconditionally any more, so every one of these reads must be honest about an
 * empty candidate set as well as a full one.
 */
let driver: SqliteDriver;
let cleanup: () => void;
let core: CoreApi;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  core = createCore(driver);
});

afterEach(() => {
  cleanup();
});

/** Create a person with just a name — enough for the folded-name scorer. */
function addPerson(firstName: string, lastName: string) {
  return core.people.create({ firstName, lastName }, []);
}

/** The `system` reminders currently live, via the normal core read. */
async function systemReminders() {
  return (await core.reminders.list()).filter((r) => r.source === "system");
}

describe("duplicate detection readers", () => {
  it("reports nothing on an empty store", async () => {
    expect(await core.duplicates.count()).toBe(0);
    expect(await core.duplicates.nudgeId()).toBeNull();
    expect(await core.duplicates.findCandidates()).toEqual([]);
  });

  it("reports nothing for people who look nothing alike", async () => {
    await addPerson("Jane", "Wainwright");
    await addPerson("Henry", "Potter");
    expect(await core.duplicates.count()).toBe(0);
    expect(await core.duplicates.nudgeId()).toBeNull();
  });

  it("counts a pair once, not once per person", async () => {
    await addPerson("Jane", "Wainwright");
    await addPerson("Jane", "Wainwright");
    expect(await core.duplicates.count()).toBe(1);
  });

  it("scopes findFor to the pairs one person is half of", async () => {
    const jane = await addPerson("Jane", "Wainwright");
    const twin = await addPerson("Jane", "Wainwright");
    const other = await addPerson("Henry", "Potter");

    const forJane = await core.duplicates.findFor(jane.id);
    expect(forJane).toHaveLength(1);
    // Both halves of the pair see it — that's what puts the banner on each of
    // their pages.
    expect(await core.duplicates.findFor(twin.id)).toHaveLength(1);
    expect(await core.duplicates.findFor(other.id)).toEqual([]);
    expect([forJane[0].a.id, forJane[0].b.id].sort()).toEqual(
      [jane.id, twin.id].sort(),
    );
  });

  it("drops a pair from every reader once it is marked not-the-same", async () => {
    const jane = await addPerson("Jane", "Wainwright");
    const twin = await addPerson("Jane", "Wainwright");
    await core.duplicates.reject(jane.id, twin.id);

    expect(await core.duplicates.count()).toBe(0);
    expect(await core.duplicates.findFor(jane.id)).toEqual([]);
    expect(await core.duplicates.nudgeId()).toBeNull();
  });

  it("drops a pair from every reader once it is merged", async () => {
    const jane = await addPerson("Jane", "Wainwright");
    const twin = await addPerson("Jane", "Wainwright");
    await core.people.merge(jane.id, twin.id);

    expect(await core.duplicates.count()).toBe(0);
    expect(await core.duplicates.findFor(jane.id)).toEqual([]);
  });
});

/** A seeded generator, so the randomized fixture is the same every run. */
function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe("findFor against the full scan", () => {
  it("returns exactly the full scan's pairs for each person", async () => {
    const random = seededRandom(1946);
    const pick = <T>(list: readonly T[]) =>
      list[Math.floor(random() * list.length)];
    const names = [
      ["George", "Bailey"],
      ["Mary", "Hatch"],
      ["Clarence", "Odbody"],
      ["Violet", "Bick"],
    ] as const;
    const emails = ["george@example.com", "mary@example.com"];

    const ids: string[] = [];
    for (let i = 0; i < 14; i++) {
      const [firstName, lastName] = pick(names);
      const { id } = await addPerson(firstName, lastName);
      ids.push(id);
      if (random() < 0.3) {
        await core.contactMethods.emails.create({
          ownerType: "person",
          ownerId: id,
          label: "home",
          address: pick(emails),
        });
      }
    }
    const before = await core.duplicates.findCandidates();
    for (const { a, b } of before.slice(0, 3)) {
      await core.duplicates.reject(b.id, a.id);
    }
    const deleted = ids.pop()!;
    await core.people.softDelete(deleted);

    const scan = await core.duplicates.findCandidates();
    const halves = new Set(scan.flatMap((c) => [`a:${c.a.id}`, `b:${c.b.id}`]));
    expect(
      ids.some((id) => halves.has(`a:${id}`) && halves.has(`b:${id}`)),
    ).toBe(true);
    expect(scan.length).toBeLessThan(before.length);

    for (const id of [...ids, deleted, "no-such-person"]) {
      expect(await core.duplicates.findFor(id)).toEqual(
        scan.filter((c) => c.a.id === id || c.b.id === id),
      );
    }
    expect(await core.duplicates.findFor(deleted)).toEqual([]);
  });
});

describe("the duplicates Home nudge", () => {
  it("appears when a duplicate is created, under the id clients match on", async () => {
    await addPerson("Jane", "Wainwright");
    await addPerson("Jane", "Wainwright");

    // `people.create` reconciles, so the nudge is already there — no boot or
    // focus needed for the pair the user just made.
    const nudgeId = await core.duplicates.nudgeId();
    expect(nudgeId).not.toBeNull();
    const nudge = (await systemReminders()).find((r) => r.id === nudgeId);
    expect(nudge).toBeDefined();
    expect(nudge?.dueDate).toBeNull();
    expect(nudge?.title).toBe("🔗 Two people might be the same — review");
  });

  it("retires when the pair is merged", async () => {
    const jane = await addPerson("Jane", "Wainwright");
    const twin = await addPerson("Jane", "Wainwright");
    const nudgeId = await core.duplicates.nudgeId();

    await core.people.merge(jane.id, twin.id);

    expect(await core.duplicates.nudgeId()).toBeNull();
    expect((await systemReminders()).map((r) => r.id)).not.toContain(nudgeId);
  });

  it("retires when the pair is marked not-the-same", async () => {
    const jane = await addPerson("Jane", "Wainwright");
    const twin = await addPerson("Jane", "Wainwright");
    const nudgeId = await core.duplicates.nudgeId();

    await core.duplicates.reject(jane.id, twin.id);

    expect(await core.duplicates.nudgeId()).toBeNull();
    expect((await systemReminders()).map((r) => r.id)).not.toContain(nudgeId);
  });

  it("follows a rename that creates a duplicate, and one that dissolves it", async () => {
    await addPerson("Jane", "Wainwright");
    const other = await addPerson("Henry", "Potter");
    expect(await core.duplicates.nudgeId()).toBeNull();

    // A rename can create a pair — `people.update` reconciles for exactly this.
    await core.people.update(
      other.id,
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const nudgeId = await core.duplicates.nudgeId();
    expect(nudgeId).not.toBeNull();
    expect((await systemReminders()).map((r) => r.id)).toContain(nudgeId);

    // …and renaming back dissolves it again.
    await core.people.update(
      other.id,
      { firstName: "Henry", lastName: "Potter" },
      [],
    );
    expect(await core.duplicates.nudgeId()).toBeNull();
    expect((await systemReminders()).map((r) => r.id)).not.toContain(nudgeId);
  });
});
