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

  /** Mary's own card carries the same anniversary George's does. */
  async function bothCardsCarryIt(maryDate: {
    year: number | null;
    month: number;
    day: number;
  }) {
    const { george, milestone } = await georgesAnniversary();
    const mary = await person("Mary", "Hatch");
    await core.milestones.create({
      kind: "wedding",
      bearerType: "person",
      bearerId: mary.id,
      ...maryDate,
    });
    return { george, mary, milestone };
  }

  const marriageOf = async (personId: string) =>
    (await core.relationships.listForEntity("person", personId))[0];

  it("keeps one anniversary when the partner's card carries the same one", async () => {
    const occ = civilDaysFromToday(20);
    const { george, mary, milestone } = await bothCardsCarryIt({
      year: 1946,
      month: occ.month,
      day: occ.day,
    });

    await core.milestones.linkPartner({
      milestoneId: milestone.id,
      personId: george.id,
      partner: { personId: mary.id },
    });

    const marriage = await marriageOf(george.id);
    const [kept, ...others] = await core.milestones.listForBearer(
      "relationship",
      marriage.relationshipId,
    );
    expect(others).toEqual([]);
    // George's, with the year only Mary's card knew.
    expect(kept).toMatchObject({ id: milestone.id, year: 1946 });
    expect(await core.milestones.listForBearer("person", mary.id)).toEqual([]);
    // Nobody is left to ask about it.
    expect(await promptTitles()).toEqual([
      expect.stringContaining("Mary Hatch"),
    ]);
  });

  it("merges into an anniversary the marriage already holds", async () => {
    const occ = civilDaysFromToday(20);
    const { george, mary, milestone } = await bothCardsCarryIt({
      year: null,
      month: occ.month,
      day: occ.day,
    });
    const [marys] = await core.milestones.listForBearer("person", mary.id);
    await core.milestones.linkPartner({
      milestoneId: marys.id,
      personId: mary.id,
      partner: { personId: george.id },
    });

    await core.milestones.linkPartner({
      milestoneId: milestone.id,
      personId: george.id,
      partner: { personId: mary.id },
    });

    const marriage = await marriageOf(george.id);
    expect(
      await core.milestones.listForBearer(
        "relationship",
        marriage.relationshipId,
      ),
    ).toHaveLength(1);
  });

  it("keeps both when the two cards disagree on the day", async () => {
    const occ = civilDaysFromToday(20);
    const other = civilDaysFromToday(21);
    const { george, mary, milestone } = await bothCardsCarryIt({
      year: null,
      month: other.month,
      day: other.day,
    });
    expect(occ.day).not.toBe(other.day);

    await core.milestones.linkPartner({
      milestoneId: milestone.id,
      personId: george.id,
      partner: { personId: mary.id },
    });

    const marriage = await marriageOf(george.id);
    expect(
      await core.milestones.listForBearer(
        "relationship",
        marriage.relationshipId,
      ),
    ).toHaveLength(1);
    expect(await core.milestones.listForBearer("person", mary.id)).toHaveLength(
      1,
    );
  });

  it("records a first date's new name as a partner", async () => {
    const george = await person("George", "Bailey");
    const occ = civilDaysFromToday(20);
    const milestone = await core.milestones.create({
      kind: "first-date",
      bearerType: "person",
      bearerId: george.id,
      month: occ.month,
      day: occ.day,
    });

    await core.milestones.linkPartner({
      milestoneId: milestone.id,
      personId: george.id,
      partner: { name: "Mary Hatch" },
    });

    expect(await marriageOf(george.id)).toMatchObject({
      otherLabel: "Mary Hatch",
      otherRole: "partner",
    });
  });
});

