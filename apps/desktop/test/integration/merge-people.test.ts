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
      { firstName: "Jane", lastName: "Wainwright" },
      ["Survivor"],
    );
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Bailey" },
      ["Loser"],
    );
    const tilly = await core.people.create(
      { firstName: "Tilly", lastName: "Lee" },
      [],
    );

    // Hang one of every kind of fact off the loser.
    await core.relationships.create({
      aType: "person",
      aId: harry.id,
      aRole: "friend",
      bType: "person",
      bId: tilly.id,
      bRole: "friend",
    });
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: harry.id,
      year: 1985,
      month: 7,
      day: 2,
    });
    await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: harry.id,
      label: "home",
      address: "harry@example.com",
    });
    await core.kinship.dismiss("person", harry.id, "person", tilly.id, "child");

    await core.people.merge(jane.id, harry.id);

    // The loser is gone; the survivor keeps its own scalar fields (v1: survivor
    // wins, no per-field picker).
    expect(await core.people.get(harry.id)).toBeUndefined();
    const survivor = await core.people.get(jane.id);
    expect(survivor?.firstName).toBe("Jane");
    expect(survivor?.lastName).toBe("Wainwright");

    // Every fact now hangs off the survivor…
    expect((await core.tags.listForPerson(jane.id)).map((t) => t.name)).toEqual(
      expect.arrayContaining(["Survivor", "Loser"]),
    );
    const rels = await core.relationships.listForEntity("person", jane.id);
    expect(rels.map((r) => r.otherId)).toEqual([tilly.id]);
    expect(await core.milestones.listForBearer("person", jane.id)).toHaveLength(
      1,
    );
    expect(
      await core.contactMethods.listForOwner("person", jane.id),
    ).toHaveLength(1);

    // …and nothing still points at the loser.
    expect(await core.tags.listForPerson(harry.id)).toHaveLength(0);
    expect(
      await core.relationships.listForEntity("person", harry.id),
    ).toHaveLength(0);
    expect(
      await core.milestones.listForBearer("person", harry.id),
    ).toHaveLength(0);
    expect(
      await core.contactMethods.listForOwner("person", harry.id),
    ).toHaveLength(0);
    const danglingDismissal = (await driver.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM relationship_dismissals
            WHERE deleted_at IS NULL
              AND ((subject_type = 'person' AND subject_id = ?)
                OR (other_type = 'person' AND other_id = ?))`,
      [harry.id, harry.id],
    ))!.n;
    expect(danglingDismissal).toBe(0);
  });

  it("prunes a relationship that becomes a self-loop", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Bailey" },
      [],
    );
    // The two people being merged were related to each other.
    await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "spouse",
      bType: "person",
      bId: harry.id,
      bRole: "spouse",
    });

    await core.people.merge(jane.id, harry.id);

    expect(
      await core.relationships.listForEntity("person", jane.id),
    ).toHaveLength(0);
    expect(await activeRows(driver, "relationships")).toBe(0);
  });

  it("dedupes an edge the survivor already had, keeping one", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Bailey" },
      [],
    );
    const tilly = await core.people.create(
      { firstName: "Tilly", lastName: "Lee" },
      [],
    );
    // Both duplicates are friends with Tilly — the same connection.
    for (const id of [jane.id, harry.id]) {
      await core.relationships.create({
        aType: "person",
        aId: id,
        aRole: "friend",
        bType: "person",
        bId: tilly.id,
        bRole: "friend",
      });
    }

    await core.people.merge(jane.id, harry.id);

    const rels = await core.relationships.listForEntity("person", jane.id);
    expect(rels).toHaveLength(1);
    expect(rels[0].otherId).toBe(tilly.id);
    expect(await activeRows(driver, "relationships")).toBe(1);
  });

  it("drops a dismissal that becomes self-referential", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Bailey" },
      [],
    );
    // A dismissal between the two people being merged.
    await core.kinship.dismiss("person", harry.id, "person", jane.id, null);

    await core.people.merge(jane.id, harry.id);

    expect(await activeRows(driver, "relationship_dismissals")).toBe(0);
  });

  it("merges tags without duplicating one the survivor already wears", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      ["Friend"],
    );
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Bailey" },
      ["Friend", "Work"],
    );

    await core.people.merge(jane.id, harry.id);

    const names = (await core.tags.listForPerson(jane.id))
      .map((t) => t.name)
      .toSorted();
    expect(names).toEqual(["Friend", "Work"]);
  });

  it("bumps the survivor's updatedAt so it wins LWW against a stale loser edit", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Bailey" },
      [],
    );
    const before = (await core.people.get(jane.id))!.updatedAt;
    // Guarantee a later epoch-ms so the bump is observable.
    await new Promise((resolve) => setTimeout(resolve, 2));

    await core.people.merge(jane.id, harry.id);

    expect((await core.people.get(jane.id))!.updatedAt).toBeGreaterThan(before);
  });

  it("carries a 'not a duplicate' memory across, dropping the new self-pair", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Bailey" },
      [],
    );
    const tilly = await core.people.create(
      { firstName: "Tilly", lastName: "Lee" },
      [],
    );
    // The loser was marked "not a duplicate" of both the survivor and Tilly.
    await core.duplicates.reject(harry.id, jane.id);
    await core.duplicates.reject(harry.id, tilly.id);

    await core.people.merge(jane.id, harry.id);

    // The harry↔jane rejection becomes survivor↔itself and is dropped; the
    // harry↔tilly rejection survives, re-pointed onto the survivor.
    expect(await activeRows(driver, "not_a_duplicate")).toBe(1);
    const [lo, hi] =
      jane.id < tilly.id ? [jane.id, tilly.id] : [tilly.id, jane.id];
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
      { firstName: "Jane", lastName: "Wainwright" },
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
  ): Promise<void> {
    const dst = new Map(syncableRepos(to).map((r) => [r.table, r]));
    for (const repo of syncableRepos(from)) {
      const target = dst.get(repo.table);
      if (target === undefined) continue;
      for (const row of await repo.listChangedSince(0)) {
        await target.upsertFromRemote(row);
      }
    }
  }

  it("replicates the re-points and the loser tombstone to a second device", async () => {
    const { driver: driver2, cleanup: cleanup2 } = makeEncryptedTestDriver();
    await runMigrations(driver2);
    const core2 = createCore(driver2);

    // Device 1 holds two duplicates and a fact on the loser.
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const tilly = await core.people.create(
      { firstName: "Tilly", lastName: "Lee" },
      [],
    );
    const harry = await core.people.create(
      { firstName: "Harry", lastName: "Bailey" },
      [],
    );
    await core.relationships.create({
      aType: "person",
      aId: harry.id,
      aRole: "friend",
      bType: "person",
      bId: tilly.id,
      bRole: "friend",
    });

    // Device 2 catches up, then device 1 merges and syncs again.
    await replicate(driver, driver2);
    expect(await core2.people.get(harry.id)).toBeDefined();

    await core.people.merge(jane.id, harry.id);
    await replicate(driver, driver2);

    // The merge converged on device 2 with no merge-specific sync code: the
    // tombstone and the re-pointed edge both arrived as ordinary row changes.
    expect(await core2.people.get(harry.id)).toBeUndefined();
    const rels = await core2.relationships.listForEntity("person", jane.id);
    expect(rels.map((r) => r.otherId)).toEqual([tilly.id]);
    expect(
      await core2.relationships.listForEntity("person", harry.id),
    ).toHaveLength(0);

    cleanup2();
  });
});
