import { createInMemoryKeyStore } from "@leapsake/crypto";
import {
  type CoreApi,
  type SqliteDriver,
  ONBOARDING_REMINDERS,
  createCore,
  createLocalAccount,
  enableSync,
  ensureDeviceMasterKey,
  getSyncStatus,
  onboardingRouteOf,
  runMigrations,
} from "@leapsake/core";
import { resetFlagOverrides, setLocalFlagOverrides } from "@leapsake/flags";
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
  // This suite covers the sign-in nudge end to end, and that nudge is gated
  // behind `multiDevice` — off in what v0.1 ships. The gate's own behaviour is
  // covered in `packages/reminders/test/onboarding.test.ts`.
  setLocalFlagOverrides({ multiDevice: true });
});

afterEach(() => {
  cleanup();
  resetFlagOverrides();
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
  it("seeds the day-one nudges on a fresh store", async () => {
    const result = await core.reminders.regenerateSystem();
    expect(result).toEqual({ created: 3, updated: 0, removed: 0 });

    const rows = await systemReminders();
    expect(rows).toHaveLength(3);
    // All are dateless and map through the exported CTA convention.
    for (const r of rows) {
      expect(r.dueDate).toBeNull();
      expect(onboardingRouteOf(r.id)).not.toBeNull();
    }
    // A fresh store holds nobody, so the account invitation (which waits for data
    // worth protecting) and the notifications step (which waits for something to
    // be notified about) stay away; the three answerable on day one do not.
    expect(new Set(rows.map((r) => r.id))).toEqual(
      new Set([idFor("connect-sync"), idFor("import"), idFor("about-you")]),
    );
    // Home order (through the real driver + list ordering): sign-in leads so a
    // returning user gets back into their account before re-adding anyone.
    expect(rows.sort(compareReminderDue).map((r) => r.id)).toEqual([
      idFor("connect-sync"),
      idFor("import"),
      idFor("about-you"),
    ]);
  });

  it("retires 'import your contacts' on people.create with no explicit reconcile", async () => {
    await core.reminders.regenerateSystem();
    expect((await systemReminders()).map((r) => r.id)).toContain(
      idFor("import"),
    );

    // Creating a person reconciles in the same call (the create-path trigger),
    // so the nudge is gone without an explicit regenerateSystem here.
    await core.people.create(
      {
        firstName: "Mary",
        middleName: null,
        lastName: "Bailey",
        gender: null,
      },
      [],
    );

    const live = await systemReminders();
    expect(live.map((r) => r.id)).not.toContain(idFor("import"));
    // The sync nudge is untouched (sync still unconnected).
    expect(live.map((r) => r.id)).toContain(idFor("connect-sync"));
  });

  it("retires 'import your contacts' on pets.create too", async () => {
    await core.reminders.regenerateSystem();

    await core.pets.create({ name: "Milo", gender: null }, []);

    expect((await systemReminders()).map((r) => r.id)).not.toContain(
      idFor("import"),
    );
  });

  it("retires the sign-in nudge once a relay account is bound", async () => {
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
      username: "mary",
      relayUrl: "https://relay.example",
      platform: "desktop",
    });

    const result = await core.reminders.regenerateSystem();
    // Only the sign-in nudge retires; the import nudge stays (still no entities).
    expect(result.removed).toBe(1);
    const live = await systemReminders();
    expect(live.map((r) => r.id)).not.toContain(idFor("connect-sync"));
    expect(live.map((r) => r.id)).toContain(idFor("import"));
  });

  it("retires the sign-in nudge for a local-only account, which binds no relay", async () => {
    // The collision the account invitation had to resolve: both custody nudges
    // deep-link to Settings, and this one used to retire on `relayUrl` alone — so
    // creating an account that never touches a relay left the user being nudged
    // toward a flow that could no longer satisfy it.
    await core.reminders.regenerateSystem();
    expect((await systemReminders()).map((r) => r.id)).toContain(
      idFor("connect-sync"),
    );

    const keyStore = createInMemoryKeyStore();
    await ensureDeviceMasterKey({ keyStore, driver });
    await createLocalAccount({
      keyStore,
      driver,
      password: "correct horse battery staple",
      username: "mary",
      platform: "desktop",
    });

    // No relay was bound — the account is local-only, and that is still an account.
    expect((await getSyncStatus({ driver })).relayUrl).toBeUndefined();
    await core.reminders.regenerateSystem();
    expect((await systemReminders()).map((r) => r.id)).not.toContain(
      idFor("connect-sync"),
    );
  });

  describe("the account invitation", () => {
    it("appears only once there is data, and retires the moment an account exists", async () => {
      // A brand-new profile sees no custody invitation at all.
      await core.reminders.regenerateSystem();
      expect((await systemReminders()).map((r) => r.id)).not.toContain(
        idFor("create-account"),
      );

      // The first person is the data an account would protect access to — and
      // creating one reconciles in the same call, so no explicit regenerate here.
      await core.people.create(
        {
          firstName: "Mary",
          middleName: null,
          lastName: "Bailey",
          gender: null,
        },
        [],
      );
      const invited = (await systemReminders()).find(
        (r) => r.id === idFor("create-account"),
      );
      expect(invited?.title).toBe(
        "🔐 Set up your login to protect the data on this device",
      );
      expect(invited?.dueDate).toBeNull();
      expect(onboardingRouteOf(invited!.id)).toBe("create-account");

      // Taking it — locally, no relay — retires it.
      const keyStore = createInMemoryKeyStore();
      await ensureDeviceMasterKey({ keyStore, driver });
      await createLocalAccount({
        keyStore,
        driver,
        password: "correct horse battery staple",
        username: "mary",
        platform: "desktop",
      });

      await core.reminders.regenerateSystem();
      expect((await systemReminders()).map((r) => r.id)).not.toContain(
        idFor("create-account"),
      );
    });

    it("survives two 'not now's, which would have retired any other step", async () => {
      // The extra repetition, through the real store and the real write method:
      // this is the one step that must never be wrongly silenced.
      await core.people.create(
        { firstName: "Mary", middleName: null, lastName: "L", gender: null },
        [],
      );
      const id = idFor("create-account");
      const nudge = async () =>
        (await systemReminders()).find((r) => r.id === id);

      for (let i = 0; i < 2; i++) {
        const offered = reminderActionsOf((await nudge())!);
        const snooze = offered.find((a) => a.kind === "snooze")!;
        await core.reminders.snooze(id, snooze.until);
      }
      await core.reminders.regenerateSystem();
      expect(await nudge()).toBeDefined();

      // The third spends the budget, and snooze stops being offered with it.
      const last = reminderActionsOf((await nudge())!);
      expect(last.find((a) => a.kind === "snooze")).toBeDefined();
      await core.reminders.snooze(
        id,
        last.find((a) => a.kind === "snooze")!.until,
      );
      await core.reminders.regenerateSystem();
      expect(await nudge()).toBeUndefined();
    });
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
    // import nudge, so we expect the sync nudge + the birthday reminder.
    const violet = await core.people.create(
      { firstName: "Violet", middleName: null, lastName: "Bick", gender: null },
      [],
    );
    const soon = civilDaysFromToday(0);
    // Configured to just the wish: this is about the families coexisting, not
    // about the `plan` prompt an unconfigured birthday would also carry.
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: violet.id,
      month: soon.month,
      day: soon.day,
      reminderSchedule: [
        { action: "wish", label: null, offsetDays: 0, enabled: true },
      ],
    });

    const rows = await systemReminders();
    const byKind = {
      sync: rows.filter((r) => r.id === idFor("connect-sync")),
      addPerson: rows.filter((r) => r.id === idFor("import")),
      birthday: rows.filter((r) => onboardingRouteOf(r.id) === null),
    };
    // The import nudge is retired (Violet exists); the sync nudge remains; the
    // birthday reminder is present and dated — all three coexist, none pruned.
    expect(byKind.addPerson).toHaveLength(0);
    expect(byKind.sync).toHaveLength(1);
    expect(byKind.birthday).toHaveLength(1);
    expect(reminderLabel(byKind.birthday[0])).toBe(
      "🎉 Wish @Violet Bick a happy birthday",
    );
    expect(
      daysUntil(todayCivil(), soon) >= 0 && byKind.birthday[0].dueDate !== null,
    ).toBe(true);
  });
});
