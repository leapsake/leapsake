import { DatabaseSync } from "node:sqlite";
import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { beforeEach, describe, expect, it } from "vitest";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

/**
 * Reconciliation Increment B — duplicate *detection*. Proves the detector
 * proposes candidate pairs with tiers + reasons, and that a recorded
 * "not a duplicate" rejection is suppressed from future results.
 */

let db: DatabaseSync;
let driver: SqliteDriver;
let core: CoreApi;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  core = createCore(driver);
});

describe("createCore — duplicate detection", () => {
  it("proposes a same-name pair as medium with a reason", async () => {
    await core.people.create({ firstName: "Jane", lastName: "Doe" }, []);
    await core.people.create({ firstName: "Jane", lastName: "Doe" }, []);

    const candidates = await core.duplicates.findCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tier).toBe("medium");
    expect(candidates[0].reasons).toContain('Same name "Jane Doe"');
  });

  it("rates a shared email + same name as high", async () => {
    const a = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const b = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    for (const id of [a.id, b.id]) {
      await core.contactMethods.emails.create({
        ownerType: "person",
        ownerId: id,
        label: "home",
        address: "Jane@Example.com", // different case → same normalized key
      });
    }

    const candidates = await core.duplicates.findCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tier).toBe("high");
    expect(candidates[0].reasons).toContain("Shared email jane@example.com");
  });

  it("does not propose unrelated people", async () => {
    await core.people.create({ firstName: "Jane", lastName: "Doe" }, []);
    await core.people.create({ firstName: "Bob", lastName: "Roe" }, []);
    expect(await core.duplicates.findCandidates()).toHaveLength(0);
  });

  it("suppresses a pair the user marked 'not a duplicate'", async () => {
    const a = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const b = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    expect(await core.duplicates.findCandidates()).toHaveLength(1);

    await core.duplicates.reject(a.id, b.id);
    expect(await core.duplicates.findCandidates()).toHaveLength(0);

    // Order-independent: rejecting (b, a) is the same pair.
    const c = await core.people.create(
      { firstName: "Carol", lastName: "Lee" },
      [],
    );
    const d = await core.people.create(
      { firstName: "Carol", lastName: "Lee" },
      [],
    );
    await core.duplicates.reject(d.id, c.id);
    expect(await core.duplicates.findCandidates()).toHaveLength(0);
  });
});
