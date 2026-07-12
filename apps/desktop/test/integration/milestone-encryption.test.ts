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

// `milestone.note` is the first domain field encrypted at rest under a per-item
// content key. These tests prove the round-trip is transparent (the Milestone
// shape callers see is unchanged), that the stored bytes are genuinely ciphertext,
// that it survives a cold reopen, and that legacy plaintext rows still read.

let driver: SqliteDriver;
let cleanup: () => void;
let keyStore: KeyStore;
let core: CoreApi;

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const NOTE = "met her at the Cambridge analytical-engine talk, 1843";

/** A dated birthday input carrying a free-text note. */
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
  const session = await ensureDeviceMasterKey({ keyStore, driver });
  core = createCore(driver, session);
});

afterEach(() => {
  cleanup();
});

describe("milestone note encryption", () => {
  it("stores the note as ciphertext, not plaintext", async () => {
    const created = await core.milestones.create(milestoneWithNote());

    const row = await driver.get<{
      note: string | null;
      note_ciphertext: Uint8Array | null;
    }>("SELECT note, note_ciphertext FROM milestones WHERE id = ?", [
      created.id,
    ]);

    expect(row?.note).toBeNull();
    expect(row?.note_ciphertext).not.toBeNull();
    // The ciphertext must not contain the plaintext bytes.
    const cipherText = new TextDecoder().decode(
      Uint8Array.from(row?.note_ciphertext ?? new Uint8Array()),
    );
    expect(cipherText).not.toContain("Cambridge");

    // A content_key + its wrap(CK, MK) now exist for this milestone.
    const ck = await driver.get<{ id: string }>(
      "SELECT id FROM content_key WHERE entity_type = 'milestone' AND entity_id = ? AND deleted_at IS NULL",
      [created.id],
    );
    expect(ck?.id).toBeDefined();
    const wrap = await driver.get<{ id: string }>(
      "SELECT id FROM key_wrap WHERE wrapped_kind = 'content' AND content_key_id = ? AND principal_kind = 'master' AND deleted_at IS NULL",
      [ck?.id],
    );
    expect(wrap?.id).toBeDefined();
  });

  it("decrypts the note transparently on read", async () => {
    await core.milestones.create(milestoneWithNote());

    const [read] = await core.milestones.listForBearer("person", SUBJECT);
    expect(read?.note).toBe(NOTE);
  });

  it("decrypts after a cold reopen (key recovered from the keystore)", async () => {
    const created = await core.milestones.create(milestoneWithNote());

    // Re-bootstrap from the same driver + keystore: ensureDeviceMasterKey is
    // idempotent and recovers the same MK, so a fresh core can decrypt.
    const recovered = await ensureDeviceMasterKey({ keyStore, driver });
    const reopened = createCore(driver, recovered);

    const [read] = await reopened.milestones.listForBearer("person", SUBJECT);
    expect(read?.id).toBe(created.id);
    expect(read?.note).toBe(NOTE);
  });

  it("clearing a note clears both columns", async () => {
    const created = await core.milestones.create(milestoneWithNote());
    const updated = await core.milestones.update(created.id, { note: null });
    expect(updated?.note).toBeNull();

    const row = await driver.get<{
      note: string | null;
      note_ciphertext: Uint8Array | null;
    }>("SELECT note, note_ciphertext FROM milestones WHERE id = ?", [
      created.id,
    ]);
    expect(row?.note).toBeNull();
    expect(row?.note_ciphertext).toBeNull();
  });

  it("reads a legacy plaintext note and re-encrypts it on update", async () => {
    // Simulate a pre-encryption (V1/V2) row: plaintext note, null ciphertext.
    const id = "22222222-2222-4222-8222-222222222222";
    const now = Date.now();
    await driver.run(
      `INSERT INTO milestones
         (id, kind, bearer_type, bearer_id, year, month, day, note,
          note_ciphertext, created_at, updated_at, deleted_at)
       VALUES (?, 'birthday', 'person', ?, 1906, 12, 9, ?, NULL, ?, ?, NULL)`,
      [id, SUBJECT, "legacy plaintext note", now, now],
    );

    const [read] = await core.milestones.listForBearer("person", SUBJECT);
    expect(read?.note).toBe("legacy plaintext note");

    // Touching the row upgrades it to ciphertext.
    await core.milestones.update(id, { note: "legacy plaintext note" });
    const row = await driver.get<{
      note: string | null;
      note_ciphertext: Uint8Array | null;
    }>("SELECT note, note_ciphertext FROM milestones WHERE id = ?", [id]);
    expect(row?.note).toBeNull();
    expect(row?.note_ciphertext).not.toBeNull();
  });
});
