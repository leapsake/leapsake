import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
  seedHolidayCatalog,
} from "@leapsake/core";
import { holidayIdFor } from "@leapsake/data";
import { type CivilDate, reminderLabel, todayCivil } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let core: CoreApi;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  // The bundled catalog: an occasion can point at a holiday, so these tests need
  // real holiday rows to point at (and to observe).
  await seedHolidayCatalog({ driver });
  core = createCore(driver);
});

afterEach(() => {
  cleanup();
});

describe("core.gifts.ideas", () => {
  it("creates, lists, updates, and removes a gift idea", async () => {
    expect(await core.gifts.ideas.list()).toEqual([]);

    const created = await core.gifts.ideas.create({
      title: "Red Ryder BB Gun",
      url: "https://example.com/bb-gun",
    });
    expect(created.title).toBe("Red Ryder BB Gun");
    expect(created.url).toBe("https://example.com/bb-gun");
    expect(created.notes).toBeNull();

    expect(await core.gifts.ideas.get(created.id)).toEqual(created);
    expect((await core.gifts.ideas.list()).map((i) => i.id)).toEqual([
      created.id,
    ]);

    const updated = await core.gifts.ideas.update(created.id, {
      notes: "the 200-shot model",
    });
    expect(updated?.notes).toBe("the 200-shot model");

    await core.gifts.ideas.softDelete(created.id);
    expect(await core.gifts.ideas.get(created.id)).toBeUndefined();
    expect(await core.gifts.ideas.list()).toEqual([]);
  });

  it("lists ideas newest-first", async () => {
    const socks = await core.gifts.ideas.create({ title: "Socks" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const scarf = await core.gifts.ideas.create({ title: "Scarf" });

    expect((await core.gifts.ideas.list()).map((i) => i.title)).toEqual([
      "Scarf",
      "Socks",
    ]);
    expect(scarf.createdAt).toBeGreaterThanOrEqual(socks.createdAt);
  });
});

/** Create a Person and return its id. */
async function makePerson(name: string): Promise<string> {
  const person = await core.people.create(
    { firstName: name, middleName: null, lastName: "X", gender: null },
    [],
  );
  return person.id;
}

describe("core.gifts.suggestions", () => {
  it("suggestFor mints the idea and suggestions in one call, joined for the recipient", async () => {
    const alice = await makePerson("Alice");
    const idea = await core.gifts.ideas.create({
      title: "BB Gun",
      suggestFor: [{ recipientType: "person", recipientId: alice }],
    });

    const forAlice = await core.gifts.suggestions.listForRecipient(
      "person",
      alice,
    );
    expect(forAlice).toHaveLength(1);
    expect(forAlice[0]?.giftIdeaId).toBe(idea.id);
    expect(forAlice[0]?.ideaTitle).toBe("BB Gun");
    expect(forAlice[0]?.occasionLabel).toBeNull();
  });

  it("joins listForIdea with the recipient's current label", async () => {
    const alice = await makePerson("Alice");
    const idea = await core.gifts.ideas.create({ title: "Scarf" });
    await core.gifts.suggestions.create({
      giftIdeaId: idea.id,
      recipientType: "person",
      recipientId: alice,
    });

    const forIdea = await core.gifts.suggestions.listForIdea(idea.id);
    expect(forIdea).toHaveLength(1);
    expect(forIdea[0]?.recipientLabel).toBe("Alice X");
  });

  it("resolves a milestone occasion to its label", async () => {
    const alice = await makePerson("Alice");
    const birthday = await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: alice,
      month: 6,
      day: 1,
    });
    const idea = await core.gifts.ideas.create({ title: "Cake" });
    await core.gifts.suggestions.create({
      giftIdeaId: idea.id,
      recipientType: "person",
      recipientId: alice,
      occasion: { type: "milestone", id: birthday.id },
      targetDate: { year: 2026, month: 6, day: 1 },
    });

    const [s] = await core.gifts.suggestions.listForRecipient("person", alice);
    expect(s?.occasionLabel).toBe("Birthday");
    expect(s?.targetYear).toBe(2026);
  });

  it("cascades: deleting the idea removes its suggestions", async () => {
    const alice = await makePerson("Alice");
    const idea = await core.gifts.ideas.create({
      title: "Socks",
      suggestFor: [{ recipientType: "person", recipientId: alice }],
    });
    await core.gifts.ideas.softDelete(idea.id);
    expect(
      await core.gifts.suggestions.listForRecipient("person", alice),
    ).toEqual([]);
  });

  it("cascades: deleting the recipient removes their suggestions", async () => {
    const alice = await makePerson("Alice");
    const idea = await core.gifts.ideas.create({
      title: "Socks",
      suggestFor: [{ recipientType: "person", recipientId: alice }],
    });
    await core.people.softDelete(alice);
    expect(await core.gifts.suggestions.listForIdea(idea.id)).toEqual([]);
  });

  it("repoints a loser's suggestions onto the survivor on merge", async () => {
    const alice = await makePerson("Alice");
    const bob = await makePerson("Bob");
    const idea = await core.gifts.ideas.create({
      title: "Socks",
      suggestFor: [{ recipientType: "person", recipientId: bob }],
    });

    await core.people.merge(alice, bob); // survivor=alice, loser=bob

    expect(
      await core.gifts.suggestions.listForRecipient("person", bob),
    ).toEqual([]);
    const moved = await core.gifts.suggestions.listForRecipient(
      "person",
      alice,
    );
    expect(moved.map((s) => s.giftIdeaId)).toEqual([idea.id]);
  });
});

