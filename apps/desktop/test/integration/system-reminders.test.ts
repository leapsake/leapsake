import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  onboardingRouteOf,
  runMigrations,
} from "@leapsake/core";
import { createMilestonesRepo } from "@leapsake/data";
import {
  type CivilDate,
  type Milestone,
  type ReminderRuleInput,
  civilFromDueMs,
  daysUntil,
  mentionToken,
  reminderLabel,
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

/** The `system` **milestone** reminders currently live, via the normal core read
 *  — excluding the onboarding nudge family (also `source: "system"`), which these
 *  birthday-engine tests aren't about. See onboarding-reminders.test.ts. */
async function systemReminders() {
  return (await core.reminders.list()).filter(
    (r) => r.source === "system" && onboardingRouteOf(r.id) === null,
  );
}

describe("core.reminders.regenerateSystem (birthday engine)", () => {
  it("generates a dated birthday reminder on the day itself", async () => {
    const alice = await core.people.create(
      { firstName: "Alice", middleName: null, lastName: "Ng", gender: null },
      [],
    );
    // Today. The default schedule is a day-of wish, and `wish` has no run-up:
    // it appears on the morning it is owed, not a month before.
    const soon = civilDaysFromToday(0);
    // A recurring birthday (month+day, no birth year).
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: alice.id,
      month: soon.month,
      day: soon.day,
    });

    // core.milestones.create reconciles the birthday reminders in the same call,
    // so the reminder is live immediately — no explicit regenerateSystem needed.
    const [reminder] = await systemReminders();
    // The subject is wrapped in an inline mention token carrying the person id, so
    // the name links to her page; the plain-text label strips back to her name.
    expect(reminder.title).toBe(
      `🎉 Wish ${mentionToken("Alice Ng", "person", alice.id)} a happy birthday`,
    );
    expect(reminderLabel(reminder)).toBe("🎉 Wish @Alice Ng a happy birthday");
    // Core resolves the mention to the person's current label for the renderer.
    expect(reminder.mentions).toEqual([
      { targetType: "person", targetId: alice.id, label: "Alice Ng" },
    ]);
    expect(reminder.dueDate).not.toBeNull();
    // Dated today, so the client shows "today".
    expect(daysUntil(todayCivil(), civilFromDueMs(reminder.dueDate!))).toBe(0);
  });

  it("mints one system reminder per enabled rule of a customised schedule", async () => {
    // The storage→engine seam: a user turns on the staggered "gift" and "card",
    // and the engine mints a reminder for each, on each action's own timetable —
    // the whole point of the per-milestone schedule.
    const bea = await core.people.create(
      { firstName: "Bea", middleName: null, lastName: "Ko", gender: null },
      [],
    );
    const occ = civilDaysFromToday(20);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: bea.id,
      month: occ.month,
      day: occ.day,
      // Replaces the kind defaults: a gift due a dozen days ahead and a card due
      // a week ahead, both on. Twenty days out, the gift's 30-day run-up and the
      // card's fortnight both have them on display already.
      reminderSchedule: [
        { action: "gift", label: null, offsetDays: 12, enabled: true },
        { action: "card", label: null, offsetDays: 7, enabled: true },
      ],
    });

    const rows = await systemReminders();
    const byTitle = new Map(rows.map((r) => [reminderLabel(r), r]));
    expect([...byTitle.keys()].sort()).toEqual([
      "🎁 Get @Bea Ko a gift",
      "💌 Send @Bea Ko a card",
    ]);
    // Each due its own lead time before the birthday.
    const gift = byTitle.get("🎁 Get @Bea Ko a gift")!;
    const card = byTitle.get("💌 Send @Bea Ko a card")!;
    expect(daysUntil(todayCivil(), civilFromDueMs(gift.dueDate!))).toBe(8);
    expect(daysUntil(todayCivil(), civilFromDueMs(card.dueDate!))).toBe(13);
    // Both link back to Bea's page.
    expect(
      (await core.reminders.mentioning("person", bea.id))
        .map((r) => r.id)
        .sort(),
    ).toEqual([gift.id, card.id].sort());
  });

  it("relabels the birthday mention live when the person is renamed", async () => {
    const alice = await core.people.create(
      { firstName: "Alice", middleName: null, lastName: "Ng", gender: null },
      [],
    );
    const soon = civilDaysFromToday(0);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: alice.id,
      month: soon.month,
      day: soon.day,
    });
    await core.reminders.regenerateSystem();

    await core.people.update(
      alice.id,
      { firstName: "Alicia", middleName: null, lastName: "Ng", gender: null },
      [],
    );

    // The stored title is frozen (the engine never rewrites it), but the resolved
    // mention re-reads the current label, so the link renders "Alicia Ng".
    const [reminder] = await systemReminders();
    expect(reminder.mentions[0].label).toBe("Alicia Ng");
  });

  it("is idempotent across runs (no duplicates, stable id)", async () => {
    const p = await core.people.create(
      { firstName: "Bob", middleName: null, lastName: "Lee", gender: null },
      [],
    );
    const soon = civilDaysFromToday(0);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: p.id,
      month: soon.month,
      day: soon.day,
    });

    await core.reminders.regenerateSystem();
    const firstId = (await systemReminders())[0].id;

    const second = await core.reminders.regenerateSystem();
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
    const rows = await systemReminders();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(firstId);
  });

  it("removes the reminder when its milestone is deleted", async () => {
    const p = await core.people.create(
      { firstName: "Cara", middleName: null, lastName: "Ito", gender: null },
      [],
    );
    const soon = civilDaysFromToday(0);
    const milestone = await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: p.id,
      month: soon.month,
      day: soon.day,
    });
    expect(await systemReminders()).toHaveLength(1);

    // Deleting the milestone prunes its reminder in the same call — no relaunch.
    await core.milestones.softDelete(milestone.id);
    expect(await systemReminders()).toHaveLength(0);
  });

  it("never resurrects a dismissed birthday reminder", async () => {
    const p = await core.people.create(
      { firstName: "Dev", middleName: null, lastName: "Roy", gender: null },
      [],
    );
    const soon = civilDaysFromToday(0);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: p.id,
      month: soon.month,
      day: soon.day,
    });
    await core.reminders.regenerateSystem();
    const id = (await systemReminders())[0].id;

    await core.reminders.softDelete(id); // user dismisses it

    const result = await core.reminders.regenerateSystem();
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(await systemReminders()).toHaveLength(0);
    expect(await core.reminders.get(id)).toBeUndefined(); // still tombstoned
  });

  it("keeps yesterday's birthday on the list, and lets it go after that", async () => {
    // The engine used to drop a reminder the morning after its day, so a missed
    // birthday vanished without ever saying it had been missed. End to end now:
    // yesterday is still there (belated, dated in the past), three days ago is not.
    const p = await core.people.create(
      { firstName: "Gil", middleName: null, lastName: "Amar", gender: null },
      [],
    );
    const yesterday = civilDaysFromToday(-1);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: p.id,
      month: yesterday.month,
      day: yesterday.day,
    });

    const [belated] = await systemReminders();
    expect(belated).toBeDefined();
    expect(daysUntil(todayCivil(), civilFromDueMs(belated.dueDate!))).toBe(-1);

    const longGone = civilDaysFromToday(-3);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: (
        await core.people.create(
          { firstName: "Hal", middleName: null, lastName: "Ora", gender: null },
          [],
        )
      ).id,
      month: longGone.month,
      day: longGone.day,
    });
    // Still just Gil's — Hal's birthday is past the belated tail.
    expect(await systemReminders()).toHaveLength(1);
  });

  it("mints the SAME reminder id on two independent devices (cross-device dedup)", async () => {
    // The dedup proof: two cores over separate drivers, each holding the *same*
    // milestone id (as it would be after sync), derive an identical reminder id —
    // so the existing whole-row merge collapses them instead of duplicating.
    const soon = civilDaysFromToday(0);
    const milestoneId = crypto.randomUUID();

    const idOnDevice = async (): Promise<string> => {
      const d = makeEncryptedTestDriver();
      try {
        await runMigrations(d.driver);
        const deviceCore = createCore(d.driver);
        const person = await deviceCore.people.create(
          { firstName: "Eve", middleName: null, lastName: "Sun", gender: null },
          [],
        );
        // Insert the milestone under a fixed, shared id (bypassing create's random
        // id) so both devices scan the same trigger identity.
        const milestone: Milestone = {
          id: milestoneId,
          kind: "birthday",
          bearerType: "person",
          bearerId: person.id,
          year: null,
          month: soon.month,
          day: soon.day,
          note: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        };
        await createMilestonesRepo(d.driver).insert(milestone);
        await deviceCore.reminders.regenerateSystem();
        const rows = (await deviceCore.reminders.list()).filter(
          (r) => r.source === "system" && onboardingRouteOf(r.id) === null,
        );
        expect(rows).toHaveLength(1);
        return rows[0].id;
      } finally {
        d.cleanup();
      }
    };

    const [idA, idB] = [await idOnDevice(), await idOnDevice()];
    expect(idA).toBe(idB);
  });
});

