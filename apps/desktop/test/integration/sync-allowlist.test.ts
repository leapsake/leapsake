import { runMigrations } from "@leapsake/data";
import { syncableRepos } from "@leapsake/core";
import { beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The canonical sync allowlist, pinned in production code. `syncableRepos` is the
 * single home for "what may leave the device"; adding an entity is the conscious
 * step of adding it here (the `defineSyncable` recipe). The device-local key
 * tables must *never* appear — that is what keeps sync zero-knowledge
 * (model.md §3). This mirrors the data-layer guard but over the real helper the
 * apps drive sync through.
 */
describe("syncableRepos — the canonical allowlist", () => {
  let tables: string[];

  beforeEach(async () => {
    const { driver, cleanup } = makeEncryptedTestDriver();
    await runMigrations(driver);
    tables = syncableRepos(driver)
      .map((repo) => repo.table)
      .sort();
    cleanup();
  });

  it("syncs exactly the opted-in tables", () => {
    expect(tables).toEqual([
      "email_addresses",
      "gift_idea_occasions",
      "gift_ideas",
      "gift_suggestions",
      "gifts",
      "hidden_holidays",
      "holidays",
      "mentions",
      "milestones",
      "not_a_duplicate",
      "notification_settings",
      "observances",
      "people",
      "pets",
      "phone_numbers",
      "postal_addresses",
      "relationship_dismissals",
      "relationships",
      "reminder_rules",
      "reminders",
      "self_person",
      "social_profiles",
      "taggings",
      "tags",
    ]);
  });

  it("never includes a device-local key or identity table", () => {
    for (const forbidden of [
      "content_key",
      "key_wrap",
      "sync_state",
      "account",
      "device",
    ]) {
      expect(tables).not.toContain(forbidden);
    }
  });
});
