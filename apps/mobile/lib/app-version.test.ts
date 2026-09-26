import { describe, expect, it } from "vitest";
import { versionLabel } from "./app-version";

describe("the version line", () => {
  it("names alpha and beta builds in full", () => {
    expect(versionLabel("0.1.0-alpha.4", "0.1.0")).toBe("v0.1.0-alpha.4");
    expect(versionLabel("0.1.0-beta.10", "0.1.0")).toBe("v0.1.0-beta.10");
  });

  it("shows only the core for rc, since that binary becomes the release", () => {
    expect(versionLabel("0.1.0-rc.1", "0.1.0")).toBe("v0.1.0");
  });

  it("shows only the core for a final", () => {
    expect(versionLabel("0.1.0", "0.1.0")).toBe("v0.1.0");
  });

  it("marks a build the release script did not make", () => {
    expect(versionLabel("dev", "0.1.0")).toBe("v0.1.0-dev");
    expect(versionLabel(undefined, "0.1.0")).toBe("v0.1.0-dev");
  });
});
