import type { CreateMilestoneInput } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MilestonesRepo,
  type SqliteDriver,
  createMilestonesRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: MilestonesRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createMilestonesRepo(driver);
});

afterEach(() => {
  cleanup();
});

/** A full-date birthday input for a person bearer. */
function birthday(
  bearerId: string,
  over: Partial<CreateMilestoneInput> = {},
): CreateMilestoneInput {
  return {
    kind: "birthday",
    bearerType: "person",
    bearerId,
    year: 1992,
    month: 3,
    day: 9,
    ...over,
  };
}

describe("milestonesRepo", () => {
  it("creates a milestone with a uuid, timestamps, and null deletedAt", async () => {
    const bearer = crypto.randomUUID();
    const m = await repo.create(birthday(bearer));

    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.kind).toBe("birthday");
    expect(m.bearerType).toBe("person");
    expect(m.bearerId).toBe(bearer);
    expect(m.year).toBe(1992);
    expect(m.month).toBe(3);
    expect(m.day).toBe(9);
    expect(m.note).toBeNull();
    expect(m.createdAt).toBeGreaterThan(0);
    expect(m.updatedAt).toBe(m.createdAt);
    expect(m.deletedAt).toBeNull();
  });

  it("defaults absent date parts and note to null", async () => {
    const yearOnly = await repo.create(
      birthday(crypto.randomUUID(), { month: undefined, day: undefined }),
    );
    expect(yearOnly.month).toBeNull();
    expect(yearOnly.day).toBeNull();

    const recurring = await repo.create(
      birthday(crypto.randomUUID(), { year: undefined }),
    );
    expect(recurring.year).toBeNull();
    expect(recurring.month).toBe(3);
    expect(recurring.day).toBe(9);
  });

  it("persists and retrieves a created milestone", async () => {
    const created = await repo.create(birthday(crypto.randomUUID()));
    expect(await repo.get(created.id)).toEqual(created);
  });

  it("rejects a day without a month at create time", async () => {
    await expect(
      repo.create(birthday(crypto.randomUUID(), { month: undefined })),
    ).rejects.toThrow();
  });

  it("updates a milestone's date parts and bumps updatedAt", async () => {
    const created = await repo.create(birthday(crypto.randomUUID()));
    await new Promise((resolve) => setTimeout(resolve, 2));

    const updated = await repo.update(created.id, { year: 1993, note: null });
    expect(updated?.year).toBe(1993);
    expect(updated?.month).toBe(3);
    expect(updated?.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated?.createdAt).toBe(created.createdAt);
  });

  it("can clear the year on update, leaving a recurring date", async () => {
    const created = await repo.create(birthday(crypto.randomUUID()));
    const updated = await repo.update(created.id, { year: null });
    expect(updated?.year).toBeNull();
    expect(updated?.month).toBe(3);
    expect(updated?.day).toBe(9);
  });

  it("returns undefined when updating a missing or deleted milestone", async () => {
    expect(
      await repo.update(crypto.randomUUID(), { year: 2000 }),
    ).toBeUndefined();

    const created = await repo.create(birthday(crypto.randomUUID()));
    await repo.softDelete(created.id);
    expect(await repo.update(created.id, { year: 2000 })).toBeUndefined();
  });

  it("hides a soft-deleted milestone from get", async () => {
    const created = await repo.create(birthday(crypto.randomUUID()));
    await repo.softDelete(created.id);
    expect(await repo.get(created.id)).toBeUndefined();
  });

  it("lists a bearer's milestones excluding soft-deleted ones, ordered by date", async () => {
    const bearer = crypto.randomUUID();
    const older = await repo.create(birthday(bearer, { year: 1980 }));
    const newer = await repo.create(
      birthday(bearer, { kind: "graduation", year: 2010, month: 5, day: 1 }),
    );
    const deleted = await repo.create(
      birthday(bearer, { kind: "other", note: "x", year: 1970 }),
    );
    await repo.softDelete(deleted.id);
    // A milestone on a different bearer must not appear.
    await repo.create(birthday(crypto.randomUUID()));

    const list = await repo.listForBearer("person", bearer);
    expect(list.map((m) => m.id)).toEqual([older.id, newer.id]);
  });

  it("soft-deletes all of an entity's milestones via removeAllForEntity", async () => {
    const bearer = crypto.randomUUID();
    await repo.create(birthday(bearer, { year: 1980 }));
    await repo.create(birthday(bearer, { kind: "death", year: 2020 }));
    const other = crypto.randomUUID();
    await repo.create(birthday(other));

    await repo.removeAllForEntity("person", bearer);
    expect(await repo.listForBearer("person", bearer)).toHaveLength(0);
    // Other bearers are untouched.
    expect(await repo.listForBearer("person", other)).toHaveLength(1);
  });
});
