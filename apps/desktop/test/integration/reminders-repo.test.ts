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

  it("snooze sets the clock and spends one repetition of the budget", async () => {
    const until = Date.UTC(2026, 7, 15);
    const r = await repo.create({ title: "Book the dentist" });

    const snoozed = await repo.snooze(r.id, until);

    expect(snoozed?.snoozedUntil).toBe(until);
    expect(snoozed?.snoozeCount).toBe(1);
    expect(await snoozeColumns(driver, r.id)).toEqual({
      snoozed_until: until,
      snooze_count: 1,
    });
  });

  it("counts every snooze, and the latest clock wins", async () => {
    const first = Date.UTC(2026, 7, 15);
    const second = Date.UTC(2026, 8, 1);
    const r = await repo.create({ title: "Renew the passport" });

    await repo.snooze(r.id, first);
    const again = await repo.snooze(r.id, second);

    expect(again?.snoozeCount).toBe(2);
    expect(again?.snoozedUntil).toBe(second);
  });

  it("advances updatedAt, so a snooze travels like any other edit", async () => {
    // Stamped a minute ago so the assertion turns on the write, not on whether
    // two adjacent calls happened to land in different milliseconds — the
    // outbound sync read is `updated_at > since`, strictly.
    const stale = Date.now() - 60_000;
    const id = crypto.randomUUID();
    await repo.insert({
      id,
      title: "Water the plants",
      body: null,
      completedAt: null,
      dueDate: null,
      snoozedUntil: null,
      snoozeCount: 0,
      source: "user",
      createdAt: stale,
      updatedAt: stale,
      deletedAt: null,
    });

    const snoozed = await repo.snooze(id, Date.UTC(2026, 7, 15));

    expect(snoozed!.updatedAt).toBeGreaterThan(stale);
    // So it lands in the outbound set a peer will pull, carrying the new state.
    expect(await repo.listChangedSince(stale)).toContainEqual(snoozed);
  });

  it("stores a past `until` verbatim, and still spends the budget", async () => {
    // Whether a date is sensible is the caller's policy, not the repo's — but
    // the count increments either way, so no client can snooze for free.
    const r = await repo.create({ title: "Call the plumber" });
    const past = Date.UTC(2020, 0, 1);

    const snoozed = await repo.snooze(r.id, past);

    expect(snoozed?.snoozedUntil).toBe(past);
    expect(snoozed?.snoozeCount).toBe(1);
  });

  it("rejects a non-integer `until` and writes nothing", async () => {
    const r = await repo.create({ title: "Ship it" });

    await expect(repo.snooze(r.id, "soon" as never)).rejects.toThrow();

    // The guard that matters: had it been written, every later read of this row
    // would fail validation instead.
    expect(await snoozeColumns(driver, r.id)).toEqual({
      snoozed_until: null,
      snooze_count: 0,
    });
    expect((await repo.get(r.id))?.snoozeCount).toBe(0);
  });

  it("returns undefined for a missing id", async () => {
    expect(await repo.snooze(crypto.randomUUID(), Date.now())).toBeUndefined();
  });

  it("leaves a soft-deleted reminder alone", async () => {
    const r = await repo.create({ title: "Cancel the subscription" });
    await repo.softDelete(r.id);

    expect(await repo.snooze(r.id, Date.UTC(2026, 7, 15))).toBeUndefined();
    expect(await snoozeColumns(driver, r.id)).toEqual({
      snoozed_until: null,
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

/**
 * The merge rule in `packages/reminders/README.md` → *Merge safety* at the one place it acts: `upsertFromRemote`.
 * Every device mints the onboarding nudges independently under the same
 * deterministic id, so a device that mints *before* it pulls carries the newer
 * `updated_at` — and used to undo the peer's dismissal and reset its snooze
 * count (slice 8). `reminderHasHistory` is what stops it.
 */
describe("remindersRepo — an untouched row never wins a merge", () => {
  /** The id both devices mint independently; the value is immaterial, the sharing isn't. */
  const NUDGE_ID = "0da73516-17c4-5fe9-8d2e-3cf98a63ae71";

  /** A nudge exactly as the engine's `reconcile` inserts it. */
  const minted = (at: number, over: Partial<Reminder> = {}): Reminder => ({
    id: NUDGE_ID,
    title: "🙋 Which of these is you? Pick yourself.",
    body: null,
    completedAt: null,
    dueDate: null,
    snoozedUntil: null,
    snoozeCount: 0,
    source: "system",
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    ...over,
  });

  it("keeps a local dismissal when a peer pushes a newer mint", async () => {
    await repo.insert(minted(1000));
    await repo.softDelete(NUDGE_ID); // "don't ask again"

    // The peer's clock must genuinely out-rank the tombstone, or the assertion
    // passes on LWW alone and proves nothing: `softDelete` stamps the real now.
    await repo.upsertFromRemote(minted(Date.now() + 60_000));

    const row = await repo.getIncludingDeleted(NUDGE_ID);
    expect(row?.deletedAt).not.toBeNull();
    expect(await repo.get(NUDGE_ID)).toBeUndefined(); // still off Home
  });

  it("keeps a local snooze, clock and count, when a peer pushes a newer mint", async () => {
    const until = Date.UTC(2026, 7, 15);
    await repo.insert(minted(1000));
    await repo.snooze(NUDGE_ID, until);

    await repo.upsertFromRemote(minted(Date.now() + 60_000));

    const row = await repo.get(NUDGE_ID);
    expect(row?.snoozedUntil).toBe(until);
    expect(row?.snoozeCount).toBe(1); // not reset to 0 — the slice-8 symptom
  });

  it("still takes a peer's decision over a local mint", async () => {
    // The mirror image: this device is the one that knew nothing. The peer's
    // dismissal wins even though the local mint's clock is newer.
    await repo.insert(minted(9000));

    await repo.upsertFromRemote(
      minted(1000, { deletedAt: 1000, snoozeCount: 1 }),
    );

    expect(await repo.get(NUDGE_ID)).toBeUndefined();
    expect((await repo.getIncludingDeleted(NUDGE_ID))?.snoozeCount).toBe(1);
  });

  it("leaves two rows that both carry history on plain LWW", async () => {
    await repo.insert(minted(1000));
    await repo.snooze(NUDGE_ID, Date.UTC(2026, 6, 1));

    // The peer snoozed a minute later by its own clock (`snooze` stamps the real
    // one locally); last writer still wins between two decisions.
    await repo.upsertFromRemote(
      minted(Date.now() + 60_000, {
        snoozedUntil: Date.UTC(2026, 8, 1),
        snoozeCount: 2,
      }),
    );

    const row = await repo.get(NUDGE_ID);
    expect(row?.snoozedUntil).toBe(Date.UTC(2026, 8, 1));
    expect(row?.snoozeCount).toBe(2);
  });
});