describe("core.gifts.given", () => {
  it("logs a giving against an existing idea, joined for the recipient", async () => {
    const alice = await makePerson("Alice");
    const self = await makePerson("Me");
    await core.self.set(self);
    const idea = await core.gifts.ideas.create({ title: "BB Gun" });

    const gift = await core.gifts.given.create({
      giftIdea: { id: idea.id },
      recipient: { type: "person", id: alice },
      giver: { type: "person", id: self },
      date: { year: 1941, month: 12, day: 25 },
    });
    expect(gift.giftIdeaId).toBe(idea.id);

    const [row] = await core.gifts.given.listForRecipient("person", alice);
    expect(row?.ideaTitle).toBe("BB Gun");
    expect(row?.giverLabel).toBe("Me X");
    expect(row?.year).toBe(1941);
  });

  it("mints a new idea in the same transaction when logging a giving", async () => {
    const alice = await makePerson("Alice");
    expect(await core.gifts.ideas.list()).toHaveLength(0);

    await core.gifts.given.create({
      giftIdea: { title: "Homemade jam" },
      recipient: { type: "person", id: alice },
    });

    const ideas = await core.gifts.ideas.list();
    expect(ideas.map((i) => i.title)).toEqual(["Homemade jam"]);
    const [row] = await core.gifts.given.listForRecipient("person", alice);
    expect(row?.giverLabel).toBeNull(); // no giver given ⇒ unknown
  });

  it("rejects logging a giving against a missing idea id", async () => {
    const alice = await makePerson("Alice");
    await expect(
      core.gifts.given.create({
        giftIdea: { id: crypto.randomUUID() },
        recipient: { type: "person", id: alice },
      }),
    ).rejects.toThrow(/gift idea not found/);
  });

  it("deleting the idea cascades to its gifts", async () => {
    const alice = await makePerson("Alice");
    const idea = await core.gifts.ideas.create({ title: "Socks" });
    await core.gifts.given.create({
      giftIdea: { id: idea.id },
      recipient: { type: "person", id: alice },
    });
    await core.gifts.ideas.softDelete(idea.id);
    expect(await core.gifts.given.listForRecipient("person", alice)).toEqual(
      [],
    );
  });

  it("deleting a recipient cascades to their gifts", async () => {
    const alice = await makePerson("Alice");
    await core.gifts.given.create({
      giftIdea: { title: "Socks" },
      recipient: { type: "person", id: alice },
    });
    await core.people.softDelete(alice);
    // Re-created probe recipient to prove the store isn't globally empty would be
    // overkill; the delete cascade is asserted directly by the repo test.
    expect(await core.gifts.given.listForRecipient("person", alice)).toEqual(
      [],
    );
  });

  it("repoints gifts on merge and drops a self-referential result", async () => {
    const alice = await makePerson("Alice");
    const bob = await makePerson("Bob");
    // Alice gave Bob a gift → after merging Bob into Alice it's Alice→Alice, dropped.
    await core.gifts.given.create({
      giftIdea: { title: "Book" },
      recipient: { type: "person", id: bob },
      giver: { type: "person", id: alice },
    });
    await core.people.merge(alice, bob); // survivor=alice, loser=bob
    expect(await core.gifts.given.listForRecipient("person", alice)).toEqual(
      [],
    );
  });
});