// The reported bugs: birthday reminders only reconciled at boot/focus, so adding,
// re-dating, or deleting a birthday didn't reflect until a relaunch. Folding the
// reconcile into the milestone write fixes all three; these drive the write and
// assert the reminder state without any explicit regenerateSystem().
describe("milestone writes reconcile birthday reminders at once", () => {
  /** Create a person with a birthday `days` out; return the person + milestone.
   *  `reminderSchedule` overrides the kind defaults — a test that needs the
   *  birthday to *move* while staying on the list needs an action with some
   *  run-up, since the default day-of wish has none. */
  async function personWithBirthday(
    days: number,
    reminderSchedule?: ReminderRuleInput[],
  ) {
    const person = await core.people.create(
      { firstName: "Faye", middleName: null, lastName: "Ng", gender: null },
      [],
    );
    const occ = civilDaysFromToday(days);
    const milestone = await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: person.id,
      month: occ.month,
      day: occ.day,
      ...(reminderSchedule === undefined ? {} : { reminderSchedule }),
    });
    return { person, milestone };
  }

  /** A day-of visit: due on the day like a wish, but with a week of run-up, so a
   *  date can drift and stay in window. */
  const VISIT: ReminderRuleInput[] = [
    { action: "visit", label: null, offsetDays: 0, enabled: true },
  ];

  it("shows a new birthday on the Home list (and the person's backlink) at once", async () => {
    const { person } = await personWithBirthday(0);

    // No explicit regenerateSystem: creating the birthday already reconciled it.
    const [reminder] = await systemReminders();
    expect(reminder).toBeDefined();
    expect(daysUntil(todayCivil(), civilFromDueMs(reminder.dueDate!))).toBe(0);

    // And it backlinks onto the person's "Mentioned in" section.
    expect(
      (await core.reminders.mentioning("person", person.id)).map((r) => r.id),
    ).toEqual([reminder.id]);
  });

  it("re-dates the reminder in place when the birthday's date is edited", async () => {
    const { milestone } = await personWithBirthday(3, VISIT);
    const before = (await systemReminders())[0];
    expect(daysUntil(todayCivil(), civilFromDueMs(before.dueDate!))).toBe(3);

    // Move the birthday later in the same window — the reminder id is stable, so
    // its due date must update rather than the stale "in 3 days" sticking.
    const later = civilDaysFromToday(6);
    await core.milestones.update(milestone.id, {
      month: later.month,
      day: later.day,
    });

    const after = (await systemReminders())[0];
    expect(after.id).toBe(before.id); // same reminder, re-dated in place
    expect(daysUntil(todayCivil(), civilFromDueMs(after.dueDate!))).toBe(6);
  });

  it("drops the reminder off the Home list when the birthday is deleted", async () => {
    const { person, milestone } = await personWithBirthday(0);
    expect(await systemReminders()).toHaveLength(1);

    await core.milestones.softDelete(milestone.id);

    expect(await systemReminders()).toHaveLength(0);
    // And it falls off the person's backlink too (mentions cleared on prune).
    expect(await core.reminders.mentioning("person", person.id)).toEqual([]);
  });

  it("prunes the reminder when the whole person is deleted (cascade reconcile)", async () => {
    const { person } = await personWithBirthday(0);
    expect(await systemReminders()).toHaveLength(1);

    // Deleting the person cascades away their birthday milestone; the reconcile
    // folded into people.softDelete drops the orphaned reminder in the same call.
    await core.people.softDelete(person.id);
    expect(await systemReminders()).toHaveLength(0);
  });

  it("refuses to edit an automatic reminder's content, but allows complete + delete", async () => {
    await personWithBirthday(0);
    const reminder = (await systemReminders())[0];
    expect(reminder.source).toBe("system");

    // Content edits are the engine's to make, not the user's — core rejects them.
    await expect(
      core.reminders.update(reminder.id, { title: "hijacked" }),
    ).rejects.toThrow(/can't be edited/);
    // The stored title is untouched by the rejected edit.
    expect((await core.reminders.get(reminder.id))?.title).toBe(reminder.title);

    // Completing/reopening and deleting an automatic reminder still work.
    const done = await core.reminders.setCompleted(reminder.id, true);
    expect(done?.completedAt).not.toBeNull();
    await core.reminders.softDelete(reminder.id);
    expect(await core.reminders.get(reminder.id)).toBeUndefined();
  });

  it("still lets the birthday engine re-date its own system reminder (guard is user-only)", async () => {
    const { milestone } = await personWithBirthday(3, VISIT);
    const before = (await systemReminders())[0];

    // The engine's reconcile updates system reminders through the repo directly,
    // so the user-facing edit guard doesn't block a legitimate drift-repair.
    const later = civilDaysFromToday(7);
    await core.milestones.update(milestone.id, {
      month: later.month,
      day: later.day,
    });

    const after = (await systemReminders())[0];
    expect(after.id).toBe(before.id);
    expect(daysUntil(todayCivil(), civilFromDueMs(after.dueDate!))).toBe(7);
  });

  it("re-points a merged-in birthday reminder onto the survivor", async () => {
    const survivor = await core.people.create(
      { firstName: "Sam", middleName: null, lastName: "Sur", gender: null },
      [],
    );
    const loser = await core.people.create(
      { firstName: "Lee", middleName: null, lastName: "Los", gender: null },
      [],
    );
    // The birthday (and so its reminder) belongs to the loser before the merge.
    const occ = civilDaysFromToday(0);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: loser.id,
      month: occ.month,
      day: occ.day,
    });
    const [before] = await core.reminders.mentioning("person", loser.id);
    expect(before).toBeDefined();

    await core.people.merge(survivor.id, loser.id);

    // Still one birthday reminder (same id — the milestone was repointed, not
    // re-created), now backlinking the survivor and not the tombstoned loser.
    const [reminder] = await systemReminders();
    expect(reminder.id).toBe(before.id);
    expect(
      (await core.reminders.mentioning("person", survivor.id)).map((r) => r.id),
    ).toEqual([reminder.id]);
    expect(await core.reminders.mentioning("person", loser.id)).toEqual([]);

    // Its title + resolved mention now name the survivor, not the dead loser.
    expect(reminder.title).toBe(
      `🎉 Wish ${mentionToken("Sam Sur", "person", survivor.id)} a happy birthday`,
    );
    const resolved = await core.reminders.get(reminder.id);
    expect(resolved?.mentions).toEqual([
      { targetType: "person", targetId: survivor.id, label: "Sam Sur" },
    ]);
  });
});