describe("deleting one of a couple", () => {
  /** George and Mary, married, their anniversary on the marriage. */
  async function marriedWithAnniversary(newPartner?: string) {
    const { george, milestone } = await georgesAnniversary();
    const mary =
      newPartner === undefined ? await person("Mary", "Hatch") : undefined;
    await core.milestones.linkPartner({
      milestoneId: milestone.id,
      personId: george.id,
      partner:
        mary === undefined ? { name: newPartner! } : { personId: mary.id },
    });
    const [marriage] = await core.relationships.listForEntity(
      "person",
      george.id,
    );
    return { george, maryId: marriage.otherId, milestone };
  }

  it("leaves the anniversary with the one who remains", async () => {
    const { george, maryId, milestone } = await marriedWithAnniversary();

    await core.people.softDelete(george.id);

    expect(await core.milestones.listForBearer("person", maryId)).toMatchObject(
      [{ id: milestone.id, kind: "wedding" }],
    );
    expect(await promptTitles()).toEqual([
      expect.stringContaining("Mary Hatch"),
    ]);
  });

  it("drops it with a partner who existed only through the marriage", async () => {
    const { george, maryId } = await marriedWithAnniversary("Mary Hatch");

    await core.people.softDelete(george.id);

    expect(await core.milestones.listForBearer("person", maryId)).toEqual([]);
    expect(await promptTitles()).toEqual([]);
  });

  it("drops a milestone the pet left behind cannot hold", async () => {
    const george = await person("George", "Bailey");
    const jimmy = await core.pets.create({ name: "Jimmy", gender: null }, []);
    const rel = await core.relationships.createFromSubject({
      subjectType: "person",
      subjectId: george.id,
      otherType: "pet",
      otherId: jimmy.id,
      otherRole: "pet",
    });
    await core.milestones.create({
      kind: "met",
      bearerType: "relationship",
      bearerId: rel.id,
      month: 4,
      day: 1,
    });

    await core.people.softDelete(george.id);

    expect(await core.milestones.listForBearer("pet", jimmy.id)).toEqual([]);
    expect(await core.milestones.listForBearer("relationship", rel.id)).toEqual(
      [],
    );
  });
});

describe("removing a couple's relationship", () => {
  const schedule = [
    { action: "wish" as const, label: null, offsetDays: 7, enabled: true },
  ];

  async function marriage(partner: { personId: string } | { name: string }) {
    const { george, milestone } = await georgesAnniversary();
    await core.milestones.linkPartner({
      milestoneId: milestone.id,
      personId: george.id,
      partner,
      reminderSchedule: schedule,
    });
    const [rel] = await core.relationships.listForEntity("person", george.id);
    return { george, rel, milestone };
  }

  it("leaves a copy of the anniversary, and its reminders, with each of them", async () => {
    const mary = await person("Mary", "Hatch");
    const { george, rel, milestone } = await marriage({ personId: mary.id });

    await core.relationships.softDelete(rel.relationshipId);

    const [georges] = await core.milestones.listForBearer("person", george.id);
    const [marys] = await core.milestones.listForBearer("person", mary.id);
    for (const copy of [georges, marys]) {
      expect(copy).toMatchObject({ kind: "wedding" });
      expect(copy.id).not.toBe(milestone.id);
      expect(
        await core.milestones.reminderSchedule(copy.id, copy.kind),
      ).toEqual(schedule);
    }
    expect(georges.id).not.toBe(marys.id);
    expect(
      await core.milestones.listForBearer("relationship", rel.relationshipId),
    ).toEqual([]);
  });

  it("leaves no copy with a partner who goes with the relationship", async () => {
    const { george, rel } = await marriage({ name: "Mary Hatch" });

    await core.relationships.softDelete(rel.relationshipId);

    expect(await core.people.get(rel.otherId)).toBeUndefined();
    expect(await core.milestones.listForBearer("person", rel.otherId)).toEqual(
      [],
    );
    expect(
      await core.milestones.listForBearer("person", george.id),
    ).toHaveLength(1);
  });

  it("gives a pet no copy of a kind it cannot hold", async () => {
    const george = await person("George", "Bailey");
    const jimmy = await core.pets.create({ name: "Jimmy", gender: null }, []);
    const rel = await core.relationships.createFromSubject({
      subjectType: "person",
      subjectId: george.id,
      otherType: "pet",
      otherId: jimmy.id,
      otherRole: "pet",
    });
    await core.milestones.create({
      kind: "met",
      bearerType: "relationship",
      bearerId: rel.id,
      month: 4,
      day: 1,
    });

    await core.relationships.softDelete(rel.id);

    expect(await core.milestones.listForBearer("pet", jimmy.id)).toEqual([]);
    expect(
      await core.milestones.listForBearer("person", george.id),
    ).toMatchObject([{ kind: "met" }]);
  });
});