describe("core.gifts.capture (the consolidated create)", () => {
  it("with no recipients, just creates the idea", async () => {
    await core.gifts.capture({ giftIdea: { title: "Socks" }, recipients: [] });
    expect((await core.gifts.ideas.list()).map((i) => i.title)).toEqual([
      "Socks",
    ]);
  });

  it("with recipients and no givings, creates a suggestion each", async () => {
    const alice = await makePerson("Alice");
    const bob = await makePerson("Bob");
    await core.gifts.capture({
      giftIdea: { title: "Scarf" },
      recipients: [
        { party: { type: "person", id: alice } },
        { party: { type: "person", id: bob } },
      ],
    });
    expect(
      await core.gifts.suggestions.listForRecipient("person", alice),
    ).toHaveLength(1);
    expect(
      await core.gifts.suggestions.listForRecipient("person", bob),
    ).toHaveLength(1);
    expect(await core.gifts.given.listForRecipient("person", alice)).toEqual(
      [],
    );
  });

  it("attaches givings to their own recipient, not to every recipient", async () => {
    const alice = await makePerson("Alice");
    const bob = await makePerson("Bob");
    const me = await makePerson("Me");
    await core.self.set(me);

    // Alice gets two dated givings; Bob gets none (just a suggestion).
    await core.gifts.capture({
      giftIdea: { title: "BB Gun" },
      recipients: [
        {
          party: { type: "person", id: alice },
          givings: [{ date: { year: 1941 } }, { date: { year: 1942 } }],
        },
        { party: { type: "person", id: bob } },
      ],
    });

    const aliceGifts = await core.gifts.given.listForRecipient("person", alice);
    expect(aliceGifts).toHaveLength(2);
    expect(aliceGifts.every((g) => g.giverLabel === "Me X")).toBe(true);
    // Bob got a suggestion and NO gift — the dates were Alice's alone.
    expect(await core.gifts.given.listForRecipient("person", bob)).toEqual([]);
    expect(
      await core.gifts.suggestions.listForRecipient("person", bob),
    ).toHaveLength(1);
    // Two givings of one idea mint exactly one idea, not two.
    expect(await core.gifts.ideas.list()).toHaveLength(1);
    // Alice's dated entry is a giving, not a suggestion.
    expect(
      await core.gifts.suggestions.listForRecipient("person", alice),
    ).toEqual([]);
  });

  it("falls back to an unknown giver when the recipient is the self-person", async () => {
    const me = await makePerson("Me");
    await core.self.set(me);
    // Logging a gift to yourself: giver would be you == recipient, which the
    // schema forbids, so it records an unknown giver instead of throwing.
    await core.gifts.capture({
      giftIdea: { title: "Treat" },
      recipients: [
        {
          party: { type: "person", id: me },
          givings: [{ date: { year: 2026 } }],
        },
      ],
    });
    const [g] = await core.gifts.given.listForRecipient("person", me);
    expect(g?.giverLabel).toBeNull();
  });

  it("carries the suggestion arm's occasion and target date onto the candidate", async () => {
    const alice = await makePerson("Alice");
    const christmas = holidayIdFor("christmas");
    await core.gifts.capture({
      giftIdea: { title: "Scarf" },
      recipients: [
        {
          party: { type: "person", id: alice },
          suggestion: {
            occasion: { type: "holiday", id: christmas },
            targetDate: { year: 2026, month: 12, day: 25 },
          },
        },
      ],
    });

    const [s] = await core.gifts.suggestions.listForRecipient("person", alice);
    expect(s?.occasionType).toBe("holiday");
    expect(s?.occasionId).toBe(christmas);
    expect(s?.occasionLabel).toBe("Christmas");
    expect([s?.targetYear, s?.targetMonth, s?.targetDay]).toEqual([
      2026, 12, 25,
    ]);
  });

  it("ignores the suggestion arm when the recipient has givings", async () => {
    const alice = await makePerson("Alice");
    // Givings win: this recipient is a fact, not a candidate, so nothing reads
    // the suggestion adornments and no suggestion row is written at all.
    await core.gifts.capture({
      giftIdea: { title: "Scarf" },
      recipients: [
        {
          party: { type: "person", id: alice },
          givings: [{ date: { year: 1941 } }],
          suggestion: { targetDate: { year: 2026 } },
        },
      ],
    });

    expect(
      await core.gifts.suggestions.listForRecipient("person", alice),
    ).toEqual([]);
    const [g] = await core.gifts.given.listForRecipient("person", alice);
    expect(g?.year).toBe(1941);
  });

  it("reuses an existing idea by id rather than minting a duplicate", async () => {
    const alice = await makePerson("Alice");
    const idea = await core.gifts.ideas.create({ title: "Scarf" });
    await core.gifts.capture({
      giftIdea: { id: idea.id },
      recipients: [{ party: { type: "person", id: alice } }],
    });
    expect(await core.gifts.ideas.list()).toHaveLength(1);
    const [s] = await core.gifts.suggestions.listForRecipient("person", alice);
    expect(s?.giftIdeaId).toBe(idea.id);
  });
});

