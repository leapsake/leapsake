import { createCore, seedHolidayCatalog } from "@leapsake/core";
import { holidayIdFor, runMigrations } from "@leapsake/data";
import type { SqliteDriver } from "@leapsake/data";
import type { CreatePersonInput } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

const HALLOWEEN = holidayIdFor("us-halloween");
const CHRISTMAS = holidayIdFor("christmas");
const VETERANS_DAY = holidayIdFor("us-veterans-day");

let driver: SqliteDriver;
let cleanup: () => void;
let core: ReturnType<typeof createCore>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  await seedHolidayCatalog({ driver });
  core = createCore(driver, { phoneRegion: "US" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function today(year: number, month: number, day: number) {
  vi.setSystemTime(new Date(year, month - 1, day, 12));
}

function person(input: CreatePersonInput) {
  return core.people.create(input, []);
}

async function you() {
  const george = await person({ firstName: "George", lastName: "Bailey" });
  await core.self.set(george.id);
  return george;
}

/** Every holiday question on Home. */
async function questions() {
  await core.reminders.regenerateSystem();
  return (await core.reminders.list())
    .filter((r) => r.source === "system")
    .map((r) => r.title ?? "")
    .filter((title) => title.startsWith("🗓 What do you want to do for"));
}

describe("when a holiday asks", () => {
  it("asks about Halloween in late September", async () => {
    today(2026, 9, 25);
    await you();
    expect(await questions()).toEqual([
      "🗓 What do you want to do for Halloween?",
    ]);
  });

  it("doesn't ask yet in mid-September", async () => {
    today(2026, 9, 15);
    await you();
    expect(await questions()).toEqual([]);
  });

  it("doesn't ask with nothing to suggest, wish or keep", async () => {
    today(2026, 10, 25);
    await you();
    const prompts = await core.holidays.prompts();
    expect(prompts.map((p) => p.holidayId)).not.toContain(VETERANS_DAY);
  });

  it("asks about Christmas when someone is wished by default", async () => {
    today(2026, 12, 10);
    await you();
    await person({ firstName: "Mary", lastName: "Hatch" });
    expect(await questions()).toContain(
      "🗓 What do you want to do for Christmas?",
    );
  });

  it("doesn't ask about a hidden holiday", async () => {
    today(2026, 9, 25);
    await you();
    await core.holidays.setHidden(HALLOWEEN, true);
    expect(await questions()).toEqual([]);
  });

  it("stops asking once told not to, and asks again when told to", async () => {
    today(2026, 9, 25);
    await you();
    await core.holidays.setAsked(HALLOWEEN, false);
    expect(await questions()).toEqual([]);
    expect((await core.holidays.get(HALLOWEEN))?.asked).toBe(false);

    await core.holidays.setAsked(HALLOWEEN, true);
    expect((await core.holidays.get(HALLOWEEN))?.asked).toBe(true);
    expect(await core.holidays.prompts()).not.toEqual([]);
  });
});

describe("what a holiday's question offers", () => {
  it("offers your errands and a wish for everyone else who keeps it", async () => {
    today(2026, 9, 25);
    await you();
    await person({ firstName: "Mary", lastName: "Hatch" });

    const prompt = await core.holidays.prompt(HALLOWEEN, "2026-10-31");
    expect(prompt?.errands.map((e) => [e.label, e.enabled])).toEqual([
      ["Plan a costume", false],
      ["Buy candy for trick-or-treaters", false],
    ]);
    expect(prompt?.wishes.map((w) => [w.label, w.wish])).toEqual([
      ["Mary Hatch", false],
    ]);
  });

  it("never puts you on your own wish list", async () => {
    today(2026, 12, 10);
    const george = await you();
    await person({ firstName: "Mary", lastName: "Hatch" });
    const prompt = await core.holidays.prompt(CHRISTMAS, "2026-12-25");
    expect(prompt?.wishes.map((w) => [w.label, w.wish])).toEqual([
      ["Mary Hatch", true],
    ]);
    expect(prompt?.addable.map((a) => a.bearerId)).not.toContain(george.id);
  });

  it("offers only what still fits when it's late", async () => {
    today(2026, 10, 28);
    await you();
    await person({ firstName: "Mary", lastName: "Hatch" });
    const prompt = await core.holidays.prompt(HALLOWEEN, "2026-10-31");
    expect(prompt?.errands).toEqual([]);
    expect(prompt?.wishes).toHaveLength(1);
  });

  it("offers your errands before anyone is you, if your country keeps it", async () => {
    today(2026, 9, 25);
    const prompt = await core.holidays.prompt(HALLOWEEN, "2026-10-31");
    expect(prompt?.selfId).toBeNull();
    expect(prompt?.errands).toHaveLength(2);
  });
});

describe("answering a holiday's question", () => {
  it("schedules what's ticked and asks no more this year", async () => {
    today(2026, 9, 25);
    await you();
    const mary = await person({ firstName: "Mary", lastName: "Hatch" });
    const prompt = (await core.holidays.prompt(HALLOWEEN, "2026-10-31"))!;

    await core.holidays.answerPrompt(HALLOWEEN, "2026-10-31", {
      errands: prompt.errands.map((e) => ({
        ...e,
        enabled: e.label === "Plan a costume",
      })),
      wishes: [{ bearerType: "person", bearerId: mary.id, wish: true }],
    });

    expect(await questions()).toEqual([]);
    const marys = await core.holidays.getObservanceSchedule(
      HALLOWEEN,
      "person",
      mary.id,
    );
    expect(marys.find((r) => r.action === "wish")?.enabled).toBe(true);
    const observers = await core.holidays.listObservers(HALLOWEEN);
    expect(observers.find((o) => o.bearerId === mary.id)?.explicit).toBe(true);
  });

  it("ticks last year's answer next year", async () => {
    today(2026, 9, 25);
    await you();
    const prompt = (await core.holidays.prompt(HALLOWEEN, "2026-10-31"))!;
    await core.holidays.answerPrompt(HALLOWEEN, "2026-10-31", {
      errands: prompt.errands.map((e) => ({
        ...e,
        enabled: e.label === "Plan a costume",
      })),
      wishes: [],
    });

    const next = await core.holidays.prompt(HALLOWEEN, "2027-10-31");
    expect(next?.errands.map((e) => [e.label, e.enabled])).toEqual([
      ["Plan a costume", true],
      ["Buy candy for trick-or-treaters", false],
    ]);
  });

  it("adds someone to the wish line, who then keeps it", async () => {
    today(2026, 9, 25);
    await you();
    const jimmy = await core.pets.create({ name: "Jimmy" }, []);
    await core.holidays.answerPrompt(HALLOWEEN, "2026-10-31", {
      errands: [],
      wishes: [{ bearerType: "pet", bearerId: jimmy.id, wish: true }],
    });
    const observers = await core.holidays.listObservers(HALLOWEEN);
    expect(observers.find((o) => o.bearerId === jimmy.id)?.observes).toBe(true);
  });

  it("leaves someone's schedule alone when their tick is unchanged", async () => {
    today(2026, 12, 10);
    await you();
    const mary = await person({ firstName: "Mary", lastName: "Hatch" });
    await core.holidays.answerPrompt(CHRISTMAS, "2026-12-25", {
      errands: [],
      wishes: [{ bearerType: "person", bearerId: mary.id, wish: true }],
    });
    const observers = await core.holidays.listObservers(CHRISTMAS);
    expect(observers.find((o) => o.bearerId === mary.id)?.explicit).toBeNull();
  });

  it("asks who you are before an errand of yours", async () => {
    today(2026, 9, 25);
    const prompt = (await core.holidays.prompt(HALLOWEEN, "2026-10-31"))!;
    const ticked = prompt.errands.map((e) => ({ ...e, enabled: true }));
    await expect(
      core.holidays.answerPrompt(HALLOWEEN, "2026-10-31", {
        errands: ticked,
        wishes: [],
      }),
    ).rejects.toThrow();

    const george = await person({ firstName: "George", lastName: "Bailey" });
    await core.holidays.answerPrompt(
      HALLOWEEN,
      "2026-10-31",
      { errands: ticked, wishes: [] },
      george.id,
    );
    expect((await core.self.get())?.personId).toBe(george.id);
  });
});
