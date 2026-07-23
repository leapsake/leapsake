import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SELF_PERSON_ID,
  type SelfPersonRepo,
  type SqliteDriver,
  createSelfPersonRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: SelfPersonRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createSelfPersonRepo(driver);
});

afterEach(() => {
  cleanup();
});

describe("selfPersonRepo", () => {
  it("reads undefined before any self is set", async () => {
    expect(await repo.getSelf()).toBeUndefined();
  });

  it("sets and reads back the self-person under the constant id", async () => {
    const personId = crypto.randomUUID();
    const set = await repo.setSelf(personId);
    expect(set.id).toBe(SELF_PERSON_ID);
    expect(set.personId).toBe(personId);
    expect(set.deletedAt).toBeNull();

    expect(await repo.getSelf()).toEqual(set);
  });

  it("re-points to a new person leaving exactly one row (the convergence guarantee)", async () => {
    const alice = crypto.randomUUID();
    const bob = crypto.randomUUID();
    await repo.setSelf(alice);
    // Ensure an observably newer millisecond so updatedAt advances.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const repointed = await repo.setSelf(bob);

    expect(repointed.id).toBe(SELF_PERSON_ID);
    expect(repointed.personId).toBe(bob);

    // Exactly one row exists — the fixed PK means a second pick merges in place.
    const rows = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM self_person",
    );
    expect(rows[0]?.n).toBe(1);
    expect((await repo.getSelf())?.personId).toBe(bob);
  });

  it("clears the self (soft-delete) so it reads as unset", async () => {
    await repo.setSelf(crypto.randomUUID());
    await repo.clearSelf();
    expect(await repo.getSelf()).toBeUndefined();
  });

  it("re-activates the same row when set again after a clear", async () => {
    const alice = crypto.randomUUID();
    const bob = crypto.randomUUID();
    await repo.setSelf(alice);
    await repo.clearSelf();
    const revived = await repo.setSelf(bob);

    expect(revived.id).toBe(SELF_PERSON_ID);
    expect(revived.personId).toBe(bob);
    expect(revived.deletedAt).toBeNull();

    // Still one physical row — the revive re-used the tombstone, not a new insert.
    const rows = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM self_person",
    );
    expect(rows[0]?.n).toBe(1);
  });
});
