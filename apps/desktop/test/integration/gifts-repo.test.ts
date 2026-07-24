import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type GiftsRepo,
  type SqliteDriver,
  createGiftsRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: GiftsRepo;

const ideaId = crypto.randomUUID();
const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
const carol = crypto.randomUUID();

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createGiftsRepo(driver);
});

afterEach(() => {
  cleanup();
});

describe("giftsRepo", () => {
  it("creates a bare gift with a null (unknown) giver", async () => {
    const g = await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: alice },
    });
    expect(g.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(g.giftIdeaId).toBe(ideaId);
    expect(g.giverType).toBeNull();
    expect(g.giverId).toBeNull();
    expect(g.recipientType).toBe("person");
    expect(g.recipientId).toBe(alice);
    expect(g.year).toBeNull();
    expect(g.deletedAt).toBeNull();
  });

  it("flattens a giver, what-happened date, and occasion onto columns", async () => {
    const occasionId = crypto.randomUUID();
    const g = await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: alice },
      giver: { type: "person", id: bob },
      date: { year: 1941, month: 12, day: 25 },
      occasion: { type: "holiday", id: occasionId },
    });
    expect(g.giverType).toBe("person");
    expect(g.giverId).toBe(bob);
    expect(g.year).toBe(1941);
    expect(g.month).toBe(12);
    expect(g.day).toBe(25);
    expect(g.occasionType).toBe("holiday");
    expect(g.occasionId).toBe(occasionId);
  });

  it("lists by recipient and by giver, excluding soft-deleted rows", async () => {
    const g = await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: alice },
      giver: { type: "person", id: bob },
    });
    expect(
      (await repo.listForRecipient("person", alice)).map((r) => r.id),
    ).toEqual([g.id]);
    expect((await repo.listForGiver("person", bob)).map((r) => r.id)).toEqual([
      g.id,
    ]);

    await repo.softDelete(g.id);
    expect(await repo.listForRecipient("person", alice)).toEqual([]);
    expect(await repo.listForGiver("person", bob)).toEqual([]);
  });

  it("orders gifts newest-happened-first (undated last)", async () => {
    const undated = await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: alice },
    });
    const older = await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: alice },
      date: { year: 1990 },
    });
    const newer = await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: alice },
      date: { year: 2020 },
    });
    expect(
      (await repo.listForRecipient("person", alice)).map((r) => r.id),
    ).toEqual([newer.id, older.id, undated.id]);
  });

  it("updates giver/date/occasion and clears them to null", async () => {
    const g = await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: alice },
      giver: { type: "person", id: bob },
      date: { year: 1941 },
    });
    const cleared = await repo.update(g.id, { giver: null, date: null });
    expect(cleared?.giverType).toBeNull();
    expect(cleared?.giverId).toBeNull();
    expect(cleared?.year).toBeNull();
  });

  it("removes all gifts where the party is giver OR recipient", async () => {
    await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: alice },
      giver: { type: "person", id: bob },
    });
    await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: bob },
      giver: { type: "person", id: carol },
    });
    // bob is a recipient of one and a giver of the other — both go.
    await repo.removeAllForParty("person", bob);
    expect(await repo.listForRecipient("person", alice)).toEqual([]);
    expect(await repo.listForRecipient("person", bob)).toEqual([]);
  });

  it("removes all gifts of an idea", async () => {
    await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: alice },
    });
    await repo.removeAllForIdea(ideaId);
    expect(await repo.listForRecipient("person", alice)).toEqual([]);
  });

  it("repoints a party (as giver and recipient) and drops self-referential gifts", async () => {
    // A gift Alice gave Bob; after merging Bob→Alice it would be Alice→Alice.
    await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: bob },
      giver: { type: "person", id: alice },
    });
    // A gift Carol gave Bob; after the merge it's Carol→Alice (kept).
    const keep = await repo.create({
      giftIdeaId: ideaId,
      recipient: { type: "person", id: bob },
      giver: { type: "person", id: carol },
    });

    await repo.repointParty("person", bob, alice); // merge Bob into Alice

    const forAlice = await repo.listForRecipient("person", alice);
    // The self-referential Alice→Alice gift was dropped; only Carol→Alice remains.
    expect(forAlice.map((r) => r.id)).toEqual([keep.id]);
    expect(forAlice[0]?.giverId).toBe(carol);
    expect(forAlice[0]?.recipientId).toBe(alice);
  });
});
