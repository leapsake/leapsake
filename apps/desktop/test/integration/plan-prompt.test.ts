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
  promptAnswerOf,
  promptOffsetDays,
  setPromptItem,
  reminderLabel,
  resolveReminderSchedule,
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
    { firstName: "Violet", middleName: null, lastName: "Bick", gender: null },
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
      "🗓 What do you want to do for @Violet Bick's birthday?",
    );
  });

  it("names it as a prompt through the CTA read, with its offer set", async () => {
    const { milestone } = await personWithBirthday(APPEARS_DAYS);

    const [target] = (await core.reminders.targets()).plans;
    expect(target.milestoneId).toBe(milestone.id);
    expect(target.milestoneKind).toBe("birthday");
    expect(target.subject).toBe("Violet Bick");
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
      "send:gift",
      "give:card",
      "give:gift",
      "wish",
    ]);
    expect(
      promptAnswerOf(target.offers)
        .filter((o) => o.enabled)
        .map((o) => o.action),
    ).toEqual(["wish"]);
    // Ticked, a gift or a card is posted unless the user says otherwise.
    expect(target.offers.filter((o) => o.enabled).map((o) => o.action)).toEqual(
      ["send:card", "send:gift", "wish"],
    );
  });

  // Learned of five days out, the question cannot offer to post anything — the
  // post date is too close — but a gift or a card can still be handed over in
  // person. The screen offers exactly what the engine asked about.
  it("offers only what still fits when it arrives late", async () => {
    await personWithBirthday(5);

    const [target] = (await core.reminders.targets()).plans;
    expect(target.offers.map((o) => o.action)).toEqual([
      "get:gift",
      "get:card",
      "give:card",
      "give:gift",
      "wish",
    ]);
  });

  it("turns a ticked card into a card reminder at its own due date", async () => {
    // Twenty days out, and the app has only just learned of it: the question is
    // not overdue, it is due on the last day to post — you can't be late for
    // something the app has only just learned. A card is due a week before the
    // birthday with a fortnight's run-up, so it is on display the moment it is
    // ticked.
    const { milestone } = await personWithBirthday(20);
    const [target] = (await core.reminders.targets()).plans;
    expect(target).toBeDefined();

    // Answering writes the **whole** offer set, the unticked ones disabled.
    await core.milestones.answerPlan(milestone.id, {
      year: target.occurrenceYear,
      rules: setPromptItem(
        target.offers,
        target.offers.findIndex((offer) => offer.action === "get:card"),
        true,
      ),
    });

    // The prompt retires, and the card takes its place: bought twelve days
    // before the birthday and posted a week before. The engine took over.
    expect((await core.reminders.targets()).plans).toEqual([]);
    const rows = await systemReminders();
    expect(
      rows.map((r) => [
        reminderLabel(r),
        daysUntil(todayCivil(), civilFromDueMs(r.dueDate!)),
      ]),
    ).toEqual([
      ["🛒 Get a card for @Violet Bick", 8],
      ["💌 Send @Violet Bick a card", 13],
    ]);
  });

  // The one-tap answer: the same write, with only the wish left on.
  it("retires the prompt on `just the day`, leaving the wish alone", async () => {
    const { milestone } = await personWithBirthday(APPEARS_DAYS);
    const [target] = (await core.reminders.targets()).plans;

    await core.milestones.answerPlan(milestone.id, {
      year: target.occurrenceYear,
      rules: target.offers.map((offer) => ({
        ...offer,
        enabled: offer.action === "wish",
      })),
    });

    expect(await systemReminders()).toHaveLength(0);
    expect((await core.reminders.targets()).plans).toEqual([]);
  });

  // The answer is this year's alone: the Person screen's schedule is untouched.
  it("leaves the standing schedule as it was", async () => {
    const { milestone } = await personWithBirthday(APPEARS_DAYS);
    const before = await core.milestones.reminderSchedule(
      milestone.id,
      "birthday",
    );
    const [target] = (await core.reminders.targets()).plans;

    await core.milestones.answerPlan(milestone.id, {
      year: target.occurrenceYear,
      rules: target.offers.map((offer) => ({ ...offer, enabled: true })),
    });

    expect(
      await core.milestones.reminderSchedule(milestone.id, "birthday"),
    ).toEqual(before);
  });

  // A save on the Person screen is the user's last word, this year included.
  it("gives way to a schedule saved afterwards", async () => {
    const { milestone } = await personWithBirthday(20);
    const [target] = (await core.reminders.targets()).plans;
    await core.milestones.answerPlan(milestone.id, {
      year: target.occurrenceYear,
      rules: target.offers.map((offer) => ({
        ...offer,
        enabled: offer.action === "get:gift",
      })),
    });
    expect((await systemReminders()).map(reminderLabel)).toEqual([
      "🎁 Get @Violet Bick a gift",
    ]);

    await core.milestones.update(milestone.id, {
      reminderSchedule: [
        { action: "get:card", label: null, offsetDays: 12, enabled: true },
      ],
    });
    expect((await systemReminders()).map(reminderLabel)).toEqual([
      "🛒 Get a card for @Violet Bick",
    ]);
  });

  // “Giving it in person” on the posting: this year's gift is handed over on
  // the day instead, and buying it keeps its own deadline.
  it("hands a posted gift over in person, for that year alone", async () => {
    // Fifteen days out, the posting is already on display.
    const { milestone } = await personWithBirthday(15);
    const [target] = (await core.reminders.targets()).plans;
    await core.milestones.answerPlan(milestone.id, {
      year: target.occurrenceYear,
      rules: setPromptItem(
        target.offers,
        target.offers.findIndex((offer) => offer.action === "get:gift"),
        true,
      ),
    });
    const [post] = (await core.reminders.targets()).deliveries;
    expect(post.action).toBe("send:gift");

    await core.milestones.answerInPerson(milestone.id, {
      year: post.occurrenceYear,
      action: post.action,
    });

    const shown = (await core.reminders.listInWindow()).filter(
      (r) => r.source === "system" && onboardingRouteOf(r.id) === null,
    );
    expect(
      shown.map((r) => [
        reminderLabel(r),
        daysUntil(todayCivil(), civilFromDueMs(r.dueDate!)),
      ]),
    ).toEqual([
      ["🎁 Get @Violet Bick a gift", 3],
      ["🎉 Wish @Violet Bick a happy birthday", 15],
      ["🎁 Give @Violet Bick a gift", 15],
    ]);
    expect(
      await core.milestones.reminderSchedule(milestone.id, "birthday"),
    ).toEqual(resolveReminderSchedule("birthday", []).rules);
  });

  // “Don’t ask again… → Ever”: the occasion keeps its schedule and stops asking.
  it("stops asking about an occasion told never to ask again", async () => {
    const { milestone } = await personWithBirthday(APPEARS_DAYS);
    expect((await core.reminders.targets()).plans).toHaveLength(1);

    await core.milestones.update(milestone.id, { asksEachYear: false });

    expect((await core.reminders.targets()).plans).toEqual([]);
    expect(
      (await core.milestones.listForBearer("person", milestone.bearerId))[0],
    ).toMatchObject({ asksEachYear: false });
  });

  // ⚠️ Ticking *nothing* has to be distinguishable from never being asked, or
  // the question comes straight back.
  it("counts an answer of `nothing` as answered", async () => {
    const { milestone } = await personWithBirthday(APPEARS_DAYS);
    const [target] = (await core.reminders.targets()).plans;

    await core.milestones.answerPlan(milestone.id, {
      year: target.occurrenceYear,
      rules: target.offers.map((offer) => ({ ...offer, enabled: false })),
    });

    expect(await systemReminders()).toHaveLength(0);
    expect((await core.reminders.targets()).plans).toEqual([]);
  });

  // An ignored prompt is not silence. This is the guarantee that makes the
  // question safe to ignore — *a nudge, never a wall*. By the day itself the
  // question has retired, the wish being all there is left to choose.
  it("leaves the day-of wish standing once the question has retired", async () => {
    await personWithBirthday(0);

    const labels = (await systemReminders()).map(reminderLabel);
    expect(labels).toEqual(["🎉 Wish @Violet Bick a happy birthday"]);
  });
});
