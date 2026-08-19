import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Reconciliation Increment B — duplicate *detection*. Proves the detector
 * proposes candidate pairs with tiers + reasons, and that a recorded
 * "not a duplicate" rejection is suppressed from future results.
 */

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

  it("rates a shared social handle on one platform as high", async () => {
    const a = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const b = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    for (const [id, handle] of [
      [a.id, "SparkleJane"],
      [b.id, "sparklejane"], // different case → same normalized key
    ] as const) {
      await core.contactMethods.socials.create({
        ownerType: "person",
        ownerId: id,
        label: "Personal",
        platform: "instagram",
        handle,
      });
    }

    const candidates = await core.duplicates.findCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tier).toBe("high");
    expect(candidates[0].reasons).toContain(
      "Shared instagram handle sparklejane",
    );
  });

  it("does not treat one handle held on two platforms as shared", async () => {
    const a = await core.people.create(
      { firstName: "Jane", lastName: "A" },
      [],
    );
    const b = await core.people.create(
      { firstName: "Jane", lastName: "B" },
      [],
    );
    await core.contactMethods.socials.create({
      ownerType: "person",
      ownerId: a.id,
      label: "Personal",
      platform: "instagram",
      handle: "jane",
    });
    await core.contactMethods.socials.create({
      ownerType: "person",
      ownerId: b.id,
      label: "Personal",
      platform: "tiktok",
      handle: "jane",
    });

    // Different surnames, so nothing else pairs them either.
    expect(await core.duplicates.findCandidates()).toHaveLength(0);
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

// Unpublished people are out of the pool. They exist only as facts about other
// people and are offered by no picker, so the same name arriving twice means two
// different people — one coworker's wife "Jen" and another's are not a pair to
// review. With a single word now being a whole legal name, leaving them in would
// have made every such name collide with every other.
describe("createCore — duplicate detection and standing", () => {
  it("does not pair two unpublished people who share a name", async () => {
    await core.people.create({ firstName: "Jen", standing: "unpublished" }, []);
    await core.people.create({ firstName: "Jen", standing: "unpublished" }, []);

    expect(await core.duplicates.findCandidates()).toHaveLength(0);
  });

  it("does not pair an unpublished person with a published namesake", async () => {
    await core.people.create({ firstName: "Jen", lastName: "Davis" }, []);
    await core.people.create(
      { firstName: "Jen", lastName: "Davis", standing: "unpublished" },
      [],
    );

    expect(await core.duplicates.findCandidates()).toHaveLength(0);
  });

  // ...and the pair appears the moment she stops being only a fact about someone
  // else, which is when the question "is she already in your list?" first has any
  // meaning. Publishing is what runs detection over her.
  it("pairs them once the unpublished one is published", async () => {
    await core.people.create({ firstName: "Jen", lastName: "Davis" }, []);
    const attached = await core.people.create(
      { firstName: "Jen", lastName: "Davis", standing: "unpublished" },
      [],
    );

    await core.people.update(attached.id, { standing: "published" }, []);

    const candidates = await core.duplicates.findCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reasons).toContain('Same name "Jen Davis"');
  });
});
