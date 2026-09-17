// The Android rungs are tested for the mistakes that reach an audience silently.
//
//   1. **The track mapping.** Play's closed track is named `alpha` over the API and its
//      `beta` is *open* testing — the whole internet. A rung table that drifted by one
//      name would publish a beta to strangers and report success.
//   2. **`final` refusing.** Until Play grants production access, `final` cannot publish
//      on Android, and it must say so in the preflight pass — after iOS has shipped is
//      too late.
//   3. **The signer.** A debug-signed release AAB builds, installs and is only rejected
//      at upload.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runChecks } from "../checks.mjs";
import android from "./android.mjs";

/** A repo root carrying just what these checks read. */
function repoWith({ notes = "Try the reminders.", icon = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "android-release-"));
  mkdirSync(join(root, "apps", "mobile", "assets"), { recursive: true });
  mkdirSync(join(root, "release-notes"), { recursive: true });
  writeFileSync(
    join(root, "apps", "mobile", "app.json"),
    JSON.stringify({
      expo: {
        ...(icon ? { icon: "./assets/icon.png" } : {}),
        android: { package: "com.leapsake.app" },
      },
    }),
  );
  if (icon)
    writeFileSync(join(root, "apps", "mobile", "assets", "icon.png"), "x");
  if (notes !== null) {
    writeFileSync(join(root, "release-notes", "whats-new.txt"), notes);
  }
  return root;
}

const checkNamed = async (stage, name, root) => {
  const failures = await runChecks(android.tiers[stage].requires, { root });
  return failures.find((failure) => failure.name === name)?.reason;
};

describe("the rung → track mapping", () => {
  it("sends beta to the closed track, which Play names alpha", () => {
    expect(android.tiers.beta.track).toBe("alpha");
  });

  it("sends alpha to the internal track", () => {
    expect(android.tiers.alpha.track).toBe("internal");
  });

  // Play's `beta` is open testing. Nothing here may target it — that is the whole
  // internet, not a tester group.
  it("never targets Play's open testing track", () => {
    const tracks = Object.values(android.tiers).map((tier) => tier.track);
    expect(tracks).not.toContain("beta");
  });

  it("keeps rc on the closed track until production access exists", () => {
    expect(android.tiers.rc.track).toBe("alpha");
    expect(android.tiers.rc.manual.join(" ")).toMatch(/closed track ONLY/i);
  });
});

describe("final", () => {
  it("refuses, naming what would unlock it", async () => {
    const failures = await runChecks(android.tiers.final.requires, {
      root: repoWith(),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatch(/production access/i);
    expect(failures[0].reason).toMatch(/12 testers/);
  });

  it("points at the escape hatch rather than just failing", async () => {
    const [failure] = await runChecks(android.tiers.final.requires, {
      root: repoWith(),
    });
    expect(failure.reason).toMatch(/--only=ios/);
  });
});

describe("release notes", () => {
  it("passes a normal note", async () => {
    expect(
      await checkNamed("beta", "release notes", repoWith()),
    ).toBeUndefined();
  });

  it("fails when the file is missing", async () => {
    const reason = await checkNamed(
      "beta",
      "release notes",
      repoWith({ notes: null }),
    );
    expect(reason).toMatch(/missing/);
  });

  it("fails when the file is empty", async () => {
    const reason = await checkNamed(
      "beta",
      "release notes",
      repoWith({ notes: "   " }),
    );
    expect(reason).toMatch(/empty/);
  });

  it("fails before the upload rejects an over-long note", async () => {
    const reason = await checkNamed(
      "beta",
      "release notes",
      repoWith({ notes: "x".repeat(501) }),
    );
    expect(reason).toMatch(/501 characters — Play allows 500/);
  });
});

describe("the app icon", () => {
  it("is required at beta, where strangers see it", async () => {
    const reason = await checkNamed(
      "beta",
      "app icon",
      repoWith({ icon: false }),
    );
    expect(reason).toMatch(/placeholder/);
  });

  // An internal build reaches only the owner, and gating it on the icon would make the
  // fastest rung the fussiest.
  it("is not required at alpha", () => {
    expect(android.tiers.alpha.requires).toHaveLength(0);
  });
});

describe("the target contract", () => {
  it("is ready, so a tag ships Android alongside iOS", () => {
    expect(android.status).toBe("ready");
  });

  it("has a rung for every stage the release path can ask for", () => {
    expect(Object.keys(android.tiers).sort()).toEqual([
      "alpha",
      "beta",
      "final",
      "rc",
    ]);
  });
});
