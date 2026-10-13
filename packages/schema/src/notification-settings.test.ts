import { describe, expect, it } from "vitest";
import {
  MAX_DELIVERY_TIMES,
  notificationModeSchema,
  notificationSettingsSchema,
} from "./notification-settings.js";

const validSettings = {
  id: crypto.randomUUID(),
  label: "iPhone",
  platform: "ios",
  mode: "digest" as const,
  deliveryMinutes: [540],
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

  it("accepts up to MAX_DELIVERY_TIMES delivery times", () => {
    const times = Array.from({ length: MAX_DELIVERY_TIMES }, (_, i) => i * 60);
    expect(
      notificationSettingsSchema.parse({
        ...validSettings,
        deliveryMinutes: times,
      }).deliveryMinutes,
    ).toEqual(times);
  });

  it.each([
    ["no times", []],
    [
      "more than MAX_DELIVERY_TIMES",
      Array.from({ length: MAX_DELIVERY_TIMES + 1 }, (_, i) => i * 60),
    ],
    ["a non-integer minute", [540.5]],
    ["a minute before midnight", [-1]],
    ["a minute past the end of the day", [24 * 60]],
  ])("rejects %s", (_, deliveryMinutes) => {
    expect(() =>
      notificationSettingsSchema.parse({ ...validSettings, deliveryMinutes }),
    ).toThrow();
  });
});
