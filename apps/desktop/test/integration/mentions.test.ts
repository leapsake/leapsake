import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { createMentionsRepo } from "@leapsake/data";
import { deterministicUuid } from "@leapsake/crypto";
import { MENTION_NAMESPACE, mentionToken } from "@leapsake/schema";
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

/** Create a person, returning their id and canonical display label. */
async function makeAlice() {
  const alice = await core.people.create(
    { firstName: "Alice", middleName: null, lastName: "Ng", gender: null },
    [],
  );
  return alice;
}

/** Active mention rows stored for a reminder bearer, straight from the table. */
function mentionRows(reminderId: string) {
  return driver.all<{ id: string; target_type: string; target_id: string }>(
    "SELECT id, target_type, target_id FROM mentions WHERE bearer_id = ? AND deleted_at IS NULL",
    [reminderId],
  );
}

describe("core.reminders @mentions", () => {
  it("derives a mention row + resolved label from an inline token", async () => {
    const alice = await makeAlice();
    const r = await core.reminders.create({
      title: `🎂 ${mentionToken("Alice Ng", "person", alice.id)}'s birthday`,
    });

    // The join row records the polymorphic bearer (reminder) → target (person).
    const rows = await mentionRows(r.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.target_type).toBe("person");
    expect(rows[0]!.target_id).toBe(alice.id);

    // The read resolves the mention to the target's current label for the client.
    const read = await core.reminders.get(r.id);
    expect(read?.mentions).toEqual([
      { targetType: "person", targetId: alice.id, label: "Alice Ng" },
    ]);
  });

  it("content-addresses the row id deterministically for cross-device convergence", async () => {
    const alice = await makeAlice();
    const r = await core.reminders.create({
      title: `hi ${mentionToken("Alice Ng", "person", alice.id)}`,
    });
    const rows = await mentionRows(r.id);
    expect(rows[0]!.id).toBe(
      deterministicUuid(
        MENTION_NAMESPACE,
        `reminder:${r.id}:person:${alice.id}`,
      ),
    );
  });

  it("re-derives on edit: drops a removed mention, re-adds under the same id", async () => {
    const alice = await makeAlice();
    const r = await core.reminders.create({
      title: `see ${mentionToken("Alice Ng", "person", alice.id)}`,
    });
    const originalId = (await mentionRows(r.id))[0]!.id;

    // Edit the mention out → the row is gone.
    await core.reminders.update(r.id, { title: "see nobody" });
    expect(await mentionRows(r.id)).toHaveLength(0);
    expect((await core.reminders.get(r.id))?.mentions).toEqual([]);

    // Re-mention the same person → the deterministic row is resurrected (no dup).
    await core.reminders.update(r.id, {
      title: `see ${mentionToken("Alice Ng", "person", alice.id)} again`,
    });
    const rows = await mentionRows(r.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(originalId);
  });

  it("re-resolves the label live, so a rename shows through", async () => {
    const alice = await makeAlice();
    const r = await core.reminders.create({
      title: `🎂 ${mentionToken("Alice Ng", "person", alice.id)}'s birthday`,
    });

    await core.people.update(
      alice.id,
      { firstName: "Alicia", middleName: null, lastName: "Ng", gender: null },
      [],
    );

    expect((await core.reminders.get(r.id))?.mentions[0]!.label).toBe(
      "Alicia Ng",
    );
  });

  it("resolves a deleted target's label to null (dead reference), row intact", async () => {
    const alice = await makeAlice();
    const r = await core.reminders.create({
      title: `ping ${mentionToken("Alice Ng", "person", alice.id)}`,
    });

    await core.people.softDelete(alice.id);

    const mentions = (await core.reminders.get(r.id))?.mentions;
    expect(mentions).toEqual([
      { targetType: "person", targetId: alice.id, label: null },
    ]);
  });

  it("cascades mentions when the reminder is soft-deleted", async () => {
    const alice = await makeAlice();
    const r = await core.reminders.create({
      title: `bye ${mentionToken("Alice Ng", "person", alice.id)}`,
    });
    expect(await mentionRows(r.id)).toHaveLength(1);

    await core.reminders.softDelete(r.id);
    expect(await mentionRows(r.id)).toHaveLength(0);
  });

  it("exposes the backlink: which reminders mention a given entity", async () => {
    const alice = await makeAlice();
    const r = await core.reminders.create({
      title: `call ${mentionToken("Alice Ng", "person", alice.id)}`,
    });

    const repo = createMentionsRepo(driver);
    expect(await repo.bearerIdsForTarget("person", alice.id)).toEqual([r.id]);
    expect(
      await repo.bearerIdsForTarget("person", alice.id, "reminder"),
    ).toEqual([r.id]);

    // Removing the mention drops it from the backlink.
    await core.reminders.update(r.id, { title: "call nobody" });
    expect(await repo.bearerIdsForTarget("person", alice.id)).toEqual([]);
  });
});
