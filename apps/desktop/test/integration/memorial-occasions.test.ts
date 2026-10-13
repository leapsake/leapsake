import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  onboardingRouteOf,
  runMigrations,
} from "@leapsake/core";
import {
  type CivilDate,
  actionDefs,
  mentionToken,
  promptOffsetDays,
  todayCivil,
} from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

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

async function titles(): Promise<string[]> {
  return (await core.reminders.list())
    .filter((r) => r.source === "system" && onboardingRouteOf(r.id) === null)
    .map((r) => r.title ?? "");
}

const mentionOf = (person: { id: string }) =>
  mentionToken("Peter Bailey", "person", person.id);

/** Peter Bailey, with a birthday `days` out. */
async function peterWithBirthday(days: number) {
  const peter = await core.people.create(
    { firstName: "Peter", lastName: "Bailey" },
    [],
  );
  const occ = civilDaysFromToday(days);
  const birthday = await core.milestones.create({
    kind: "birthday",
    bearerType: "person",
    bearerId: peter.id,
    month: occ.month,
    day: occ.day,
  });
  return { peter, birthday };
}

/** Records that someone has died, date unknown. */
const recordDeath = (personId: string) =>
  core.milestones.create({
    kind: "death",
    bearerType: "person",
    bearerId: personId,
    year: null,
    month: null,
    day: null,
  });

describe("a birthday kept in memory", () => {
  it("asks how to remember it, offering a note and a visit", async () => {
    const { peter, birthday } = await peterWithBirthday(
      promptOffsetDays("birthday", "memorial") + actionDefs.plan.activeDays,
    );
    await recordDeath(peter.id);

    const plan = (await core.reminders.targets()).plans.find(
      (p) => p.milestoneId === birthday.id,
    );
    expect(plan?.memorial).toBe(true);
    expect(plan?.offers.map((o) => o.action)).toEqual([
      "visit:resting-place",
      "remember",
    ]);
    expect(await titles()).toContain(
      `🗓 How do you want to remember ${mentionOf(peter)}’s birthday?`,
    );
  });

  it("notes the day itself as the birthday it would have been", async () => {
    const { peter } = await peterWithBirthday(0);
    await recordDeath(peter.id);

    expect(await titles()).toContain(
      `🕯️ It would have been ${mentionOf(peter)}’s birthday`,
    );
    // Its own family, so it notifies once and quietly.
    const note = (await core.reminders.listInWindow()).find((r) =>
      r.title?.startsWith("🕯️"),
    );
    expect(note?.category).toBe("remembrance");
  });

  it("drops what was chosen for them before, without asking", async () => {
    const { peter, birthday } = await peterWithBirthday(10);
    await core.milestones.update(birthday.id, {
      reminderSchedule: [
        { action: "get:gift", label: null, offsetDays: 10, enabled: true },
      ],
    });
    expect(await titles()).toContain(
      "🎁 Get @[Peter Bailey](person:" + peter.id + ") a gift",
    );

    await recordDeath(peter.id);

    expect(await titles()).not.toContain(
      "🎁 Get @[Peter Bailey](person:" + peter.id + ") a gift",
    );
    expect(
      (await core.milestones.reminderSchedule(birthday.id, "birthday")).map(
        (r) => r.action,
      ),
    ).toEqual(["visit:resting-place", "remember"]);
  });

  it("reaches only the partner still living on a couple's anniversary", async () => {
    const peter = await core.people.create(
      { firstName: "Peter", lastName: "Bailey" },
      [],
    );
    const ma = await core.people.create(
      { firstName: "Ma", lastName: "Bailey" },
      [],
    );
    const marriage = await core.relationships.create({
      aType: "person",
      aId: peter.id,
      aRole: "spouse",
      bType: "person",
      bId: ma.id,
      bRole: "spouse",
    });
    const occ = civilDaysFromToday(0);
    await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: marriage.id,
      month: occ.month,
      day: occ.day,
      reminderSchedule: [
        { action: "wish", label: null, offsetDays: 0, enabled: true },
      ],
    });
    for (const person of [peter, ma])
      await core.contactMethods.phones.create({
        ownerType: "person",
        ownerId: person.id,
        label: "Mobile",
        number: "+15550101",
      });
    await recordDeath(peter.id);

    expect(
      (await core.reminders.targets()).contacts.map((c) => c.personId),
    ).toEqual([ma.id]);
  });
});

/** Someone new, by first and last name. */
const person = (firstName: string, lastName = "Bailey") =>
  core.people.create({ firstName, lastName }, []);

/** `a` holds `aRole` to `b`, and `b` holds `bRole` to `a`. */
const relate = (
  a: { id: string },
  aRole: "parent" | "child" | "sibling" | "spouse",
  b: { id: string },
  bRole: "parent" | "child" | "sibling" | "spouse",
) =>
  core.relationships.create({
    aType: "person",
    aId: a.id,
    aRole,
    bType: "person",
    bId: b.id,
    bRole,
  });

