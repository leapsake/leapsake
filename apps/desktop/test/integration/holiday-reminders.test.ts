import { createCore, seedHolidayCatalog } from "@leapsake/core";
import {
  createObservancesRepo,
  createHolidaysRepo,
  createReminderRulesRepo,
  holidayIdFor,
  observanceIdFor,
  runMigrations,
} from "@leapsake/data";
import type { SqliteDriver } from "@leapsake/data";
import { deterministicUuid } from "@leapsake/bytes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Holiday reminders end to end: an observance saved through the picker becomes a
 * `system` reminder on Home, through the real engine and the real repos.
 */
describe("holiday reminders", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;
  const CHRISTMAS = holidayIdFor("christmas");
  const MOTHERS_DAY = holidayIdFor("us-mothers-day");

  beforeEach(async () => {
    // The engine reads the real clock, and a holiday only produces a reminder
    // once its action's own window opens — a day-of wish, on the day — so these
    // tests pin "today" rather than depending on the calendar the suite happens
    // to run on. Only `Date` is faked; faking
    // timers too would stall the driver's promises.
    vi.useFakeTimers({ toFake: ["Date"] });
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
    await seedHolidayCatalog({ driver });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /** Pin the local civil date the reconcile runs against. */
  function today(year: number, month: number, day: number): void {
    vi.setSystemTime(new Date(year, month - 1, day, 12));
  }

  /**
   * A person observing a holiday, with the day-of wish switched **on**.
   *
   * An observance ships with every action off — holidays all land at once, so a
   * default-on wish would flood a user's Home — which means the opt-in has to be
   * explicit here. "generates nothing until a rule is enabled" below pins that
   * default directly.
   */
  async function aliceObserving(holidayId: string) {
    const core = createCore(driver);
    const violet = await core.people.create(
      { firstName: "Violet", lastName: "Bick" },
      [],
    );
    await core.holidays.setObservers(holidayId, [
      { bearerType: "person", bearerId: violet.id, observes: true },
    ]);
    await createReminderRulesRepo(driver).replaceForBearer(
      "observance",
      observanceIdFor(holidayId, "person", violet.id),
      [{ action: "wish", offsetDays: 0, enabled: true }],
    );
    return { core, violet };
  }

  /** Every active system reminder's title. */
  async function systemTitles(core: ReturnType<typeof createCore>) {
    const reminders = await core.reminders.list();
    return reminders
      .filter((r) => r.source === "system")
      .map((r) => r.title ?? "")
      .sort();
  }

  it("generates a reminder carrying the holiday's own greeting", async () => {
    today(2026, 12, 25); // a `wish` is day-of, so Christmas Day itself
    const { core, violet } = await aliceObserving(CHRISTMAS);
    await core.reminders.regenerateSystem();

    const titles = await systemTitles(core);
    expect(titles.some((t) => t.includes("a Merry Christmas"))).toBe(true);
    // …and it mentions the person, so the reminder links back to them.
    expect(titles.some((t) => t.includes(`person:${violet.id}`))).toBe(true);
    // Never the birthday copy the `wish` action used to hard-code.
    expect(titles.some((t) => t.includes("happy birthday"))).toBe(false);
  });

  it("generates nothing until a rule is enabled", async () => {
    // The default an observance rides. Deliberately quieter than a birthday's:
    // every Christmas observance comes due on the same day, so a default-on wish
    // would surface one reminder per person all at once.
    today(2026, 12, 1);
    const core = createCore(driver);
    const violet = await core.people.create(
      { firstName: "Violet", lastName: "Bick" },
      [],
    );
    await core.holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: violet.id, observes: true },
    ]);
    await core.reminders.regenerateSystem();

    expect(
      (await systemTitles(core)).some((t) => t.includes("Christmas")),
    ).toBe(false);
  });

  it("generates nothing for an explicit non-observer", async () => {
    const core = createCore(driver);
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Martini" },
      [],
    );
    await core.holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: harry.id, observes: false },
    ]);
    await core.reminders.regenerateSystem();

    expect(await systemTitles(core)).not.toContainEqual(
      expect.stringContaining("Christmas"),
    );
  });

  it("suppresses reminders for a hidden holiday, and restores on unhide", async () => {
    // The behaviour §2.6 insists on: hiding has to reach the reminder engine,
    // not just browse surfaces, or "I hid Mother's Day" still produces "Wish
    // @Violet a Happy Mother's Day".
    today(2027, 5, 9); // Mother's Day 2027, the day itself
    const { core } = await aliceObserving(MOTHERS_DAY);
    await core.reminders.regenerateSystem();
    const before = await systemTitles(core);
    expect(before.some((t) => t.includes("Mother's Day"))).toBe(true);

    await core.holidays.setHidden(MOTHERS_DAY, true);
    await core.reminders.regenerateSystem();
    expect(
      (await systemTitles(core)).some((t) => t.includes("Mother's Day")),
    ).toBe(false);

    // The observance survived the hide, so unhiding brings the holiday back for
    // future occurrences (the *current* occurrence's reminder stays tombstoned —
    // a pruned system reminder is never resurrected).
    await core.holidays.setHidden(MOTHERS_DAY, false);
    const observances = createObservancesRepo(driver);
    expect(await observances.listForHoliday(MOTHERS_DAY)).toHaveLength(1);
  });

  it("honours a per-observance reminder rule", async () => {
    // A card is due a week out and carries a fortnight of run-up, so ten days
    // before Christmas it is on display and the day-of wish is not.
    today(2026, 12, 15);
    const { core, violet } = await aliceObserving(CHRISTMAS);
    const observanceId = observanceIdFor(CHRISTMAS, "person", violet.id);

    await createReminderRulesRepo(driver).replaceForBearer(
      "observance",
      observanceId,
      [{ action: "send:card", offsetDays: 7, enabled: true }],
    );
    await core.reminders.regenerateSystem();

    const titles = await systemTitles(core);
    expect(titles.some((t) => t.includes("a card"))).toBe(true);
    expect(titles.some((t) => t.includes("a Merry Christmas"))).toBe(false);
  });

  it("prunes a holiday reminder once the observance is withdrawn", async () => {
    today(2026, 12, 25);
    const { core, violet } = await aliceObserving(CHRISTMAS);
    await core.reminders.regenerateSystem();
    expect(
      (await systemTitles(core)).some((t) => t.includes("Christmas")),
    ).toBe(true);

    await core.holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: violet.id, observes: false },
    ]);
    await core.reminders.regenerateSystem();

    expect(
      (await systemTitles(core)).some((t) => t.includes("Christmas")),
    ).toBe(false);
  });

  it("generates nothing for a holiday whose rule it cannot parse", async () => {
    // Rule-type skew, reaching the engine rather than just the browse screen:
    // the observance and holiday rows both survive, but no reminder is invented.
    const core = createCore(driver);
    const violet = await core.people.create(
      { firstName: "Violet", lastName: "Bick" },
      [],
    );
    const futureId = holidayIdFor("from-the-future");
    const now = Date.UTC(2026, 0, 1);
    await createHolidaysRepoRow(driver, {
      id: futureId,
      slug: "from-the-future",
      recurrence: '{"type":"hebrew-calendar"}',
      now,
    });
    await createObservancesRepo(driver).setObservance(
      futureId,
      "person",
      violet.id,
      true,
    );

    await expect(core.reminders.regenerateSystem()).resolves.toBeDefined();
    expect((await systemTitles(core)).some((t) => t.includes("Future"))).toBe(
      false,
    );
  });

  it("is idempotent — a second reconcile changes nothing", async () => {
    today(2026, 12, 25);
    const { core } = await aliceObserving(CHRISTMAS);
    await core.reminders.regenerateSystem();
    const second = await core.reminders.regenerateSystem();
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
  });
});

