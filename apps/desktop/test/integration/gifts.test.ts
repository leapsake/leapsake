import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
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
