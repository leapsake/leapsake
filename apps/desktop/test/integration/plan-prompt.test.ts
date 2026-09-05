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
  civilFromDueMs,
  daysUntil,
  promptOffsetDays,
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

/** The distances, derived so that moving a number in `actionDefs` moves this
 *  file with it rather than breaking it. */
const APPEARS_DAYS = promptOffsetDays("birthday") + actionDefs.plan.activeDays;

function civilDaysFromToday(days: number): CivilDate {
  const t = todayCivil();
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** The `system` **milestone** reminders currently live, minus the onboarding
 *  nudge family (also `source: "system"`), which these tests aren't about. */
async function systemReminders() {
  return (await core.reminders.list()).filter(
    (r) => r.source === "system" && onboardingRouteOf(r.id) === null,
  );
}

/** A person with an unconfigured birthday `days` out — nothing is written about
 *  how to mark it, which is the condition the prompt exists for. */
async function personWithBirthday(days: number) {
  const person = await core.people.create(
    { firstName: "Alice", middleName: null, lastName: "Ng", gender: null },
    [],
  );
  const occ = civilDaysFromToday(days);
  const milestone = await core.milestones.create({
    kind: "birthday",
    bearerType: "person",
    bearerId: person.id,
    month: occ.month,
    day: occ.day,
  });
  return { person, milestone };
}

describe("the plan prompt, end to end through core", () => {
  // The whole point of the increment: an occasion nobody has configured puts
  // **one** row on Home — a question — rather than a speculative errand per
  // action. Two months out, before the wish's own day-of window opens.
  it("puts exactly one row on Home for a fresh birthday two months out", async () => {
    await personWithBirthday(APPEARS_DAYS);

    const rows = await systemReminders();
    expect(rows).toHaveLength(1);
    expect(reminderLabel(rows[0])).toBe(
      "🗓 How do you want to mark @Alice Ng's birthday?",
    );
  });

  it("names it as a prompt through the CTA read, with its offer set", async () => {
    const { milestone } = await personWithBirthday(APPEARS_DAYS);

    const [target] = (await core.reminders.targets()).plans;
    expect(target.milestoneId).toBe(milestone.id);
    expect(target.milestoneKind).toBe("birthday");
    expect(target.subject).toBe("Alice Ng");
    // ⚠️ The occasion, **not** the prompt's own due date. The row renders its
    // distance from `dueDate` — six weeks earlier — so the screen that asks the
    // question needs this to say when the birthday actually is.
    expect(
      daysUntil(todayCivil(), civilFromDueMs(target.occurrenceDate!)),
    ).toBe(APPEARS_DAYS);
    // The kind's own offers, `enabled` carrying which arrive pre-ticked: the
    // wish alone, exactly what ships today.
    expect(target.offers.map((o) => o.action)).toEqual([
      "get:gift",
      "get:card",
      "send:card",
      "wish",
    ]);
    expect(target.offers.filter((o) => o.enabled).map((o) => o.action)).toEqual(
      ["wish"],
    );
  });

  it("turns a ticked card into a card reminder at its own due date", async () => {
    // Twenty days out: the prompt is past its own deadline but still standing —
    // its window closes on the occurrence, not on its due date, so a late answer
    // works and the chosen errands simply materialise with compressed windows.
    // A card is due a week before the birthday with a fortnight's run-up, so it
    // is on display the moment it is ticked.
    const { milestone } = await personWithBirthday(20);
    const [target] = (await core.reminders.targets()).plans;
    expect(target).toBeDefined();

    // Answering writes the **whole** offer set, the unticked ones disabled.
    await core.milestones.update(milestone.id, {
      reminderSchedule: target.offers.map((offer) => ({
        ...offer,
        enabled: offer.action === "wish" || offer.action === "send:card",
      })),
    });

    // The prompt retires, and the card takes its place at its own due date — a
    // week before the birthday, which is thirteen days out. The engine took over.
    expect((await core.reminders.targets()).plans).toEqual([]);
    const rows = await systemReminders();
    expect(rows.map(reminderLabel)).toEqual(["💌 Send @Alice Ng a card"]);
    expect(daysUntil(todayCivil(), civilFromDueMs(rows[0].dueDate!))).toBe(13);
  });

  // The one-tap answer: the same write, with only the wish left on.
  it("retires the prompt on `just the day`, leaving the wish alone", async () => {
    const { milestone } = await personWithBirthday(APPEARS_DAYS);
    const [target] = (await core.reminders.targets()).plans;

    await core.milestones.update(milestone.id, {
      reminderSchedule: target.offers.map((offer) => ({
        ...offer,
        enabled: offer.action === "wish",
      })),
    });

    expect(await systemReminders()).toHaveLength(0);
    const schedule = await core.milestones.reminderSchedule(
      milestone.id,
      "birthday",
    );
    // The full set is stored, not just the tick — that is what makes "asked" a
    // fact rather than an inference, so next year's occurrence asks nothing.
    // Measured against what was *offered* rather than against a written-down
    // count, so narrowing the offer set (as 2026-09-05 did, by two) moves this
    // with it instead of breaking it.
    expect(schedule).toHaveLength(target.offers.length);
    expect(schedule.filter((r) => r.enabled).map((r) => r.action)).toEqual([
      "wish",
    ]);
  });

  // ⚠️ Ticking *nothing* has to be distinguishable from never being asked, or
  // the question comes back every year.
  it("counts an answer of `nothing` as answered", async () => {
    const { milestone } = await personWithBirthday(APPEARS_DAYS);
    const [target] = (await core.reminders.targets()).plans;

    await core.milestones.update(milestone.id, {
      reminderSchedule: target.offers.map((offer) => ({
        ...offer,
        enabled: false,
      })),
    });

    expect(await systemReminders()).toHaveLength(0);
    expect((await core.reminders.targets()).plans).toEqual([]);
  });

  // An ignored prompt is not silence. This is the guarantee that makes the
  // question safe to ignore — *a nudge, never a wall*.
  it("still produces the day-of wish when the prompt is ignored", async () => {
    await personWithBirthday(0);

    const labels = (await systemReminders()).map(reminderLabel);
    expect(labels).toContain("🎉 Wish @Alice Ng a happy birthday");
    expect(labels).toContain("🗓 How do you want to mark @Alice Ng's birthday?");
  });
});
