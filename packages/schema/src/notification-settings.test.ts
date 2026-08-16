import { describe, expect, it } from "vitest";
import {
  notificationModeSchema,
  notificationSettingsSchema,
} from "./notification-settings.js";

const validSettings = {
  id: crypto.randomUUID(),
  label: "iPhone",
  platform: "ios",
  mode: "digest" as const,
  deliveryMinute: 540,
  permissionState: "granted",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: null,
};

describe("notificationModeSchema", () => {
  it("accepts off, digest, and each", () => {
    for (const mode of ["off", "digest", "each"]) {
      expect(notificationModeSchema.parse(mode)).toBe(mode);
    }
  });

  it("rejects an unknown mode", () => {
    expect(() => notificationModeSchema.parse("weekly")).toThrow();
  });
});

describe("notificationSettingsSchema", () => {
  it("accepts a valid row", () => {
    expect(notificationSettingsSchema.parse(validSettings)).toEqual(
      validSettings,
    );
  });

  it("accepts null label, platform, and permissionState", () => {
    const bare = {
      ...validSettings,
      label: null,
      platform: null,
      permissionState: null,
    };
    expect(notificationSettingsSchema.parse(bare)).toEqual(bare);
  });

  it("accepts a non-null deletedAt", () => {
    const deleted = { ...validSettings, deletedAt: Date.now() };
    expect(notificationSettingsSchema.parse(deleted)).toEqual(deleted);
  });

  it("rejects an invalid mode", () => {
    expect(() =>
      notificationSettingsSchema.parse({ ...validSettings, mode: "hourly" }),
    ).toThrow();
  });

  it("rejects a non-integer deliveryMinute", () => {
    expect(() =>
      notificationSettingsSchema.parse({
        ...validSettings,
        deliveryMinute: 540.5,
      }),
    ).toThrow();
  });
});