/**
 * Milestone reminder ids must never move. They are content-addressed and synced,
 * so a change to how they are derived doesn't migrate anything — it mints a
 * second reminder for every occurrence on every device, and the originals stay
 * behind as orphans. This pins one to a literal so any future refactor of the
 * derivation fails loudly here rather than in a user's Home screen.
 */
describe("system reminder id stability", () => {
  // Spelled as a literal rather than imported, deliberately: the namespace value
  // is as load-bearing as the derivation, so a rename of the constant should
  // fail here too rather than silently follow along.
  const SYSTEM_REMINDER_NAMESPACE = "leapsake:system-reminder";

  it("derives a milestone reminder id the same way it always has", () => {
    const id = deterministicUuid(
      SYSTEM_REMINDER_NAMESPACE,
      "milestone:11111111-1111-4111-8111-111111111111:2026:wish",
    );
    expect(id).toBe("3c86137e-4630-5392-bc36-8c65c494ad53");
  });

  it("keeps the holiday name-space disjoint from the milestone one", () => {
    const milestone = deterministicUuid(
      SYSTEM_REMINDER_NAMESPACE,
      "milestone:abc:2026:wish",
    );
    const observance = deterministicUuid(
      SYSTEM_REMINDER_NAMESPACE,
      "observance:abc:2026-12-25:wish",
    );
    const onboarding = deterministicUuid(
      SYSTEM_REMINDER_NAMESPACE,
      "onboarding:import-contacts",
    );
    expect(new Set([milestone, observance, onboarding]).size).toBe(3);
  });
});

/** Insert a raw holiday row (bypassing the catalog) for the skew case. */
async function createHolidaysRepoRow(
  driver: SqliteDriver,
  opts: { id: string; slug: string; recurrence: string; now: number },
): Promise<void> {
  await createHolidaysRepo(driver).upsertFromRemote({
    id: opts.id,
    slug: opts.slug,
    name: "From The Future",
    greeting: "a Happy Future",
    recurrence: opts.recurrence,
    durationDays: null,
    familyId: null,
    impliedByLocale: false,
    origin: "catalog",
    createdAt: opts.now,
    updatedAt: opts.now,
    deletedAt: null,
  });
}

/**
 * The per-observance schedule editor. This is the surface that makes a holiday
 * do anything at all — observances ship with every action off, so without it a
 * saved observance is inert.
 */
