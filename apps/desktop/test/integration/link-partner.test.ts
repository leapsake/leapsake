import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { type CivilDate, todayCivil } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * `core.milestones.linkPartner`: an anniversary recorded on one person, such as
 * one imported from a contact card, is moved onto their marriage.
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

function civilDaysFromToday(days: number): CivilDate {
  const t = todayCivil();
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

const person = (firstName: string, lastName: string) =>
  core.people.create(
    { firstName, middleName: null, lastName, gender: null },
    [],
  );

/** George's anniversary, on George alone, close enough to be asked about. */
async function georgesAnniversary() {
  const george = await person("George", "Bailey");
  const occ = civilDaysFromToday(20);
  const milestone = await core.milestones.create({
    kind: "wedding",
    bearerType: "person",
    bearerId: george.id,
    month: occ.month,
    day: occ.day,
  });
  return { george, milestone };
}

const promptTitles = async () =>
  (await core.reminders.listInWindow())
    .map((r) => r.title ?? "")
    .filter((t) => t.startsWith("🗓"));

describe("core.milestones.linkPartner", () => {
  it("marries a newly named partner who stays out of People", async () => {
    const { george, milestone } = await georgesAnniversary();
    const [before] = (await core.reminders.targets()).plans;

    await core.milestones.linkPartner({
      milestoneId: milestone.id,
      personId: george.id,
      partner: { name: "Mary Hatch" },
    });

    const [marriage] = await core.relationships.listForEntity(
      "person",
      george.id,
    );
    expect(marriage).toMatchObject({
      otherLabel: "Mary Hatch",
      otherRole: "spouse",
      otherStanding: "unpublished",
    });
    expect(
      await core.milestones.listForBearer(
        "relationship",
        marriage.relationshipId,
      ),
    ).toHaveLength(1);
    expect(await core.milestones.listForBearer("person", george.id)).toEqual(
      [],
    );
    // The same question, now about the couple.
    const [after] = (await core.reminders.targets()).plans;
    expect(after.reminderId).toBe(before.reminderId);
    expect(await promptTitles()).toEqual([
      expect.stringContaining("George Bailey"),
    ]);
    expect((await promptTitles())[0]).toContain("Mary Hatch");
  });

  it("reuses a marriage the two already have", async () => {
    const { george, milestone } = await georgesAnniversary();
    const mary = await person("Mary", "Hatch");
    const rel = await core.relationships.createFromSubject({
      subjectType: "person",
      subjectId: george.id,
      otherType: "person",
      otherId: mary.id,
      otherRole: "wife",
    });

    await core.milestones.linkPartner({
      milestoneId: milestone.id,
      personId: george.id,
      partner: { personId: mary.id },
    });

    expect(await core.relationships.listForEntity("person", george.id)).toEqual(
      [expect.objectContaining({ relationshipId: rel.id })],
    );
    expect(
      await core.milestones.listForBearer("relationship", rel.id),
    ).toHaveLength(1);
  });

  it("marries someone already in People, and stores the answer with it", async () => {
    const { george, milestone } = await georgesAnniversary();
    const mary = await person("Mary", "Hatch");

    await core.milestones.linkPartner({
      milestoneId: milestone.id,
      personId: george.id,
      partner: { personId: mary.id },
      reminderSchedule: [
        { action: "wish", label: null, offsetDays: 0, enabled: true },
      ],
    });

    const [marriage] = await core.relationships.listForEntity(
      "person",
      george.id,
    );
    expect(marriage).toMatchObject({
      otherId: mary.id,
      otherRole: "spouse",
      otherStanding: "published",
    });
    // Answered, so the question retires.
    expect(await promptTitles()).toEqual([]);
  });
});
