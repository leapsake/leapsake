import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
  syncableRepos,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Reconciliation Increment A — `mergePeople`: absorbing one Person into another
 * deterministically, in one transaction. Proves the reference-graph re-point
 * across every table that names a person, the two clean-ups a merge can trigger
 * (self-loops, duplicate edges/tags/dismissals), and that the whole thing
 * replicates over the existing blind-relay sync with no merge-specific code.
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

/** Count not-soft-deleted rows for white-box re-point assertions. */
async function activeRows(d: SqliteDriver, table: string): Promise<number> {
  const row = await d.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL`,
  );
  return row!.n;
}

describe("createCore — mergePeople", () => {
  it("re-points every reference site onto the survivor and tombstones the loser", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      ["Survivor"],
    );
    const bob = await core.people.create(
      { firstName: "Bob", lastName: "Roe" },
      ["Loser"],
    );
    const carol = await core.people.create(
      { firstName: "Carol", lastName: "Lee" },
      [],
    );

    // Hang one of every kind of fact off the loser.
    await core.relationships.create({
      aType: "person",
      aId: bob.id,
      aRole: "friend",
      bType: "person",
      bId: carol.id,
      bRole: "friend",
    });
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: bob.id,
      year: 1985,
      month: 7,
      day: 2,
    });
    await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: bob.id,
      label: "home",
      address: "bob@example.com",
    });
    await core.kinship.dismiss("person", bob.id, "person", carol.id, "child");

    await core.people.merge(jane.id, bob.id);

    // The loser is gone; the survivor keeps its own scalar fields (v1: survivor
    // wins, no per-field picker).
    expect(await core.people.get(bob.id)).toBeUndefined();
    const survivor = await core.people.get(jane.id);
    expect(survivor?.firstName).toBe("Jane");
    expect(survivor?.lastName).toBe("Doe");

    // Every fact now hangs off the survivor…
    expect((await core.tags.listForPerson(jane.id)).map((t) => t.name)).toEqual(
      expect.arrayContaining(["Survivor", "Loser"]),
    );
    const rels = await core.relationships.listForEntity("person", jane.id);
    expect(rels.map((r) => r.otherId)).toEqual([carol.id]);
    expect(await core.milestones.listForBearer("person", jane.id)).toHaveLength(
      1,
    );
    expect(
      await core.contactMethods.listForOwner("person", jane.id),
    ).toHaveLength(1);

    // …and nothing still points at the loser.
    expect(await core.tags.listForPerson(bob.id)).toHaveLength(0);
    expect(
      await core.relationships.listForEntity("person", bob.id),
    ).toHaveLength(0);
    expect(await core.milestones.listForBearer("person", bob.id)).toHaveLength(
      0,
    );
    expect(
      await core.contactMethods.listForOwner("person", bob.id),
    ).toHaveLength(0);
    const danglingDismissal = (await driver.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM relationship_dismissals
            WHERE deleted_at IS NULL
              AND ((subject_type = 'person' AND subject_id = ?)
                OR (other_type = 'person' AND other_id = ?))`,
      [bob.id, bob.id],
    ))!.n;
    expect(danglingDismissal).toBe(0);
  });

  it("prunes a relationship that becomes a self-loop", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const bob = await core.people.create(
      { firstName: "Bob", lastName: "Roe" },
      [],
    );
    // The two people being merged were related to each other.
    await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "spouse",
      bType: "person",
      bId: bob.id,
      bRole: "spouse",
    });

    await core.people.merge(jane.id, bob.id);

    expect(
      await core.relationships.listForEntity("person", jane.id),
    ).toHaveLength(0);
    expect(await activeRows(driver, "relationships")).toBe(0);
  });

  it("dedupes an edge the survivor already had, keeping one", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const bob = await core.people.create(
      { firstName: "Bob", lastName: "Roe" },
      [],
    );
    const carol = await core.people.create(
      { firstName: "Carol", lastName: "Lee" },
      [],
    );
    // Both duplicates are friends with Carol — the same connection.
    for (const id of [jane.id, bob.id]) {
      await core.relationships.create({
        aType: "person",
        aId: id,
        aRole: "friend",
        bType: "person",
        bId: carol.id,
        bRole: "friend",
      });
    }

    await core.people.merge(jane.id, bob.id);

    const rels = await core.relationships.listForEntity("person", jane.id);
    expect(rels).toHaveLength(1);
    expect(rels[0].otherId).toBe(carol.id);
    expect(await activeRows(driver, "relationships")).toBe(1);
  });

  it("drops a dismissal that becomes self-referential", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const bob = await core.people.create(
      { firstName: "Bob", lastName: "Roe" },
      [],
    );
    // A dismissal between the two people being merged.
    await core.kinship.dismiss("person", bob.id, "person", jane.id, null);

    await core.people.merge(jane.id, bob.id);

    expect(await activeRows(driver, "relationship_dismissals")).toBe(0);
  });

  it("merges tags without duplicating one the survivor already wears", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      ["Friend"],
    );
    const bob = await core.people.create(
      { firstName: "Bob", lastName: "Roe" },
      ["Friend", "Work"],
    );

    await core.people.merge(jane.id, bob.id);

    const names = (await core.tags.listForPerson(jane.id))
      .map((t) => t.name)
      .toSorted();
    expect(names).toEqual(["Friend", "Work"]);
  });

  it("bumps the survivor's updatedAt so it wins LWW against a stale loser edit", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const bob = await core.people.create(
      { firstName: "Bob", lastName: "Roe" },
      [],
    );
    const before = (await core.people.get(jane.id))!.updatedAt;
    // Guarantee a later epoch-ms so the bump is observable.
    await new Promise((resolve) => setTimeout(resolve, 2));

    await core.people.merge(jane.id, bob.id);

    expect((await core.people.get(jane.id))!.updatedAt).toBeGreaterThan(before);
  });

  it("carries a 'not a duplicate' memory across, dropping the new self-pair", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const bob = await core.people.create(
      { firstName: "Bob", lastName: "Roe" },
      [],
    );
    const carol = await core.people.create(
      { firstName: "Carol", lastName: "Lee" },
      [],
    );
    // The loser was marked "not a duplicate" of both the survivor and Carol.
    await core.duplicates.reject(bob.id, jane.id);
    await core.duplicates.reject(bob.id, carol.id);

    await core.people.merge(jane.id, bob.id);

    // The bob↔jane rejection becomes survivor↔itself and is dropped; the
    // bob↔carol rejection survives, re-pointed onto the survivor.
    expect(await activeRows(driver, "not_a_duplicate")).toBe(1);
    const [lo, hi] =
      jane.id < carol.id ? [jane.id, carol.id] : [carol.id, jane.id];
    const remaining = (await driver.get<{
      lower_id: string;
      higher_id: string;
    }>(
      "SELECT lower_id, higher_id FROM not_a_duplicate WHERE deleted_at IS NULL",
    ))!;
    expect(remaining).toEqual({ lower_id: lo, higher_id: hi });
  });

  it("refuses to merge a person into itself", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    await expect(core.people.merge(jane.id, jane.id)).rejects.toThrow(
      /same person/i,
    );
  });
});