/**
 * Migration 34's whole reason to exist, driven end to end.
 *
 * Shrinking the windows made rows that were already on someone's list undesired,
 * and the engine retires an undesired row by **soft-deleting** it — a tombstone
 * it will never resurrect. Left alone, upgrading would have cost the user this
 * year's birthday on the very morning it mattered.
 */
describe("migration 34 sweeps the generated reminders", () => {
  it("clears a stale tombstone so the engine can mint the row again", async () => {
    const p = await core.people.create(
      { firstName: "Ivy", middleName: null, lastName: "Pak", gender: null },
      [],
    );
    const today = civilDaysFromToday(0);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: p.id,
      month: today.month,
      day: today.day,
    });
    const [row] = await systemReminders();

    // Stand in for the prune an upgrade would have caused: the row is gone, and
    // the resurrection guard means a reconcile will not bring it back.
    await core.reminders.softDelete(row.id);
    await core.reminders.regenerateSystem();
    expect(await systemReminders()).toHaveLength(0);

    // Rewind the schema version and re-run, so only migration 34 applies.
    await driver.exec("PRAGMA user_version = 33");
    await runMigrations(driver);

    await core.reminders.regenerateSystem();
    const [after] = await systemReminders();
    expect(after).toBeDefined();
    // Identity is unchanged by the sweep — the id is deterministic, so the row
    // comes back as itself rather than as a duplicate.
    expect(after.id).toBe(row.id);
  });
});