/**
 * The occasion pool a gift form's picker draws from. Narrow by
 * design: the recipient's own milestones plus the holidays they observe — never
 * the whole catalog, which would offer "Christmas" to someone who doesn't keep it.
 */
describe("core.gifts.occasionsFor", () => {
  it("offers the party's own milestones and the holidays they observe", async () => {
    const alice = await makePerson("Alice");
    await core.milestones.create({
      bearerType: "person",
      bearerId: alice,
      kind: "birthday",
      year: 1990,
      month: 3,
      day: 9,
      note: null,
    });
    const christmas = holidayIdFor("christmas");
    await core.holidays.setObservers(christmas, [
      { bearerType: "person", bearerId: alice, observes: true },
    ]);

    const options = await core.gifts.occasionsFor("person", alice);
    expect(options).toEqual([
      { type: "milestone", id: expect.any(String), label: "Birthday" },
      { type: "holiday", id: christmas, label: "Christmas" },
    ]);
  });

  it("omits holidays the party doesn't observe", async () => {
    const bob = await makePerson("Bob");
    const options = await core.gifts.occasionsFor("person", bob);
    expect(options.filter((o) => o.type === "holiday")).toEqual([]);
  });

  it("labels an occasion the way the row reads it back", async () => {
    // The picker's label and `resolveOccasionLabel`'s must agree, or picking
    // "Birthday" would render as something else on the saved row.
    const alice = await makePerson("Alice");
    const milestone = await core.milestones.create({
      bearerType: "person",
      bearerId: alice,
      kind: "other",
      year: null,
      month: 6,
      day: 1,
      note: "Graduation",
    });
    const idea = await core.gifts.ideas.create({ title: "Pen" });
    await core.gifts.suggestions.create({
      giftIdeaId: idea.id,
      recipientType: "person",
      recipientId: alice,
      occasion: { type: "milestone", id: milestone.id },
    });

    const [option] = await core.gifts.occasionsFor("person", alice);
    const [suggestion] = await core.gifts.suggestions.listForRecipient(
      "person",
      alice,
    );
    expect(option?.label).toBe(suggestion?.occasionLabel);
  });
});

/**
 * The reverse fill: an occasion + a year resolves back to a
 * date, so "Christmas 1941" can fill in Dec 25 without the user counting.
 */
describe("core.holidays.occurrencesIn", () => {
  it("resolves a fixed holiday's date in a given year", async () => {
    expect(
      await core.holidays.occurrencesIn(holidayIdFor("christmas"), 1941),
    ).toEqual(["1941-12-25"]);
  });

  it("resolves a computed holiday's date in a given year", async () => {
    expect(
      await core.holidays.occurrencesIn(holidayIdFor("us-mothers-day"), 2026),
    ).toEqual(["2026-05-10"]);
  });

  it("returns nothing for an unknown holiday", async () => {
    expect(
      await core.holidays.occurrencesIn(holidayIdFor("nope"), 2026),
    ).toEqual([]);
  });
});