/** Peter Bailey's family: his wife, two sons, and his brother. */
async function baileys() {
  const peter = await person("Peter");
  const ma = await person("Ma");
  const george = await person("George");
  const harry = await person("Harry");
  const billy = await person("Billy");
  const marriage = await relate(peter, "spouse", ma, "spouse");
  await relate(billy, "sibling", peter, "sibling");
  await relate(peter, "parent", george, "child");
  await relate(peter, "parent", harry, "child");
  return { peter, ma, george, harry, billy, marriage };
}

/** Days out at which a memorial occasion's question is on display. */
const asked = (kind: "birthday" | "death" | "wedding") =>
  promptOffsetDays(kind, "memorial") + actionDefs.plan.activeDays;

/** The plan offered about `milestoneId`, as the answering screen reads it. */
const planFor = async (milestoneId: string) =>
  (await core.reminders.targets()).plans.find(
    (p) => p.milestoneId === milestoneId,
  );

describe("reaching out to the people they were close to", () => {
  it("offers their partner, then their children, at most three", async () => {
    const { peter, ma, george, harry } = await baileys();
    const occ = civilDaysFromToday(asked("birthday"));
    const birthday = await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: peter.id,
      month: occ.month,
      day: occ.day,
    });
    await recordDeath(peter.id);

    const plan = await planFor(birthday.id);
    expect(plan?.offers.map((o) => o.action)).toEqual([
      "visit:resting-place",
      "remember",
      `reach:${ma.id}`,
      `reach:${george.id}`,
      `reach:${harry.id}`,
    ]);
    expect(plan?.recipients[ma.id]).toBe("Ma Bailey");
  });

  it("never offers you, nor anyone else who has died", async () => {
    const { peter, ma, george, harry, billy } = await baileys();
    await core.self.set(george.id);
    await recordDeath(ma.id);
    const occ = civilDaysFromToday(asked("birthday"));
    const birthday = await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: peter.id,
      month: occ.month,
      day: occ.day,
    });
    await recordDeath(peter.id);

    expect(
      (await planFor(birthday.id))?.offers
        .filter((o) => o.action.startsWith("reach:"))
        .map((o) => o.action),
    ).toEqual([`reach:${harry.id}`, `reach:${billy.id}`]);
  });

  it("asks how to remember the day they died", async () => {
    const { peter, ma } = await baileys();
    const occ = civilDaysFromToday(asked("death"));
    const death = await core.milestones.create({
      kind: "death",
      bearerType: "person",
      bearerId: peter.id,
      year: 2019,
      month: occ.month,
      day: occ.day,
    });

    expect(await titles()).toContain(
      `🗓 How do you want to remember ${mentionOf(peter)}’s passing?`,
    );
    expect((await planFor(death.id))?.offers.map((o) => o.action)).toContain(
      `reach:${ma.id}`,
    );
  });

  it("reminds you to reach them, with their ways to be reached", async () => {
    const { peter, ma } = await baileys();
    await core.contactMethods.phones.create({
      ownerType: "person",
      ownerId: ma.id,
      label: "Mobile",
      number: "+15550101",
    });
    const occ = civilDaysFromToday(0);
    const death = await core.milestones.create({
      kind: "death",
      bearerType: "person",
      bearerId: peter.id,
      year: 2019,
      month: occ.month,
      day: occ.day,
    });
    await core.milestones.answerPlan(death.id, {
      year: occ.year,
      rules: [
        {
          action: `reach:${ma.id}`,
          label: null,
          offsetDays: 0,
          enabled: true,
        },
      ],
    });

    const maMention = mentionToken("Ma Bailey", "person", ma.id);
    expect(await titles()).toEqual([`💬 Reach out to ${maMention}`]);
    expect(
      (await core.reminders.targets()).contacts.map((c) => c.personId),
    ).toEqual([ma.id]);
  });

  it("remembers a couple's anniversary, reaching the one still living first", async () => {
    const { peter, ma, george, harry, marriage } = await baileys();
    await recordDeath(peter.id);
    const occ = civilDaysFromToday(asked("wedding"));
    const wedding = await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: marriage.id,
      month: occ.month,
      day: occ.day,
    });

    const plan = await planFor(wedding.id);
    expect(plan?.memorial).toBe(true);
    expect(plan?.offers.map((o) => o.action)).toEqual([
      "remember",
      `reach:${ma.id}`,
      `reach:${george.id}`,
      `reach:${harry.id}`,
    ]);
  });

  it("remembers your own anniversary with a partner who has died", async () => {
    const george = await person("George");
    const mary = await person("Mary", "Hatch");
    await core.self.set(george.id);
    const marriage = await relate(george, "spouse", mary, "spouse");
    await recordDeath(mary.id);
    const occ = civilDaysFromToday(0);
    await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: marriage.id,
      month: occ.month,
      day: occ.day,
    });

    expect(await titles()).toContain(
      "🕯️ It would have been your anniversary with Mary Hatch",
    );
  });
});
