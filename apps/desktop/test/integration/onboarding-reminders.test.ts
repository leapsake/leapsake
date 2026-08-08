import { createInMemoryKeyStore } from "@leapsake/crypto";
import {
  type CoreApi,
  type SqliteDriver,
  ONBOARDING_REMINDERS,
  createCore,
  enableSync,
  ensureDeviceMasterKey,
  onboardingRouteOf,
  runMigrations,
} from "@leapsake/core";
import {
  type CivilDate,
  compareReminderDue,
  daysUntil,
  reminderLabel,
  todayCivil,
} from "@leapsake/schema";
import { partitionReminders, reminderActionsOf } from "@leapsake/view-models";
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

/** The `system` reminders currently live, via the normal core read. */
async function systemReminders() {
  return (await core.reminders.list()).filter((r) => r.source === "system");
}

/** The onboarding id for a given route, from the exported convention. */
const idFor = (route: string) =>
  ONBOARDING_REMINDERS.find((r) => r.route === route)!.id;

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

describe("onboarding reminders (end to end through core)", () => {
  it("seeds both nudges on a fresh store", async () => {
    const result = await core.reminders.regenerateSystem();
    expect(result).toEqual({ created: 2, updated: 0, removed: 0 });

    const rows = await systemReminders();
    expect(rows).toHaveLength(2);
    // Both are dateless and map through the exported CTA convention.
    for (const r of rows) {
      expect(r.dueDate).toBeNull();
      expect(onboardingRouteOf(r.id)).not.toBeNull();
    }
    // A fresh store has no entities, so the pick-self nudge (which needs a person
    // to pick from) doesn't apply yet — only sync + add-person do.
    expect(new Set(rows.map((r) => r.id))).toEqual(
      new Set([idFor("connect-sync"), idFor("add-person")]),
    );
    // Home order (through the real driver + list ordering): sync leads so a
    // returning user reconnects before re-adding anyone.
    expect(rows.sort(compareReminderDue).map((r) => r.id)).toEqual([
      idFor("connect-sync"),
      idFor("add-person"),
    ]);
  });

  it("retires 'add your first person' on people.create with no explicit reconcile", async () => {
    await core.reminders.regenerateSystem();
    expect((await systemReminders()).map((r) => r.id)).toContain(
      idFor("add-person"),
    );

    // Creating a person reconciles in the same call (the create-path trigger),
    // so the nudge is gone without an explicit regenerateSystem here.
    await core.people.create(
      {
        firstName: "Ada",
        middleName: null,
        lastName: "Lovelace",
        gender: null,
      },
      [],
    );

    const live = await systemReminders();
    expect(live.map((r) => r.id)).not.toContain(idFor("add-person"));
    // The sync nudge is untouched (sync still unconnected).
    expect(live.map((r) => r.id)).toContain(idFor("connect-sync"));
  });

  it("retires 'add your first person' on pets.create too", async () => {
    await core.reminders.regenerateSystem();

    await core.pets.create({ name: "Milo", gender: null }, []);

    expect((await systemReminders()).map((r) => r.id)).not.toContain(
      idFor("add-person"),
    );
  });

  it("retires 'sync another device' once a relay account is bound", async () => {
    await core.reminders.regenerateSystem();
    expect((await systemReminders()).map((r) => r.id)).toContain(
      idFor("connect-sync"),
    );

    // Bind a relay account: `relayUrl` present ⇒ the sync signal flips connected.
    const keyStore = createInMemoryKeyStore();
    await ensureDeviceMasterKey({ keyStore, driver });
    await enableSync({
      keyStore,
      driver,
      password: "correct horse battery staple",
      username: "ada",
      relayUrl: "https://relay.example",
      platform: "desktop",
    });

    const result = await core.reminders.regenerateSystem();
    // Only the sync nudge retires; the add-person nudge stays (still no entities).
    expect(result.removed).toBe(1);
    const live = await systemReminders();
    expect(live.map((r) => r.id)).not.toContain(idFor("connect-sync"));
    expect(live.map((r) => r.id)).toContain(idFor("add-person"));
  });

  it("never resurrects a dismissed nudge", async () => {
    await core.reminders.regenerateSystem();
    const id = idFor("connect-sync");

    await core.reminders.softDelete(id); // user dismisses it

    const result = await core.reminders.regenerateSystem();
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(await core.reminders.get(id)).toBeUndefined(); // still tombstoned
    expect((await systemReminders()).map((r) => r.id)).not.toContain(id);
  });

  it("snoozes a nudge with the date its own offered action carried", async () => {
    // The seam the clients will use, end to end and without re-deriving policy:
    // the action list hands over an `until`, that exact value goes to the one
    // write method, and the row disappears from the open list until it passes.
    await core.reminders.regenerateSystem();
    const id = idFor("connect-sync");
    const before = (await systemReminders()).find((r) => r.id === id)!;

    const offered = reminderActionsOf(before);
    const snooze = offered.find((a) => a.kind === "snooze")!;
    expect(snooze).toBeDefined();

    await core.reminders.snooze(id, snooze.until);

    const after = (await systemReminders()).find((r) => r.id === id)!;
    expect(after.snoozedUntil).toBe(snooze.until);
    expect(after.snoozeCount).toBe(1);

    // Hidden now, back once the clock passes — a deferral, never a delete.
    expect(
      partitionReminders(await systemReminders()).open.map((r) => r.id),
    ).not.toContain(id);
    expect(
      partitionReminders(await systemReminders(), snooze.until + 1).open.map(
        (r) => r.id,
      ),
    ).toContain(id);
  });

  it("offers 'don't ask again' only after the nudge has been put off once", async () => {
    await core.reminders.regenerateSystem();
    const id = idFor("connect-sync");
    const nudge = async () =>
      (await systemReminders()).find((r) => r.id === id)!;

    // First encounter is a binary choice: do it, or not now.
    expect(reminderActionsOf(await nudge()).map((a) => a.kind)).toEqual([
      "cta",
      "snooze",
    ]);

    await core.reminders.snooze(id, Date.now() + 86_400_000);

    // Having declined once, the user now knows what they'd be ending.
    expect(reminderActionsOf(await nudge()).map((a) => a.kind)).toContain(
      "dismiss",
    );
  });

  it("stops offering snooze once the step has spent its repetitions", async () => {
    // connect-sync gets two repetitions, so the second "not now" exhausts it:
    // the budget really is spent by the write, not merely displayed as spent.
    await core.reminders.regenerateSystem();
    const id = idFor("connect-sync");

    await core.reminders.snooze(id, Date.now() + 86_400_000);
    await core.reminders.snooze(id, Date.now() + 86_400_000);
    const spent = (await systemReminders()).find((r) => r.id === id)!;

    const kinds = reminderActionsOf(spent).map((a) => a.kind);
    expect(kinds).not.toContain("snooze");
    // But it stays endable — dismiss outlives snooze.
    expect(kinds).toContain("dismiss");
  });

  it("coexists with a birthday reminder in one reconcile (neither family prunes the other)", async () => {
    // A person with an upcoming birthday: their birthday reminder joins the same
    // desired set as the onboarding nudges. Creating the person retires the
    // add-person nudge, so we expect the sync nudge + the birthday reminder.
    const alice = await core.people.create(
      { firstName: "Alice", middleName: null, lastName: "Ng", gender: null },
      [],
    );
    const soon = civilDaysFromToday(10);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: alice.id,
      month: soon.month,
      day: soon.day,
    });

    const rows = await systemReminders();
    const byKind = {
      sync: rows.filter((r) => r.id === idFor("connect-sync")),
      addPerson: rows.filter((r) => r.id === idFor("add-person")),
      birthday: rows.filter((r) => onboardingRouteOf(r.id) === null),
    };
    // The add-person nudge is retired (Alice exists); the sync nudge remains; the
    // birthday reminder is present and dated — all three coexist, none pruned.
    expect(byKind.addPerson).toHaveLength(0);
    expect(byKind.sync).toHaveLength(1);
    expect(byKind.birthday).toHaveLength(1);
    expect(reminderLabel(byKind.birthday[0])).toBe(
      "🎉 Wish @Alice Ng a happy birthday",
    );
    expect(
      daysUntil(todayCivil(), soon) >= 0 && byKind.birthday[0].dueDate !== null,
    ).toBe(true);
  });
});