describe("createCore — mergePeople converges over sync", () => {
  /**
   * One-directional full replication between two engines: collect every
   * locally-changed row from `from` and apply it to `to` via the same
   * `SyncableRepo` allowlist the relay drives — no merge-specific path.
   */
  async function replicate(
    from: SqliteDriver,
    to: SqliteDriver,
    key: Uint8Array,
  ): Promise<void> {
    const dst = new Map(syncableRepos(to, key).map((r) => [r.table, r]));
    for (const repo of syncableRepos(from, key)) {
      const target = dst.get(repo.table);
      if (target === undefined) continue;
      for (const row of await repo.listChangedSince(0)) {
        await target.upsertFromRemote(row);
      }
    }
  }

  it("replicates the re-points and the loser tombstone to a second device", async () => {
    const key = new Uint8Array(32); // a fixed account master key for both devices

    const { driver: driver2, cleanup: cleanup2 } = makeEncryptedTestDriver();
    await runMigrations(driver2);
    const core2 = createCore(driver2);

    // Device 1 holds two duplicates and a fact on the loser.
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const carol = await core.people.create(
      { firstName: "Carol", lastName: "Lee" },
      [],
    );
    const bob = await core.people.create(
      { firstName: "Bob", lastName: "Roe" },
      [],
    );
    await core.relationships.create({
      aType: "person",
      aId: bob.id,
      aRole: "friend",
      bType: "person",
      bId: carol.id,
      bRole: "friend",
    });

    // Device 2 catches up, then device 1 merges and syncs again.
    await replicate(driver, driver2, key);
    expect(await core2.people.get(bob.id)).toBeDefined();

    await core.people.merge(jane.id, bob.id);
    await replicate(driver, driver2, key);

    // The merge converged on device 2 with no merge-specific sync code: the
    // tombstone and the re-pointed edge both arrived as ordinary row changes.
    expect(await core2.people.get(bob.id)).toBeUndefined();
    const rels = await core2.relationships.listForEntity("person", jane.id);
    expect(rels.map((r) => r.otherId)).toEqual([carol.id]);
    expect(
      await core2.relationships.listForEntity("person", bob.id),
    ).toHaveLength(0);

    cleanup2();
  });
});