describe("core.gifts.overview (the Gifts screen, keyed by idea)", () => {
  it("returns each idea with its suggestions and givings joined", async () => {
    const alice = await makePerson("Alice");
    const bob = await makePerson("Bob");
    const me = await makePerson("Me");
    await core.self.set(me);

    // One idea suggested for Alice and Bob, and given to Alice.
    await core.gifts.capture({
      giftIdea: { title: "BB Gun" },
      recipients: [
        { party: { type: "person", id: alice } },
        { party: { type: "person", id: bob } },
      ],
    });
    await core.gifts.capture({
      giftIdea: { title: "BB Gun" }, // exact-title reuse isn't core's job; new call
      recipients: [
        {
          party: { type: "person", id: alice },
          givings: [{ date: { year: 1941 } }],
        },
      ],
    });

    const overview = await core.gifts.overview();
    const bbGun = overview.filter((o) => o.idea.title === "BB Gun");
    // Two ideas were minted (core doesn't dedupe by title); find the suggested one.
    const suggested = bbGun.find((o) => o.suggestions.length > 0);
    expect(suggested?.suggestions.map((s) => s.recipientLabel).sort()).toEqual([
      "Alice X",
      "Bob X",
    ]);
    const given = bbGun.find((o) => o.gifts.length > 0);
    expect(given?.gifts[0]?.recipientLabel).toBe("Alice X");
    expect(given?.gifts[0]?.giverLabel).toBe("Me X");
  });

  it("lists an idea with no suggestions or gifts (a bare idea)", async () => {
    await core.gifts.ideas.create({ title: "Socks" });
    const overview = await core.gifts.overview();
    expect(overview).toHaveLength(1);
    expect(overview[0]?.idea.title).toBe("Socks");
    expect(overview[0]?.suggestions).toEqual([]);
    expect(overview[0]?.gifts).toEqual([]);
  });
});

/**
 * Tags on gift ideas: `gift_idea` joined
 * `tagBearerTypeSchema` as one more bearer, so an idea list stays browsable once
 * it's long. The tag set rides the idea's create/update the way a Person's does.
 */
