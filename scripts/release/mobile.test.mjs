// The build number is a clock reading, and the two mobile targets build minutes apart.
// Nothing about that is visible until iOS and Android are sitting in two stores under one
// tag with numbers an archive's duration apart — at which point neither can be changed.
import { afterEach, describe, expect, it } from "vitest";

import { pinBuildNumber } from "./mobile.mjs";

const original = process.env.LEAPSAKE_BUILD_NUMBER;
afterEach(() => {
  if (original === undefined) delete process.env.LEAPSAKE_BUILD_NUMBER;
  else process.env.LEAPSAKE_BUILD_NUMBER = original;
});

describe("pinning the build number", () => {
  it("pins the first resolution so a later target reuses it", () => {
    delete process.env.LEAPSAKE_BUILD_NUMBER;

    const ios = pinBuildNumber({ ios: { buildNumber: "371753" } });
    // The second target resolves its own config minutes later, which — unpinned — would
    // read a larger number off the clock.
    const android = pinBuildNumber({ android: { versionCode: 371768 } });

    expect(ios).toBe(371753);
    expect(android).toBe(371753);
  });

  it("leaves an explicit pin alone, so a rebuild reproduces its artifact", () => {
    process.env.LEAPSAKE_BUILD_NUMBER = "368157";

    expect(pinBuildNumber({ android: { versionCode: 371768 } })).toBe(368157);
    expect(process.env.LEAPSAKE_BUILD_NUMBER).toBe("368157");
  });

  it("refuses a config that resolved no build number at all", () => {
    delete process.env.LEAPSAKE_BUILD_NUMBER;

    expect(() => pinBuildNumber({ ios: {}, android: {} })).toThrow(
      /resolved no build number/,
    );
  });
});
