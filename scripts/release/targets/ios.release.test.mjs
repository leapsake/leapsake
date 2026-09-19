// Going live is the one irreversible outward step in the whole path, and the one tag that
// must not be approximately right: `vX.Y.Z` claims "this commit is what the public got".
//
// Two things can make that claim false, and neither is visible at the time. Apple can be
// asked to release a version it has not approved, and the commit behind the live build can
// be unknowable — no receipt, or two claiming the same build number. Both must refuse
// rather than proceed, and the refusal has to happen *before* the app is made public, so
// the sequence is driven here against a stubbed `fetch`.
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordShipment } from "../receipts.mjs";
import ios, { releaseToPublic } from "./ios.mjs";

/** A git repo carrying app.json and, optionally, receipts for a build. */
function repoWith({ builds = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ios-release-"));
  mkdirSync(join(root, "apps", "mobile"), { recursive: true });
  writeFileSync(
    join(root, "apps", "mobile", "app.json"),
    JSON.stringify({ expo: { ios: { bundleIdentifier: "com.leapsake.app" } } }),
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "T");
  git("commit", "-q", "--allow-empty", "-m", "one");
  const commit = git("rev-parse", "HEAD");
  for (const build of builds) {
    recordShipment(root, commit, {
      tag: "v0.1.0-rc.1",
      target: "ios",
      buildNumber: build,
    });
  }
  return { root, commit };
}

function stubRoutes(routes) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const { pathname } = new URL(url);
    const key = `${init?.method ?? "GET"} ${pathname}`;
    calls.push({ key, body: init?.body ? JSON.parse(init.body) : undefined });
    const route = routes[key];
    if (!route) throw new Error(`unstubbed call: ${key}`);
    return route;
  };
  return calls;
}

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  headers: new Headers(),
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});

/** Apple with 0.1.0 approved and waiting on us, build 368500 attached. */
const approved = (state = "PENDING_DEVELOPER_RELEASE") => ({
  "GET /v1/apps": answer(200, { data: [{ id: "APP1" }] }),
  "GET /v1/apps/APP1/appStoreVersions": answer(200, {
    data: [{ id: "VER1", attributes: { appStoreState: state } }],
  }),
  "GET /v1/appStoreVersions/VER1/build": answer(200, {
    data: { id: "BUILD1", attributes: { version: "368500" } },
  }),
  "POST /v1/appStoreVersionReleaseRequests": answer(201, {}),
});

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.ASC_KEY_ID = "K";
  process.env.ASC_ISSUER_ID = "I";
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const path = join(mkdtempSync(join(tmpdir(), "asc-")), "AuthKey_TEST.p8");
  writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }));
  process.env.ASC_KEY_PATH = path;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("releaseToPublic", () => {
  it("releases an approved version and reports the commit behind it", async () => {
    const { root, commit } = repoWith({ builds: ["368500"] });
    const calls = stubRoutes(approved());
    await expect(
      releaseToPublic({ root, storeVersion: "0.1.0" }),
    ).resolves.toEqual({ commit, buildNumber: "368500" });
    expect(
      calls.some(
        (each) => each.key === "POST /v1/appStoreVersionReleaseRequests",
      ),
    ).toBe(true);
  });

  it("is idempotent once the version is already on sale", async () => {
    // A re-run after a release that succeeded should still resolve the commit and tag,
    // not fail because the work was already done.
    const { root, commit } = repoWith({ builds: ["368500"] });
    const calls = stubRoutes(approved("READY_FOR_SALE"));
    await expect(
      releaseToPublic({ root, storeVersion: "0.1.0" }),
    ).resolves.toEqual({ commit, buildNumber: "368500" });
    expect(
      calls.some(
        (each) => each.key === "POST /v1/appStoreVersionReleaseRequests",
      ),
    ).toBe(false);
  });

  describe("refuses rather than making a false claim", () => {
    it("will not release a version Apple has not approved", async () => {
      const { root } = repoWith({ builds: ["368500"] });
      stubRoutes(approved("IN_REVIEW"));
      await expect(
        releaseToPublic({ root, storeVersion: "0.1.0" }),
      ).rejects.toThrow(/IN_REVIEW/);
    });

    it("will not proceed when no version record exists", async () => {
      const { root } = repoWith({ builds: ["368500"] });
      stubRoutes({
        ...approved(),
        "GET /v1/apps/APP1/appStoreVersions": answer(200, { data: [] }),
      });
      await expect(
        releaseToPublic({ root, storeVersion: "0.1.0" }),
      ).rejects.toThrow(/never submitted/);
    });

    it("refuses when no receipt names the live build — before releasing", async () => {
      // The refusal has to come first: discovering the commit is unknowable *after* the
      // app is public leaves a released version nothing can honestly tag.
      const { root } = repoWith({ builds: [] });
      const calls = stubRoutes(approved());
      await expect(
        releaseToPublic({ root, storeVersion: "0.1.0" }),
      ).rejects.toThrow(/--commit=/);
      expect(
        calls.some(
          (each) => each.key === "POST /v1/appStoreVersionReleaseRequests",
        ),
      ).toBe(false);
    });

    it("refuses when two receipts claim the same build", async () => {
      const { root } = repoWith({ builds: ["368500", "368500"] });
      stubRoutes(approved());
      await expect(
        releaseToPublic({ root, storeVersion: "0.1.0" }),
      ).rejects.toThrow(/cannot be established/);
    });
  });

  it("takes --commit as the escape when receipts cannot say", async () => {
    const { root } = repoWith({ builds: [] });
    stubRoutes(approved());
    await expect(
      releaseToPublic({ root, storeVersion: "0.1.0", commit: "deadbeefcafe" }),
    ).resolves.toMatchObject({ commit: "deadbeefcafe" });
  });
});

describe("approved", () => {
  it("names the commit behind the approved build without releasing it", async () => {
    const { root, commit } = repoWith({ builds: ["368500"] });
    const calls = stubRoutes(approved());
    await expect(
      ios.approved({ root, storeVersion: "0.1.0" }),
    ).resolves.toEqual({ commit, buildNumber: "368500" });
    expect(calls.map((each) => each.key)).not.toContain(
      "POST /v1/appStoreVersionReleaseRequests",
    );
  });

  it("refuses a version Apple has not approved", async () => {
    const { root } = repoWith({ builds: ["368500"] });
    stubRoutes(approved("IN_REVIEW"));
    await expect(ios.approved({ root, storeVersion: "0.1.0" })).rejects.toThrow(
      /IN_REVIEW/,
    );
  });
});
