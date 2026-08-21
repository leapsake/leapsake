import { afterEach, describe, expect, it } from "vitest";
import {
  FLAG_DEFAULTS,
  flag,
  flagSnapshot,
  parseFlagOverrides,
  resetFlagOverrides,
  setFlagOverrides,
  setLocalFlagOverrides,
  withFlags,
} from "../src/index.js";

afterEach(resetFlagOverrides);

describe("defaults", () => {
  it("ships multi-device off", () => {
    expect(flag("multiDevice")).toBe(false);
  });

  it("reads every flag with no overrides set", () => {
    expect(flagSnapshot()).toEqual(FLAG_DEFAULTS);
  });
});

describe("layering", () => {
  it("lets the environment override the default", () => {
    setFlagOverrides({ multiDevice: true });
    expect(flag("multiDevice")).toBe(true);
  });

  it("lets the local layer override the environment", () => {
    setFlagOverrides({ multiDevice: true });
    setLocalFlagOverrides({ multiDevice: false });
    expect(flag("multiDevice")).toBe(false);
  });

  it("falls back to the environment when the local layer is cleared", () => {
    setFlagOverrides({ multiDevice: true });
    setLocalFlagOverrides({ multiDevice: false });
    setLocalFlagOverrides({});
    expect(flag("multiDevice")).toBe(true);
  });

  it("replaces rather than merges, so a launch owns its whole set", () => {
    setFlagOverrides({ multiDevice: true });
    setFlagOverrides({});
    expect(flag("multiDevice")).toBe(false);
  });
});

describe("parseFlagOverrides", () => {
  it("treats a bare name as on", () => {
    expect(parseFlagOverrides("multiDevice")).toEqual({ multiDevice: true });
  });

  it("accepts an explicit value", () => {
    expect(parseFlagOverrides("multiDevice=false")).toEqual({
      multiDevice: false,
    });
    expect(parseFlagOverrides("multiDevice=true")).toEqual({
      multiDevice: true,
    });
  });

  it("splits on commas and whitespace", () => {
    expect(parseFlagOverrides(" multiDevice ,, ")).toEqual({
      multiDevice: true,
    });
  });

  it("treats an unset or empty spec as no overrides", () => {
    expect(parseFlagOverrides(undefined)).toEqual({});
    expect(parseFlagOverrides("")).toEqual({});
    expect(parseFlagOverrides("   ")).toEqual({});
  });

  it("throws on an unknown flag rather than silently ignoring it", () => {
    expect(() => parseFlagOverrides("multidevice")).toThrow(
      /Unknown feature flag/,
    );
    expect(() => parseFlagOverrides("multiDevice,nope")).toThrow(/nope/);
  });

  it("names the known flags in that error, so a typo is self-correcting", () => {
    expect(() => parseFlagOverrides("nope")).toThrow(/multiDevice/);
  });

  it("throws on a value that is neither true nor false", () => {
    expect(() => parseFlagOverrides("multiDevice=1")).toThrow(/must be/);
  });
});

describe("withFlags", () => {
  it("applies overrides for the duration of the call", async () => {
    const inside = await withFlags({ multiDevice: true }, () =>
      flag("multiDevice"),
    );
    expect(inside).toBe(true);
    expect(flag("multiDevice")).toBe(false);
  });

  it("waits for an async body before restoring", async () => {
    const inside = await withFlags({ multiDevice: true }, async () => {
      await Promise.resolve();
      return flag("multiDevice");
    });
    expect(inside).toBe(true);
    expect(flag("multiDevice")).toBe(false);
  });

  it("restores the previous local layer, not the default", async () => {
    setLocalFlagOverrides({ multiDevice: true });
    await withFlags({ multiDevice: false }, () => undefined);
    expect(flag("multiDevice")).toBe(true);
  });

  it("restores after the body throws", async () => {
    await expect(
      withFlags({ multiDevice: true }, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(flag("multiDevice")).toBe(false);
  });
});