describe("observance reminder schedule", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;
  const CHRISTMAS = holidayIdFor("christmas");

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
    await seedHolidayCatalog({ driver });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function violet(core: ReturnType<typeof createCore>) {
    const person = await core.people.create(
      { firstName: "Violet", lastName: "Bick" },
      [],
    );
    await core.holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: person.id, observes: true },
    ]);
    return person;
  }

  it("reads the offered actions, all off, for an untouched observance", async () => {
    const core = createCore(driver);
    const person = await violet(core);

    const schedule = await core.holidays.getObservanceSchedule(
      CHRISTMAS,
      "person",
      person.id,
    );
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule.every((r) => !r.enabled)).toBe(true);
    // Furthest lead first, like the milestone editor.
    const offsets = schedule.map((r) => r.offsetDays);
    expect(offsets).toEqual([...offsets].sort((a, b) => b - a));
  });

  it("persists an enabled rule and reads it back", async () => {
    const core = createCore(driver);
    const person = await violet(core);

    await core.holidays.setObservanceSchedule(CHRISTMAS, "person", person.id, [
      { action: "get:gift", label: null, offsetDays: 21, enabled: true },
    ]);

    const schedule = await core.holidays.getObservanceSchedule(
      CHRISTMAS,
      "person",
      person.id,
    );
    expect(schedule).toEqual([
      expect.objectContaining({
        action: "get:gift",
        offsetDays: 21,
        enabled: true,
      }),
    ]);
  });

  it("generates the reminder as soon as the schedule is saved", async () => {
    // The write reconciles rather than waiting for the next boot — otherwise
    // turning a reminder on would appear to do nothing until a restart.
    vi.setSystemTime(new Date(2026, 11, 25, 12)); // a wish is day-of
    const core = createCore(driver);
    const person = await violet(core);

    await core.holidays.setObservanceSchedule(CHRISTMAS, "person", person.id, [
      { action: "wish", label: null, offsetDays: 0, enabled: true },
    ]);

    const titles = (await core.reminders.list())
      .filter((r) => r.source === "system")
      .map((r) => r.title ?? "");
    expect(titles.some((t) => t.includes("a Merry Christmas"))).toBe(true);
  });

  it("prunes the reminder when the rule is switched off", async () => {
    vi.setSystemTime(new Date(2026, 11, 1, 12));
    const core = createCore(driver);
    const person = await violet(core);
    await core.holidays.setObservanceSchedule(CHRISTMAS, "person", person.id, [
      { action: "wish", label: null, offsetDays: 0, enabled: true },
    ]);

    await core.holidays.setObservanceSchedule(CHRISTMAS, "person", person.id, [
      { action: "wish", label: null, offsetDays: 0, enabled: false },
    ]);

    const titles = (await core.reminders.list())
      .filter((r) => r.source === "system" && r.deletedAt === null)
      .map((r) => r.title ?? "");
    expect(titles.some((t) => t.includes("Christmas"))).toBe(false);
  });

  it("keeps two observers of one holiday on independent schedules", async () => {
    // The reason the rule bears on the observance rather than the holiday: one
    // person can want a gift reminder while another wants only a day-of call.
    // Christmas Day, so the day-of call is on display alongside the long-lead
    // gift, which has been on display for weeks.
    vi.setSystemTime(new Date(2026, 11, 25, 12));
    const core = createCore(driver);
    const person = await violet(core);
    const grandma = await core.people.create(
      { firstName: "Rose", lastName: "Fitz" },
      [],
    );
    await core.holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: person.id, observes: true },
      { bearerType: "person", bearerId: grandma.id, observes: true },
    ]);

    await core.holidays.setObservanceSchedule(CHRISTMAS, "person", person.id, [
      { action: "get:gift", label: null, offsetDays: 21, enabled: true },
    ]);
    await core.holidays.setObservanceSchedule(CHRISTMAS, "person", grandma.id, [
      { action: "call", label: null, offsetDays: 0, enabled: true },
    ]);

    const titles = (await core.reminders.list())
      .filter((r) => r.source === "system")
      .map((r) => r.title ?? "");
    expect(titles.some((t) => t.includes("Get") && t.includes("Violet"))).toBe(
      true,
    );
    expect(titles.some((t) => t.includes("Call") && t.includes("Rose"))).toBe(
      true,
    );
    // Violet gets no call, Rose gets no gift.
    expect(titles.some((t) => t.includes("Call") && t.includes("Violet"))).toBe(
      false,
    );
  });

  it("clearing the schedule falls back to the (all-off) defaults", async () => {
    const core = createCore(driver);
    const person = await violet(core);
    await core.holidays.setObservanceSchedule(CHRISTMAS, "person", person.id, [
      { action: "wish", label: null, offsetDays: 0, enabled: true },
    ]);

    await core.holidays.setObservanceSchedule(
      CHRISTMAS,
      "person",
      person.id,
      [],
    );

    const schedule = await core.holidays.getObservanceSchedule(
      CHRISTMAS,
      "person",
      person.id,
    );
    expect(schedule.every((r) => !r.enabled)).toBe(true);
  });
});
