import { type KeyStore, createInMemoryKeyStore } from "@leapsake/crypto";
import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  ensureDeviceMasterKey,
  runMigrations,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * `milestone.note` is an **ordinary plaintext column** (migration 27, 2026-07-27).
 * It was briefly the one domain field sealed under a per-item content key; under
 * *encryption follows custody* (`model.md` §7.2) that layer bought a domain field
 * nothing — an Unauthenticated store has no key to seal with, and an Authenticated store is
 * already whole-file ciphertext at rest.
 *
 * These run against the **encrypted** test driver on purpose: the file being
 * ciphertext is layer 1's job and is unaffected: what changed is only that the
 * *column* inside it is no longer separately sealed.
 *
 * The load-bearing case is the last one — that no content key is minted even when
 * a master key is available. Layer 3 still exists for photos (`plans/files.md`),
 * so the guard is against it silently regaining a domain-field consumer.
 */
let driver: SqliteDriver;
let cleanup: () => void;
let keyStore: KeyStore;
let core: CoreApi;

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const NOTE = "met her at the Cambridge analytical-engine talk, 1843";

function milestoneWithNote(note: string | null = NOTE) {
  return {
    kind: "birthday" as const,
    bearerType: "person" as const,
    bearerId: SUBJECT,
    year: 1815,
    month: 12,
    day: 10,
    note,
  };
}

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  keyStore = createInMemoryKeyStore();
  // A key session *is* wired, so "no content key is minted" below means the code
  // path is gone — not merely that no key happened to be available.
  const session = await ensureDeviceMasterKey({ keyStore, driver });
  core = createCore(driver, session);
});

afterEach(() => {
  cleanup();
});

describe("milestone note", () => {
  it("round-trips through the repo", async () => {
    await core.milestones.create(milestoneWithNote());
    const [read] = await core.milestones.listForBearer("person", SUBJECT);
    expect(read?.note).toBe(NOTE);
  });

  it("is stored in the plaintext column, with no ciphertext column left", async () => {
    const created = await core.milestones.create(milestoneWithNote());

    const row = await driver.get<{ note: string | null }>(
      "SELECT note FROM milestones WHERE id = ?",
      [created.id],
    );
    expect(row?.note).toBe(NOTE);

    // Migration 27 dropped the column outright, so selecting it must fail.
    await expect(
      driver.get("SELECT note_ciphertext FROM milestones WHERE id = ?", [
        created.id,
      ]),
    ).rejects.toThrow();
  });

  it("clears to null", async () => {
    const created = await core.milestones.create(milestoneWithNote());
    const updated = await core.milestones.update(created.id, { note: null });
    expect(updated?.note).toBeNull();

    const row = await driver.get<{ note: string | null }>(
      "SELECT note FROM milestones WHERE id = ?",
      [created.id],
    );
    expect(row?.note).toBeNull();
  });

  it("survives a cold reopen", async () => {
    const created = await core.milestones.create(milestoneWithNote());
    const recovered = await ensureDeviceMasterKey({ keyStore, driver });
    const reopened = createCore(driver, recovered);

    const [read] = await reopened.milestones.listForBearer("person", SUBJECT);
    expect(read?.id).toBe(created.id);
    expect(read?.note).toBe(NOTE);
  });

  it("reads identically with no key session at all (an Unauthenticated store)", async () => {
    await core.milestones.create(milestoneWithNote());
    // No key session — the custody state every fresh install now starts in.
    const keyless = createCore(driver);
    const [read] = await keyless.milestones.listForBearer("person", SUBJECT);
    expect(read?.note).toBe(NOTE);
  });

  it("mints no content key, even with a master key available", async () => {
    await core.milestones.create(milestoneWithNote());

    const keys = await driver.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM content_key WHERE entity_type = 'milestone' AND deleted_at IS NULL",
    );
    expect(keys?.n).toBe(0);
    const wraps = await driver.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE wrapped_kind = 'content' AND deleted_at IS NULL",
    );
    expect(wraps?.n).toBe(0);
  });
});
