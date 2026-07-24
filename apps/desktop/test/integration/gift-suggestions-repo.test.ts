import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type GiftSuggestionsRepo,
  type SqliteDriver,
  createGiftSuggestionsRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: GiftSuggestionsRepo;

const ideaId = crypto.randomUUID();
const alice = crypto.randomUUID();
const bob = crypto.randomUUID();

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createGiftSuggestionsRepo(driver);
});

afterEach(() => {
  cleanup();
});

describe("giftSuggestionsRepo", () => {
  it("creates a bare suggestion with null adornments", async () => {
    const s = await repo.create({
      giftIdeaId: ideaId,
      recipientType: "person",
      recipientId: alice,
    });
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.giftIdeaId).toBe(ideaId);
    expect(s.recipientType).toBe("person");
    expect(s.recipientId).toBe(alice);
    expect(s.occasionType).toBeNull();
    expect(s.occasionId).toBeNull();
    expect(s.targetYear).toBeNull();
    expect(s.deletedAt).toBeNull();
  });

  it("flattens a nested occasion and target date onto row columns", async () => {
    const occasionId = crypto.randomUUID();
    const s = await repo.create({
      giftIdeaId: ideaId,
      recipientType: "person",
      recipientId: alice,
      occasion: { type: "holiday", id: occasionId },
      targetDate: { year: 2026, month: 12, day: 25 },
    });
    expect(s.occasionType).toBe("holiday");
    expect(s.occasionId).toBe(occasionId);
    expect(s.targetYear).toBe(2026);
    expect(s.targetMonth).toBe(12);
    expect(s.targetDay).toBe(25);
  });

  it("lists by recipient and by idea, excluding soft-deleted rows", async () => {
    const forAlice = await repo.create({
      giftIdeaId: ideaId,
      recipientType: "person",
      recipientId: alice,
    });
    const otherIdea = crypto.randomUUID();
    await repo.create({
      giftIdeaId: otherIdea,
      recipientType: "person",
      recipientId: bob,
    });

    expect(
      (await repo.listForRecipient("person", alice)).map((s) => s.id),
    ).toEqual([forAlice.id]);
    expect((await repo.listForIdea(ideaId)).map((s) => s.id)).toEqual([
      forAlice.id,
    ]);

    await repo.softDelete(forAlice.id);
    expect(await repo.listForRecipient("person", alice)).toEqual([]);
    expect(await repo.listForIdea(ideaId)).toEqual([]);
  });

  it("updates occasion/target date and clears them back to null", async () => {
    const s = await repo.create({
      giftIdeaId: ideaId,
      recipientType: "person",
      recipientId: alice,
    });
    const occasionId = crypto.randomUUID();
    const set = await repo.update(s.id, {
      occasion: { type: "milestone", id: occasionId },
      targetDate: { year: 2026 },
    });
    expect(set?.occasionType).toBe("milestone");
    expect(set?.occasionId).toBe(occasionId);
    expect(set?.targetYear).toBe(2026);

    const cleared = await repo.update(s.id, {
      occasion: null,
      targetDate: null,
    });
    expect(cleared?.occasionType).toBeNull();
    expect(cleared?.occasionId).toBeNull();
    expect(cleared?.targetYear).toBeNull();
  });

  it("removes all suggestions for a recipient or an idea", async () => {
    await repo.create({
      giftIdeaId: ideaId,
      recipientType: "person",
      recipientId: alice,
    });
    await repo.removeAllForRecipient("person", alice);
    expect(await repo.listForRecipient("person", alice)).toEqual([]);

    await repo.create({
      giftIdeaId: ideaId,
      recipientType: "person",
      recipientId: bob,
    });
    await repo.removeAllForIdea(ideaId);
    expect(await repo.listForIdea(ideaId)).toEqual([]);
  });

  it("repoints a recipient's suggestions onto another recipient (merge)", async () => {
    const s = await repo.create({
      giftIdeaId: ideaId,
      recipientType: "person",
      recipientId: alice,
    });
    await repo.repointRecipient("person", alice, bob);

    expect(await repo.listForRecipient("person", alice)).toEqual([]);
    const moved = await repo.listForRecipient("person", bob);
    expect(moved.map((m) => m.id)).toEqual([s.id]);
  });
});