describe("core.gifts.ideas — tags", () => {
  it("saves an idea's tags with the idea itself", async () => {
    const idea = await core.gifts.ideas.create({ title: "Wool socks" }, [
      "stocking",
      "warm",
    ]);
    expect(
      (await core.tags.listForGiftIdea(idea.id)).map((t) => t.name).sort(),
    ).toEqual(["stocking", "warm"]);
  });

  it("replaces the whole set on update, and clears it with an empty list", async () => {
    const idea = await core.gifts.ideas.create({ title: "Wool socks" }, [
      "stocking",
    ]);

    await core.gifts.ideas.update(idea.id, {}, ["warm"]);
    expect(
      (await core.tags.listForGiftIdea(idea.id)).map((t) => t.name),
    ).toEqual(["warm"]);

    await core.gifts.ideas.update(idea.id, {}, []);
    expect(await core.tags.listForGiftIdea(idea.id)).toEqual([]);
  });

  it("leaves the tags alone when an update doesn't mention them", async () => {
    // The distinction that makes the argument optional: renaming an idea must
    // not silently drop its tags, while `[]` still means "clear them".
    const idea = await core.gifts.ideas.create({ title: "Wool socks" }, [
      "warm",
    ]);
    const renamed = await core.gifts.ideas.update(idea.id, {
      title: "Merino socks",
    });
    expect(renamed?.title).toBe("Merino socks");
    expect(
      (await core.tags.listForGiftIdea(idea.id)).map((t) => t.name),
    ).toEqual(["warm"]);
  });

  it("lists tagged ideas on the tag's own page", async () => {
    const socks = await core.gifts.ideas.create({ title: "Wool socks" }, [
      "stocking",
    ]);
    await core.gifts.ideas.create({ title: "Sled" }, ["outdoors"]);
    const [tag] = await core.tags.listForGiftIdea(socks.id);

    expect(
      (await core.tags.giftIdeasForTag(tag.id)).map((i) => i.title),
    ).toEqual(["Wool socks"]);
  });

  it("shares one tag across an idea and a person", async () => {
    // The whole point of a shared tag: the same "#books" reaches both.
    const person = await makePerson("Alice");
    await core.people.update(person, {}, ["books"]);
    const idea = await core.gifts.ideas.create({ title: "Dune" }, ["books"]);
    const [tag] = await core.tags.listForGiftIdea(idea.id);

    expect((await core.tags.peopleForTag(tag.id)).map((p) => p.id)).toEqual([
      person,
    ]);
    expect((await core.tags.giftIdeasForTag(tag.id)).map((i) => i.id)).toEqual([
      idea.id,
    ]);
  });

  it("carries the tags into the Gifts-screen overview", async () => {
    await core.gifts.ideas.create({ title: "Wool socks" }, ["stocking"]);
    const [row] = await core.gifts.overview();
    expect(row?.tags.map((t) => t.name)).toEqual(["stocking"]);
  });

  it("removes the taggings when the idea is deleted, GCing an orphaned tag", async () => {
    const idea = await core.gifts.ideas.create({ title: "Wool socks" }, [
      "stocking",
    ]);
    const [tag] = await core.tags.listForGiftIdea(idea.id);

    await core.gifts.ideas.softDelete(idea.id);
    expect(await core.tags.listForGiftIdea(idea.id)).toEqual([]);
    expect(await core.tags.giftIdeasForTag(tag.id)).toEqual([]);
    // Its last bearer gone, the tag itself is garbage-collected.
    expect(await core.tags.get(tag.id)).toBeUndefined();
  });
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

/**
 * The reminder loop: the `🎁 gift` action has
 * always minted "Get @Alice a gift"; `giftTargets` is what tells a client which
 * reminders those are and who they're for, so it can link to the recipient's
 * gifts and — once done — to logging what was given.
 */
describe("core.reminders.giftTargets", () => {
  /** A person with a birthday `days` out whose schedule turns the gift action on. */
  async function personWithGiftReminder(days: number, name: string) {
    const person = await core.people.create(
      { firstName: name, middleName: null, lastName: "X", gender: null },
      [],
    );
    const occ = civilDaysFromToday(days);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: person.id,
      year: null,
      month: occ.month,
      day: occ.day,
      reminderSchedule: [
        { action: "gift", label: null, offsetDays: 30, enabled: true },
        { action: "wish", label: null, offsetDays: 0, enabled: true },
      ],
    });
    return person.id;
  }

  it("names the gift reminder and its recipient", async () => {
    const alice = await personWithGiftReminder(20, "Alice");

    const targets = await core.reminders.giftTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      recipientType: "person",
      recipientId: alice,
    });

    // The named reminder is the gift one — not the birthday wish beside it.
    const reminder = await core.reminders.get(targets[0].reminderId);
    expect(reminderLabel(reminder!)).toBe("🎁 Get @Alice X a gift");
  });

  it("excludes the wish reminder minted alongside it", async () => {
    await personWithGiftReminder(20, "Alice");
    const targets = await core.reminders.giftTargets();
    const labels = await Promise.all(
      targets.map(async (t) =>
        reminderLabel((await core.reminders.get(t.reminderId))!),
      ),
    );
    expect(labels).toEqual(["🎁 Get @Alice X a gift"]);
  });

  it("keeps naming the reminder once it's completed, so the giving can be logged", async () => {
    const alice = await personWithGiftReminder(20, "Alice");
    const [target] = await core.reminders.giftTargets();
    await core.reminders.setCompleted(target.reminderId, true);

    const after = await core.reminders.giftTargets();
    expect(after).toEqual([
      {
        reminderId: target.reminderId,
        recipientType: "person",
        recipientId: alice,
      },
    ]);
  });

  it("returns nothing when no gift action is enabled", async () => {
    // The birthday kind defaults leave gift off — only the day-of wish is on.
    const person = await core.people.create(
      { firstName: "Bea", middleName: null, lastName: "X", gender: null },
      [],
    );
    const occ = civilDaysFromToday(10);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: person.id,
      year: null,
      month: occ.month,
      day: occ.day,
    });
    expect(await core.reminders.giftTargets()).toEqual([]);
  });

  it("hands the recipient to a giving that closes the loop", async () => {
    // What the completed-reminder CTA does: capture a gift for the named
    // recipient, which then reads back on their page as a logged giving.
    const alice = await personWithGiftReminder(20, "Alice");
    const [target] = await core.reminders.giftTargets();

    await core.gifts.capture({
      giftIdea: { title: "Scarf" },
      recipients: [
        {
          party: { type: target.recipientType, id: target.recipientId },
          givings: [{ date: { year: 2026, month: 3, day: 9 } }],
        },
      ],
    });

    const given = await core.gifts.given.listForRecipient("person", alice);
    expect(given.map((g) => g.ideaTitle)).toEqual(["Scarf"]);
  });
});
