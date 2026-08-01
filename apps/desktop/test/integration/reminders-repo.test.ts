import {
  type RemindersRepo,
  type SqliteDriver,
  createRemindersRepo,
  runMigrations,
} from "@leapsake/data";
import type { Reminder } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let reopen: () => SqliteDriver;
let repo: RemindersRepo;

beforeEach(async () => {
  ({ driver, cleanup, reopen } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createRemindersRepo(driver);
});

afterEach(() => {
  cleanup();
});

/** The raw snooze columns as SQLite holds them, to catch a codec that renamed wrong. */
function snoozeColumns(d: SqliteDriver, id: string) {
  return d.get<{ snoozed_until: number | null; snooze_count: number }>(
    "SELECT snoozed_until, snooze_count FROM reminders WHERE id = ?",
    [id],
  );
}

describe("remindersRepo snooze columns", () => {
  it("creates a reminder un-snoozed", async () => {
    const r = await repo.create({ title: "Call mom" });

    expect(r.snoozedUntil).toBeNull();
    expect(r.snoozeCount).toBe(0);
    expect(await snoozeColumns(driver, r.id)).toEqual({
      snoozed_until: null,
      snooze_count: 0,
    });
  });

  it("round-trips a snooze clock through update, and across a reopen", async () => {
    const until = Date.UTC(2026, 7, 15);
    const r = await repo.create({ title: "Book the dentist" });

    const updated = await repo.update(r.id, { snoozedUntil: until });
    expect(updated?.snoozedUntil).toBe(until);
    expect(await snoozeColumns(driver, r.id)).toMatchObject({
      snoozed_until: until,
    });

    // A fresh connection to the same file decodes the same value.
    const onReopen = await createRemindersRepo(reopen()).get(r.id);
    expect(onReopen?.snoozedUntil).toBe(until);
    expect(onReopen?.snoozeCount).toBe(0);

    // Clearing it back to null is an ordinary patch, not a special case.
    expect(
      (await repo.update(r.id, { snoozedUntil: null }))?.snoozedUntil,
    ).toBe(null);
  });

  it("keeps snoozeCount out of the update input — it is engine-owned", async () => {
    const r = await repo.create({ title: "Water the plants" });

    // The repo parses its input, so an unknown key is stripped rather than written.
    const updated = await repo.update(r.id, {
      snoozeCount: 7,
    } as never);

    expect(updated?.snoozeCount).toBe(0);
    expect(await snoozeColumns(driver, r.id)).toMatchObject({
      snooze_count: 0,
    });
  });

  it("carries both columns through a sync encode/decode to another device", async () => {
    const peer = makeEncryptedTestDriver();
    try {
      await runMigrations(peer.driver);
      const peerRepo = createRemindersRepo(peer.driver);

      // A row already snoozed twice, so neither column can pass by defaulting.
      const now = Date.now();
      const row: Reminder = {
        id: crypto.randomUUID(),
        title: "Renew the passport",
        body: null,
        completedAt: null,
        dueDate: null,
        snoozedUntil: Date.UTC(2026, 8, 1),
        snoozeCount: 2,
        source: "user",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await repo.insert(row);

      // `listChangedSince` is the read half of the codec (snake_case → domain).
      const outbound = await repo.listChangedSince(0);
      expect(outbound).toContainEqual(row);

      // `upsertFromRemote` is the write half (domain → snake_case) on the peer.
      for (const remote of outbound) await peerRepo.upsertFromRemote(remote);

      expect(await peerRepo.get(row.id)).toEqual(row);
      expect(await snoozeColumns(peer.driver, row.id)).toEqual({
        snoozed_until: row.snoozedUntil,
        snooze_count: 2,
      });
    } finally {
      peer.cleanup();
    }
  });
});
