// The Android rungs are tested for the mistakes that reach an audience silently.
//
//   1. **The track mapping.** Play's closed track is named `alpha` over the API and its
//      `beta` is *open* testing — the whole internet. A rung table that drifted by one
//      name would publish a beta to strangers and report success.
//   2. **`final` blocked.** Until Play grants production access, Android's `final` is a
//      blocked cell, reported with the reason and skipped.
//   3. **The signer.** A debug-signed release AAB builds, installs and is only rejected
//      at upload.
//   4. **The body `publish()` sends.** The track it names, the status it asks for, the
//      release name and the notes are only decided here, and a rollout cannot be taken
//      back — so they are asserted against a stubbed `fetch` rather than discovered in
//      the Console.
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
  it("is a blocked cell naming what would unlock it", () => {
    expect(android.tiers.final.status).toBe("blocked");
    expect(android.tiers.final.note).toMatch(/production access/i);
    expect(android.tiers.final.note).toMatch(/12 testers/);
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
  it("is not required at alpha", async () => {
    expect(
      await checkNamed("alpha", "app icon", repoWith({ icon: false })),
    ).toBeUndefined();
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

// ── publish(), against a stubbed Play ────────────────────────────────────────────────

const EDIT = "EDIT1";
const CODE = 373668;
const APP = "/androidpublisher/v3/applications/com.leapsake.app";

// One keypair for the file: RSA generation is the slowest thing here, and the assertion is
// signed but never verified by the stub.
const PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

/** A service-account key on disk, named the way `playFromEnv` expects. */
function serviceAccount() {
  const path = join(
    mkdtempSync(join(tmpdir(), "play-key-")),
    "service-account.json",
  );
  writeFileSync(
    path,
    JSON.stringify({
      client_email: "release@leapsake.iam.gserviceaccount.com",
      private_key: PRIVATE_KEY,
    }),
  );
  process.env.PLAY_SERVICE_ACCOUNT_PATH = path;
}

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  headers: new Headers(),
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});

/**
 * Every call a publish makes, answered; returns the calls as they happen.
 *
 * Both track routes are stubbed so a rung aiming at the wrong one fails on the assertion
 * rather than on an unstubbed route, which would read as a transport error and retry.
 */
function stubPlay(overrides = {}) {
  const routes = {
    "POST /token": answer(200, { access_token: "T", expires_in: 3600 }),
    [`POST ${APP}/edits`]: answer(200, { id: EDIT }),
    [`POST /upload${APP}/edits/${EDIT}/bundles`]: answer(200, {
      versionCode: CODE,
    }),
    [`PUT ${APP}/edits/${EDIT}/tracks/alpha`]: answer(200, {}),
    [`PUT ${APP}/edits/${EDIT}/tracks/internal`]: answer(200, {}),
    [`PUT ${APP}/edits/${EDIT}/tracks/production`]: answer(200, {}),
    [`POST ${APP}/edits/${EDIT}:commit`]: answer(200, {}),
    [`DELETE ${APP}/edits/${EDIT}`]: answer(200, {}),
    ...overrides,
  };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
    calls.push({
      key,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const route = routes[key];
    if (!route) throw new Error(`unstubbed call: ${key}`);
    return route;
  };
  return calls;
}

/** The AAB `publish` uploads — contents are never inspected, only read. */
function artifactIn(root) {
  const aab = join(root, "app-release.aab");
  writeFileSync(aab, "an-app-bundle");
  return { files: { aab }, buildNumber: CODE, bundleId: "com.leapsake.app" };
}

const trackPut = (calls) => calls.find((call) => call.key.startsWith("PUT "));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PLAY_SERVICE_ACCOUNT_PATH;
});

describe("publish", () => {
  it("puts a beta on the closed track, as one completed release", async () => {
    const root = repoWith({ notes: "This is the first release." });
    serviceAccount();
    const calls = stubPlay();

    await android.publish({
      artifact: artifactIn(root),
      root,
      stage: "beta",
      version: "0.1.0-beta.8",
    });

    const put = trackPut(calls);
    expect(put.key).toBe(`PUT ${APP}/edits/${EDIT}/tracks/alpha`);
    expect(put.body.track).toBe("alpha");
    expect(put.body.releases).toHaveLength(1);
    expect(put.body.releases[0]).toMatchObject({
      status: "completed",
      versionCodes: [String(CODE)],
      releaseNotes: [{ language: "en-US", text: "This is the first release." }],
    });
    // The edit is what makes the upload real; nothing has shipped until it commits.
    expect(calls.at(-1).key).toBe(`POST ${APP}/edits/${EDIT}:commit`);
  });

  it("names the release for the full version, not the store version", async () => {
    // Play names a release from the bundle's versionName when the API sends none — and
    // that is the store version, so every rung of 0.1.0 would read "0.1.0" in the Console.
    const root = repoWith();
    serviceAccount();
    const calls = stubPlay();

    await android.publish({
      artifact: artifactIn(root),
      root,
      stage: "beta",
      version: "0.1.0-beta.8",
    });

    expect(trackPut(calls).body.releases[0].name).toBe("0.1.0-beta.8");
  });

  it("sends an alpha rung to the internal track", async () => {
    const root = repoWith();
    serviceAccount();
    const calls = stubPlay();

    await android.publish({
      artifact: artifactIn(root),
      root,
      stage: "alpha",
      version: "0.1.0-alpha.4",
    });

    expect(trackPut(calls).body.track).toBe("internal");
  });

  it("abandons the edit when Play accepts a version code we did not build", async () => {
    // A mismatch means the upload landed somewhere unexpected. Committing anyway would
    // spend a version code on a bundle nobody can account for, so the edit is thrown away.
    const root = repoWith();
    serviceAccount();
    const calls = stubPlay({
      [`POST /upload${APP}/edits/${EDIT}/bundles`]: answer(200, {
        versionCode: 999999,
      }),
    });

    await expect(
      android.publish({
        artifact: artifactIn(root),
        root,
        stage: "beta",
        version: "0.1.0-beta.8",
      }),
    ).rejects.toThrow(/999999 is not the 373668 that was built/);

    expect(calls.map((call) => call.key)).toContain(
      `DELETE ${APP}/edits/${EDIT}`,
    );
    expect(calls.map((call) => call.key)).not.toContain(
      `POST ${APP}/edits/${EDIT}:commit`,
    );
  });
});

describe("the Console preconditions", () => {
  const CHECK = "Play Console preconditions";
  const RELEASES = [
    { name: "0.1.0-beta.9", status: "completed", versionCodes: [String(CODE)] },
  ];
  const withTrack = (track, overrides = {}) =>
    stubPlay({
      [`GET ${APP}/edits/${EDIT}/tracks/${track}`]: answer(200, {
        track,
        releases: RELEASES,
      }),
      [`POST ${APP}/edits/${EDIT}:validate`]: answer(200, {}),
      ...overrides,
    });

  it("passes when Play validates the edit", async () => {
    serviceAccount();
    const calls = withTrack("alpha");
    expect(await checkNamed("beta", CHECK, repoWith())).toBeUndefined();
    expect(calls.map((call) => call.key)).toContain(
      `POST ${APP}/edits/${EDIT}:validate`,
    );
  });

  // The whole point is that it costs nothing: a committed edit would spend a version code
  // for a question, and this runs before every release.
  it("abandons the edit and never commits it", async () => {
    serviceAccount();
    const calls = withTrack("alpha");
    await checkNamed("beta", CHECK, repoWith());
    const keys = calls.map((call) => call.key);
    expect(keys).toContain(`DELETE ${APP}/edits/${EDIT}`);
    expect(keys).not.toContain(`POST ${APP}/edits/${EDIT}:commit`);
  });

  // The refusal this exists for, in the words Play used on 2026-09-17 — at the commit,
  // after a build and an upload had already been spent.
  it("reports what Play refused, before anything is built", async () => {
    serviceAccount();
    withTrack("alpha", {
      [`POST ${APP}/edits/${EDIT}:validate`]: answer(400, {
        error: {
          message:
            "You must declare the use of advertising ID in Play Console.",
        },
      }),
    });
    const reason = await checkNamed("beta", CHECK, repoWith());
    expect(reason).toMatch(/advertising ID/);
    expect(reason).toMatch(/alpha track/);
  });

  // Each rung asks about its own track: a check that always probed the closed one would
  // pass while the track being published to was the broken one.
  it("asks about the track the rung publishes to", async () => {
    serviceAccount();
    const calls = withTrack("internal");
    expect(await checkNamed("alpha", CHECK, repoWith())).toBeUndefined();
    expect(calls.map((call) => call.key)).toContain(
      `GET ${APP}/edits/${EDIT}/tracks/internal`,
    );
  });

  // A track Play has never released to answers with no releases; an empty array is not the
  // shape a publish sends, so there is nothing to write back.
  it("writes nothing back to a track that has no releases", async () => {
    serviceAccount();
    const calls = stubPlay({
      [`GET ${APP}/edits/${EDIT}/tracks/production`]: answer(200, {
        track: "production",
      }),
      [`POST ${APP}/edits/${EDIT}:validate`]: answer(200, {}),
    });
    await checkNamed("final", CHECK, repoWith());
    expect(calls.map((call) => call.key)).not.toContain(
      `PUT ${APP}/edits/${EDIT}/tracks/production`,
    );
  });

  it("is skipped without credentials, which serviceAccount reports instead", async () => {
    expect(await checkNamed("beta", CHECK, repoWith())).toBeUndefined();
  });
});