describe("core.reminders.listInWindow (what the list shows)", () => {
  /** A person with a birthday `days` out, on the shipped default schedule
   *  (a day-of wish) unless a schedule is supplied. */
  async function birthdayIn(
    days: number,
    reminderSchedule?: ReminderRuleInput[],
  ) {
    const person = await core.people.create(
      { firstName: "Cara", middleName: null, lastName: "Vale", gender: null },
      [],
    );
    const occ = civilDaysFromToday(days);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: person.id,
      month: occ.month,
      day: occ.day,
      ...(reminderSchedule === undefined ? {} : { reminderSchedule }),
    });
    return person;
  }

  /** The windowed rows this suite is about, minus the onboarding nudge family. */
  async function windowed() {
    return (await core.reminders.listInWindow()).filter(
      (r) => onboardingRouteOf(r.id) === null,
    );
  }

  it("previews a reminder that is not a row yet, and joins nothing to it", async () => {
    const cara = await birthdayIn(20);

    // Nothing materialized: a wish is day-of, so twenty days out there is no row.
    expect(await systemReminders()).toHaveLength(0);

    const [preview] = await windowed();
    expect(preview.materialized).toBe(false);
    expect(preview.title).toBe(
      `🎉 Wish ${mentionToken("Cara Vale", "person", cara.id)} a happy birthday`,
    );
    // The name still renders: it is in the text, which is the source of truth.
    // The join only ever supplied *current* labels, and a preview has no row to
    // have stale ones on.
    expect(preview.tags).toEqual([]);
    expect(preview.mentions).toEqual([]);
    // The two dates the stored row cannot say.
    expect(preview.occurrenceDate).toBe(preview.dueDate);
    expect(preview.activeFrom).toBe(preview.dueDate);
  });

  it("joins tags and mentions onto a row that does exist", async () => {
    const cara = await birthdayIn(0);

    const [row] = await windowed();

    expect(row.materialized).toBe(true);
    expect(row.mentions).toEqual([
      { targetType: "person", targetId: cara.id, label: "Cara Vale" },
    ]);
  });

  // The gift's 30-day run-up puts it on display three weeks before its own due
  // date, and well before the birthday it counts down to.
  it("dates a gift by its own run-up, not by the occasion", async () => {
    await birthdayIn(20, [
      { action: "gift", label: null, offsetDays: 12, enabled: true },
    ]);

    const [gift] = await windowed();

    expect(daysUntil(todayCivil(), civilFromDueMs(gift.occurrenceDate!))).toBe(
      20,
    );
    expect(daysUntil(todayCivil(), civilFromDueMs(gift.dueDate!))).toBe(8);
    expect(daysUntil(todayCivil(), civilFromDueMs(gift.activeFrom!))).toBe(-22);
  });

  it("mints the row when a preview is ticked", async () => {
    await birthdayIn(20);
    const [preview] = await windowed();

    await core.reminders.setCompleted(preview.id, true);

    const [row] = await systemReminders();
    expect(row.id).toBe(preview.id);
    expect(row.completedAt).not.toBeNull();
  });

  // ⚠️ The documented consequence of ticking early: the next reconcile does not
  // want the row yet, so it prunes it to a tombstone and the resurrection guard
  // keeps it dead. "Already bought it, stop asking" — and it is permanent.
  it("retires an early-ticked reminder for good", async () => {
    await birthdayIn(20);
    const [preview] = await windowed();
    await core.reminders.setCompleted(preview.id, true);

    await core.reminders.regenerateSystem();
    expect(await systemReminders()).toHaveLength(0);

    // Even once its own window opens, the tombstone stands.
    const stillPreviewed = await windowed();
    expect(stillPreviewed).toHaveLength(0);
  });

  it("returns user reminders too, with no window facts of their own", async () => {
    await core.reminders.create({ title: "Call the dentist", body: null });

    const [row] = (await core.reminders.listInWindow()).filter(
      (r) => r.source === "user",
    );

    expect(row.materialized).toBe(true);
    expect(row.activeFrom).toBeNull();
    expect(row.occurrenceDate).toBeNull();
  });
});
