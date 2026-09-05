import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import {
  type CivilDate,
  actionDefs,
  promptOffsetDays,
  todayCivil,
} from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The composition root's half of two things the engine can only be told about:
 * what a **relationship** is called, and whether a milestone is about a romantic
 * partnership the user is in.
 *
 * `packages/reminders/test/relationship-bearers.test.ts` pins the engine's
 * behaviour given those answers. These pin the answers themselves, against real
 * repositories — which is where the original bug lived: the port said `null` for
 * a relationship bearer, the engine reads `null` as "the bearer is gone", and a
 * wedding anniversary linked to its relationship generated nothing at all.
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

/** The civil date `days` after today, normalised across month/year boundaries. */
function civilDaysFromToday(days: number): CivilDate {
  const t = todayCivil();
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** Every live `system` reminder's title. */
async function titles(): Promise<string[]> {
  const rows = await core.reminders.list();
  return rows.filter((r) => r.source === "system").map((r) => r.title ?? "");
}

/** Me, and someone else, with `me` recorded as the self-person. */
async function twoPeople() {
  const me = await core.people.create({ firstName: "Robin" }, []);
  const partner = await core.people.create({ firstName: "Alice" }, []);
  await core.self.set(me.id);
  return { me, partner };
}

/**
 * A first date 30 days out — inside that kind's prompt window, which opens at
 * `promptOffsetDays("first-date") + actionDefs.plan.activeDays` = 35 days.
 * Derived rather than written down, so moving an offset moves this with it.
 */
const FIRST_DATE_SOON = civilDaysFromToday(
  promptOffsetDays("first-date") + actionDefs.plan.activeDays - 5,
);

describe("a milestone borne by a relationship", () => {
  it("is reminded about, and names the relationship's other end when it is yours", async () => {
    const { me, partner } = await twoPeople();
    const rel = await core.relationships.create({
      aType: "person",
      aId: me.id,
      aRole: "spouse",
      bType: "person",
      bId: partner.id,
      bRole: "spouse",
    });
    await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: rel.id,
      year: 2015,
      month: civilDaysFromToday(45).month,
      day: civilDaysFromToday(45).day,
    });

    // The regression: before the label port could name a relationship this was
    // an empty list, silently.
    expect(await titles()).toContain(
      "🗓 How do you want to mark your own wedding anniversary?",
    );
  });

  it("names both ends when the relationship is somebody else's", async () => {
    await twoPeople();
    const bob = await core.people.create({ firstName: "Bob" }, []);
    const carol = await core.people.create({ firstName: "Carol" }, []);
    const rel = await core.relationships.create({
      aType: "person",
      aId: bob.id,
      aRole: "spouse",
      bType: "person",
      bId: carol.id,
      bRole: "spouse",
    });
    await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: rel.id,
      year: 2015,
      month: civilDaysFromToday(45).month,
      day: civilDaysFromToday(45).day,
    });

    expect(await titles()).toContain(
      "🗓 How do you want to mark Bob & Carol's wedding anniversary?",
    );
  });
});

describe("the first-date prompt, gated on the partnership being yours", () => {
  /** A first date recorded on `bearerId`, the common shape: borne by the person. */
  const recordFirstDate = (bearerId: string) =>
    core.milestones.create({
      kind: "first-date",
      bearerType: "person",
      bearerId,
      year: null,
      month: FIRST_DATE_SOON.month,
      day: FIRST_DATE_SOON.day,
    });

  it("asks when a romantic edge joins them to you", async () => {
    const { me, partner } = await twoPeople();
    await core.relationships.create({
      aType: "person",
      aId: me.id,
      aRole: "partner",
      bType: "person",
      bId: partner.id,
      bRole: "partner",
    });
    await recordFirstDate(partner.id);

    expect((await titles()).some((t) => t.includes("first date"))).toBe(true);
  });

  // `spouse` and its gendered variants reach it through `baseRole`, which is the
  // whole reason the predicate is a helper rather than an equality check.
  it("counts a marriage, however the role was phrased", async () => {
    const { me, partner } = await twoPeople();
    await core.relationships.create({
      aType: "person",
      aId: me.id,
      aRole: "husband",
      bType: "person",
      bId: partner.id,
      bRole: "wife",
    });
    await recordFirstDate(partner.id);

    expect((await titles()).some((t) => t.includes("first date"))).toBe(true);
  });

  it("stays quiet about a first date between two other people", async () => {
    await twoPeople();
    const bob = await core.people.create({ firstName: "Bob" }, []);
    await recordFirstDate(bob.id);

    expect((await titles()).some((t) => t.includes("first date"))).toBe(false);
  });

  // ⚠️ The known cost of the gate, recorded rather than lamented: it reads data
  // the user may not have entered. A friendship is not a partnership, so this is
  // correct — but the same silence falls on a real partner whose role nobody set.
  it("stays quiet when the edge exists but is not a romantic one", async () => {
    const { me, partner } = await twoPeople();
    await core.relationships.create({
      aType: "person",
      aId: me.id,
      aRole: "friend",
      bType: "person",
      bId: partner.id,
      bRole: "friend",
    });
    await recordFirstDate(partner.id);

    expect((await titles()).some((t) => t.includes("first date"))).toBe(false);
  });

  it("stays quiet when nobody has said who they are", async () => {
    const partner = await core.people.create({ firstName: "Alice" }, []);
    await recordFirstDate(partner.id);

    expect((await titles()).some((t) => t.includes("first date"))).toBe(false);
  });
});
