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
 * The `🎉 wish` half of `core.reminders.targets` — the read behind both halves
 * of the acknowledgment: the ways to reach someone, and the offer to collect one
 * when there are none.
 *
 * The reasoning it enforces is the 2026-09-05 decision that a **channel is an
 * affordance, not an errand**: there is no "call Violet" reminder to schedule any
 * more, so the one `wish` row has to carry the ways to act on it.
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

/** Someone whose birthday is today, so the day-of wish is a live row. */
async function personWithBirthdayToday(firstName: string) {
  const person = await core.people.create(
    { firstName, middleName: null, lastName: "Bick", gender: null },
    [],
  );
  const occ = civilDaysFromToday(0);
  await core.milestones.create({
    kind: "birthday",
    bearerType: "person",
    bearerId: person.id,
    month: occ.month,
    day: occ.day,
    reminderSchedule: [
      { action: "wish", label: null, offsetDays: 0, enabled: true },
    ],
  });
  return person;
}

describe("core.reminders.targets — the wish half", () => {
  it("carries the ways to reach the person the wish is about", async () => {
    const violet = await personWithBirthdayToday("Violet");
    await core.contactMethods.phones.create({
      ownerType: "person",
      ownerId: violet.id,
      label: "Mobile",
      number: "+15550101",
    });

    const [target] = (await core.reminders.targets()).contacts;
    expect(target).toMatchObject({
      personId: violet.id,
      subject: "Violet Bick",
    });
    expect(target.methods.map((m) => m.kind)).toEqual(["phone"]);

    // It is the wish row, not some other reminder of the same person's.
    const reminder = await core.reminders.get(target.reminderId);
    expect(reminder?.title).toContain("a happy birthday");
  });

  // ⚠️ A mailing address is a contact method and is *not* a way to say happy
  // birthday on the day. Posting something has its own reminder on its own
  // clock, a week or more earlier, so an address offered here would be an
  // affordance for an errand whose deadline has already gone.
  it("leaves the postal address out", async () => {
    const violet = await personWithBirthdayToday("Violet");
    await core.contactMethods.postals.create({
      ownerType: "person",
      ownerId: violet.id,
      label: "Home",
      line1: "1 Example Street",
    });
    await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: violet.id,
      label: "Home",
      address: "violet@example.com",
    });

    const [target] = (await core.reminders.targets()).contacts;
    expect(target.methods.map((m) => m.kind)).toEqual(["email"]);
  });

  // The collect case: an empty list is what the view-model turns into "add a way
  // to reach them", so the target has to be present and empty rather than absent.
  it("still names a person with no contact methods at all", async () => {
    const violet = await personWithBirthdayToday("Violet");

    const [target] = (await core.reminders.targets()).contacts;
    expect(target).toMatchObject({ personId: violet.id });
    expect(target.methods).toEqual([]);
  });

  /** George and Mary's wedding anniversary today, stored on their marriage. */
  async function coupleWithAnniversaryToday() {
    const person = (firstName: string, lastName: string) =>
      core.people.create(
        { firstName, middleName: null, lastName, gender: null },
        [],
      );
    const george = await person("George", "Bailey");
    const mary = await person("Mary", "Hatch");
    const marriage = await core.relationships.createFromSubject({
      subjectType: "person",
      subjectId: george.id,
      otherType: "person",
      otherId: mary.id,
      otherRole: "spouse",
    });
    const occ = civilDaysFromToday(0);
    await core.milestones.create({
      kind: "anniversary",
      bearerType: "relationship",
      bearerId: marriage.id,
      month: occ.month,
      day: occ.day,
      reminderSchedule: [
        { action: "wish", label: null, offsetDays: 0, enabled: true },
      ],
    });
    return { george, mary };
  }

  // A couple's anniversary is wished to both of them, so each partner brings
  // their own ways to reach them, under their own name.
  it("names both partners of a couple's anniversary", async () => {
    const { george, mary } = await coupleWithAnniversaryToday();
    await core.contactMethods.phones.create({
      ownerType: "person",
      ownerId: mary.id,
      label: "Mobile",
      number: "+15550102",
    });

    const contacts = (await core.reminders.targets()).contacts;
    expect(contacts.map((t) => [t.subject, t.methods.length])).toEqual([
      ["George Bailey", 0],
      ["Mary Hatch", 1],
    ]);
    expect(new Set(contacts.map((t) => t.reminderId)).size).toBe(1);
    expect(contacts.map((t) => t.personId)).toEqual([george.id, mary.id]);
  });

  // Your own anniversary is wished to your partner, never to yourself.
  it("leaves you out of your own anniversary", async () => {
    const { george, mary } = await coupleWithAnniversaryToday();
    await core.self.set(george.id);

    const contacts = (await core.reminders.targets()).contacts;
    expect(contacts.map((t) => t.personId)).toEqual([mary.id]);
  });

  // ⚠️ `contactOwnerTypeSchema` is person/household: a pet cannot own a contact
  // method, so asking the user to add one for Jimmy would be asking for something
  // the app has nowhere to put.
  it("says nothing about a pet's birthday", async () => {
    const jimmy = await core.pets.create({ name: "Jimmy" }, []);
    const occ = civilDaysFromToday(0);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "pet",
      bearerId: jimmy.id,
      month: occ.month,
      day: occ.day,
      reminderSchedule: [
        { action: "wish", label: null, offsetDays: 0, enabled: true },
      ],
    });

    expect((await core.reminders.targets()).contacts).toEqual([]);
  });

  // `wish` is the acknowledgment — the one action whose whole content is *reach
  // them somehow*. A gift is an errand you run in a shop, and buttons to text
  // someone would be noise on it.
  it("says nothing about an errand that is not an acknowledgment", async () => {
    const person = await core.people.create(
      { firstName: "Violet", middleName: null, lastName: "Bick", gender: null },
      [],
    );
    const occ = civilDaysFromToday(0);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: person.id,
      month: occ.month,
      day: occ.day,
      reminderSchedule: [
        { action: "get:gift", label: null, offsetDays: 0, enabled: true },
      ],
    });

    const targets = await core.reminders.targets();
    expect(targets.gifts).toHaveLength(1);
    expect(targets.contacts).toEqual([]);
  });
});
