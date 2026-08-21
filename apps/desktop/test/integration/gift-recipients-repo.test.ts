import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type GiftRecipientsRepo,
  type SqliteDriver,
  createGiftRecipientsRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: GiftRecipientsRepo;

const ideaId = crypto.randomUUID();
const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
const rufus = crypto.randomUUID();

const person = (id: string) => ({ type: "person" as const, id });

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createGiftRecipientsRepo(driver);
});

afterEach(() => {
  cleanup();
});

describe("giftRecipientsRepo", () => {
  it("creates an ungiven link", async () => {
    const row = await repo.create({ giftIdeaId: ideaId, party: person(alice) });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.giftIdeaId).toBe(ideaId);
    expect(row.recipientType).toBe("person");
    expect(row.recipientId).toBe(alice);
    expect(row.givenAt).toBeNull();
    expect(row.deletedAt).toBeNull();
  });

  it("stamps givenAt when the caller says it was given", async () => {
    const before = Date.now();
    const row = await repo.create({
      giftIdeaId: ideaId,
      party: { type: "pet", id: rufus },
      given: true,
    });
    expect(row.givenAt).not.toBeNull();
    expect(row.givenAt).toBeGreaterThanOrEqual(before);
    expect(row.givenAt).toBeLessThanOrEqual(Date.now());
  });

  it("lists by recipient and by idea, excluding soft-deleted rows", async () => {
    const forAlice = await repo.create({
      giftIdeaId: ideaId,
      party: person(alice),
    });
    await repo.create({
      giftIdeaId: crypto.randomUUID(),
      party: person(bob),
    });

    expect(
      (await repo.listForRecipient("person", alice)).map((r) => r.id),
    ).toEqual([forAlice.id]);
    expect((await repo.listForIdea(ideaId)).map((r) => r.id)).toEqual([
      forAlice.id,
    ]);

    await repo.softDelete(forAlice.id);
    expect(await repo.listForRecipient("person", alice)).toEqual([]);
    expect(await repo.listForIdea(ideaId)).toEqual([]);
  });

  it("sorts outstanding gifts ahead of given ones", async () => {
    const given = await repo.create({
      giftIdeaId: crypto.randomUUID(),
      party: person(alice),
      given: true,
    });
    const outstanding = await repo.create({
      giftIdeaId: crypto.randomUUID(),
      party: person(alice),
    });

    expect(
      (await repo.listForRecipient("person", alice)).map((r) => r.id),
    ).toEqual([outstanding.id, given.id]);
  });

  it("ticks and unticks the box", async () => {
    const row = await repo.create({ giftIdeaId: ideaId, party: person(alice) });

    const ticked = await repo.update(row.id, { given: true });
    expect(ticked?.givenAt).not.toBeNull();

    const unticked = await repo.update(row.id, { given: false });
    expect(unticked?.givenAt).toBeNull();
  });

  it("does not re-stamp or churn a row that already says so", async () => {
    const row = await repo.create({
      giftIdeaId: ideaId,
      party: person(alice),
      given: true,
    });

    const again = await repo.update(row.id, { given: true });
    expect(again?.givenAt).toBe(row.givenAt);
    expect(again?.updatedAt).toBe(row.updatedAt);
  });

  it("returns undefined for an unknown id", async () => {
    expect(
      await repo.update(crypto.randomUUID(), { given: true }),
    ).toBeUndefined();
  });

  it("removes all links for a recipient or an idea", async () => {
    await repo.create({ giftIdeaId: ideaId, party: person(alice) });
    await repo.removeAllForRecipient("person", alice);
    expect(await repo.listForRecipient("person", alice)).toEqual([]);

    await repo.create({ giftIdeaId: ideaId, party: person(bob) });
    await repo.removeAllForIdea(ideaId);
    expect(await repo.listForIdea(ideaId)).toEqual([]);
  });

  it("repoints a recipient's links onto another recipient (merge)", async () => {
    const row = await repo.create({
      giftIdeaId: ideaId,
      party: person(alice),
    });
    await repo.repointRecipient("person", alice, bob);

    expect(await repo.listForRecipient("person", alice)).toEqual([]);
    expect(
      (await repo.listForRecipient("person", bob)).map((r) => r.id),
    ).toEqual([row.id]);
  });

  it("collapses a merge's duplicate ideas, keeping the ✓", async () => {
    // Both people were down for the same thing, and one of them got it. After
    // the merge the survivor should hold one row, still ticked.
    await repo.create({
      giftIdeaId: ideaId,
      party: person(bob),
    });
    await repo.create({
      giftIdeaId: ideaId,
      party: person(alice),
      given: true,
    });

    await repo.repointRecipient("person", alice, bob);

    const survivors = await repo.listForRecipient("person", bob);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.givenAt).not.toBeNull();
  });

  it("leaves distinct ideas alone when merging", async () => {
    await repo.create({ giftIdeaId: ideaId, party: person(bob) });
    await repo.create({
      giftIdeaId: crypto.randomUUID(),
      party: person(alice),
    });

    await repo.repointRecipient("person", alice, bob);

    expect(await repo.listForRecipient("person", bob)).toHaveLength(2);
  });
});
