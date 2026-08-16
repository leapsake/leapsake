import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type NotificationSettingsRepo,
  type SqliteDriver,
  createNotificationSettingsRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: NotificationSettingsRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createNotificationSettingsRepo(driver);
});

afterEach(() => {
  cleanup();
});

describe("notificationSettingsRepo", () => {
  it("reads undefined and lists nothing before any device has a policy", async () => {
    expect(await repo.get(crypto.randomUUID())).toBeUndefined();
    expect(await repo.list()).toEqual([]);
  });

  it("creates a device's row with defaults on first write", async () => {
    const deviceId = crypto.randomUUID();
    const settings = await repo.setPolicy(deviceId, {});
    expect(settings).toMatchObject({
      id: deviceId,
      label: null,
      platform: null,
      mode: "off",
      deliveryMinute: 540,
      permissionState: null,
      deletedAt: null,
    });
    expect(await repo.get(deviceId)).toEqual(settings);
  });

  it("merges a patch onto an existing row without clobbering other fields", async () => {
    const deviceId = crypto.randomUUID();
    await repo.setPolicy(deviceId, { label: "iPhone", platform: "ios" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const updated = await repo.setPolicy(deviceId, {
      mode: "each",
      deliveryMinute: 480,
    });

    expect(updated.label).toBe("iPhone");
    expect(updated.platform).toBe("ios");
    expect(updated.mode).toBe("each");
    expect(updated.deliveryMinute).toBe(480);

    // Exactly one row — a re-write merges in place.
    const rows = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM notification_settings",
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("writes permission state independently of the policy fields", async () => {
    const deviceId = crypto.randomUUID();
    await repo.setPolicy(deviceId, { mode: "digest" });
    const withPermission = await repo.setPermissionState(deviceId, "granted");

    expect(withPermission.mode).toBe("digest");
    expect(withPermission.permissionState).toBe("granted");
  });

  it("setPermissionState alone creates the row (defaults for everything else)", async () => {
    const deviceId = crypto.randomUUID();
    const settings = await repo.setPermissionState(deviceId, "denied");
    expect(settings.permissionState).toBe("denied");
    expect(settings.mode).toBe("off");
  });

  it("lists a device only once it has written a row", async () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await repo.setPolicy(a, { label: "Laptop" });
    expect((await repo.list()).map((s) => s.id)).toEqual([a]);

    await repo.setPolicy(b, { label: "Phone" });
    expect((await repo.list()).map((s) => s.id).sort()).toEqual([a, b].sort());
  });

  it("revives a soft-deleted row on the next write, keeping one physical row", async () => {
    const deviceId = crypto.randomUUID();
    await repo.setPolicy(deviceId, { mode: "each" });
    await repo.softDelete(deviceId);
    expect(await repo.get(deviceId)).toBeUndefined();

    const revived = await repo.setPolicy(deviceId, { mode: "digest" });
    expect(revived.deletedAt).toBeNull();
    expect(revived.mode).toBe("digest");

    const rows = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM notification_settings",
    );
    expect(rows[0]?.n).toBe(1);
  });
});
