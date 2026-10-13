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
  it("asks how to mark it, offering a note and a visit", async () => {
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
      `🗓 How do you want to mark ${mentionOf(peter)}’s birthday?`,
    );
  });

  it("notes the day itself as the birthday it would have been", async () => {
    const { peter } = await peterWithBirthday(0);
    await recordDeath(peter.id);

    expect(await titles()).toContain(
      `🕯️ It would have been ${mentionOf(peter)}’s birthday`,
    );
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
