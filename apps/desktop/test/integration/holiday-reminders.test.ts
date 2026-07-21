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
import { deterministicUuid } from "@leapsake/crypto";
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
    // inside its lead window — so these tests pin "today" rather than depending
    // on the calendar the suite happens to run on. Only `Date` is faked; faking
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
    const alice = await core.people.create(
      { firstName: "Alice", lastName: "Chen" },
      [],
    );
    await core.holidays.setObservers(holidayId, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);
    await createReminderRulesRepo(driver).replaceForBearer(
      "observance",
      observanceIdFor(holidayId, "person", alice.id),
      [{ action: "wish", offsetDays: 0, enabled: true }],
    );
    return { core, alice };
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
    today(2026, 12, 1);
    const { core, alice } = await aliceObserving(CHRISTMAS);
    await core.reminders.regenerateSystem();

    const titles = await systemTitles(core);
    expect(titles.some((t) => t.includes("a Merry Christmas"))).toBe(true);
    // …and it mentions the person, so the reminder links back to them.
    expect(titles.some((t) => t.includes(`person:${alice.id}`))).toBe(true);
    // Never the birthday copy the `wish` action used to hard-code.
    expect(titles.some((t) => t.includes("happy birthday"))).toBe(false);
  });

  it("generates nothing until a rule is enabled", async () => {
    // The default an observance rides. Deliberately quieter than a birthday's:
    // every Christmas observance comes due on the same day, so a default-on wish
    // would surface one reminder per person all at once.
    today(2026, 12, 1);
    const core = createCore(driver);
    const alice = await core.people.create(
      { firstName: "Alice", lastName: "Chen" },
      [],
    );
    await core.holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);
    await core.reminders.regenerateSystem();

    expect(
      (await systemTitles(core)).some((t) => t.includes("Christmas")),
    ).toBe(false);
  });

  it("generates nothing for an explicit non-observer", async () => {
    const core = createCore(driver);
    const bob = await core.people.create(
      { firstName: "Bob", lastName: "Smith" },
      [],
    );
    await core.holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: bob.id, observes: false },
    ]);
    await core.reminders.regenerateSystem();

    expect(await systemTitles(core)).not.toContainEqual(
      expect.stringContaining("Christmas"),
    );
  });

  it("suppresses reminders for a hidden holiday, and restores on unhide", async () => {
    // The behaviour §2.6 insists on: hiding has to reach the reminder engine,
    // not just browse surfaces, or "I hid Mother's Day" still produces "Wish
    // @Alice a Happy Mother's Day".
    today(2027, 4, 20); // Mother's Day 2027 is 9 May — 19 days out.
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
    today(2026, 12, 1);
    const { core, alice } = await aliceObserving(CHRISTMAS);
    const observanceId = observanceIdFor(CHRISTMAS, "person", alice.id);

    await createReminderRulesRepo(driver).replaceForBearer(
      "observance",
      observanceId,
      [{ action: "card", offsetDays: 7, enabled: true }],
    );
    await core.reminders.regenerateSystem();

    const titles = await systemTitles(core);
    expect(titles.some((t) => t.includes("a card"))).toBe(true);
    expect(titles.some((t) => t.includes("a Merry Christmas"))).toBe(false);
  });

  it("prunes a holiday reminder once the observance is withdrawn", async () => {
    today(2026, 12, 1);
    const { core, alice } = await aliceObserving(CHRISTMAS);
    await core.reminders.regenerateSystem();
    expect(
      (await systemTitles(core)).some((t) => t.includes("Christmas")),
    ).toBe(true);

    await core.holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: false },
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
    const alice = await core.people.create(
      { firstName: "Alice", lastName: "Chen" },
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
      alice.id,
      true,
    );

    await expect(core.reminders.regenerateSystem()).resolves.toBeDefined();
    expect((await systemTitles(core)).some((t) => t.includes("Future"))).toBe(
      false,
    );
  });

  it("is idempotent — a second reconcile changes nothing", async () => {
    today(2026, 12, 1);
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
      "onboarding:add-first-person",
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
