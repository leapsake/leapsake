// Submitting to the App Store is an ordered conversation with Apple — a version exists,
// carries notes, names a build, joins a submission, and only then is sent — and almost
// every step can legitimately have happened already, because a rejection is resubmitted
// against the *same* version record rather than a fresh one.
//
// That makes the tolerated failures the interesting part. A 409 meaning "already done" and
// a 409 meaning "this is broken" are the same status code, and getting the distinction
// wrong is invisible until a release either dies on a retry or sails past a real problem.
// None of it can be exercised for real without submitting an actual app, so the whole
// sequence runs here against a stubbed `fetch`, through the real client.
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAsc } from "../asc.mjs";
import { submitToAppStore } from "./ios.mjs";

/** A repo root carrying just the one file `submitToAppStore` reads. */
function rootWithNotes(text = "The first release.") {
  const root = mkdtempSync(join(tmpdir(), "ios-submit-"));
  mkdirSync(join(root, "release-notes"), { recursive: true });
  writeFileSync(join(root, "release-notes", "whats-new.txt"), text);
  return root;
}

function client() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const path = join(mkdtempSync(join(tmpdir(), "asc-")), "AuthKey_TEST.p8");
  writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }));
  return createAsc({ keyId: "K", issuerId: "I", keyPath: path });
}

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  headers: new Headers(),
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});

/**
 * Route each call by method and path, recording it.
 *
 * Keyed by `METHOD /path` rather than sequenced, so a test says what Apple's *state* is
 * and stays readable when the order of steps changes.
 */
function stubRoutes(routes) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const { pathname } = new URL(url);
    const method = init?.method ?? "GET";
    const key = `${method} ${pathname}`;
    const route = routes[key];
    calls.push({
      key,
      method,
      pathname,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    if (!route) throw new Error(`unstubbed call: ${key}`);
    return typeof route === "function" ? route(calls.length) : route;
  };
  return calls;
}

const APP = { id: "APP1" };
const BUILD = { id: "BUILD1", attributes: { version: "368500" } };

/** Apple with no version record yet — the first submission of a store version. */
const freshRoutes = () => ({
  "GET /v1/apps/APP1/appStoreVersions": answer(200, { data: [] }),
  "POST /v1/appStoreVersions": answer(201, {
    data: {
      id: "VER1",
      attributes: { appStoreState: "PREPARE_FOR_SUBMISSION" },
    },
  }),
  "GET /v1/appStoreVersions/VER1/appStoreVersionLocalizations": answer(200, {
    data: [{ id: "LOC1", attributes: { locale: "en-US" } }],
  }),
  "PATCH /v1/appStoreVersionLocalizations/LOC1": answer(200, {}),
  "PATCH /v1/appStoreVersions/VER1/relationships/build": answer(204),
  "GET /v1/apps/APP1/reviewSubmissions": answer(200, { data: [] }),
  "POST /v1/reviewSubmissions": answer(201, { data: { id: "SUB1" } }),
  "POST /v1/reviewSubmissionItems": answer(201, {}),
  "PATCH /v1/reviewSubmissions/SUB1": answer(200, {}),
});

const realFetch = globalThis.fetch;
let asc;
let root;

beforeEach(() => {
  asc = client();
  root = rootWithNotes();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const submit = () =>
  submitToAppStore({
    asc,
    app: APP,
    build: BUILD,
    root,
    storeVersion: "0.1.0",
  });

describe("submitToAppStore", () => {
  it("walks Apple's order: version, notes, build, submission, submit", async () => {
    const calls = stubRoutes(freshRoutes());
    await submit();
    expect(calls.map((each) => each.key)).toEqual([
      "GET /v1/apps/APP1/appStoreVersions",
      "POST /v1/appStoreVersions",
      "GET /v1/appStoreVersions/VER1/appStoreVersionLocalizations",
      "PATCH /v1/appStoreVersionLocalizations/LOC1",
      "PATCH /v1/appStoreVersions/VER1/relationships/build",
      "GET /v1/apps/APP1/reviewSubmissions",
      "POST /v1/reviewSubmissions",
      "POST /v1/reviewSubmissionItems",
      "PATCH /v1/reviewSubmissions/SUB1",
    ]);
  });

  it("creates the version for manual release, not automatic", async () => {
    // The whole human-at-the-last-step design rests on this one attribute: without it an
    // approval publishes to the public with nobody present.
    const calls = stubRoutes(freshRoutes());
    await submit();
    const created = calls.find(
      (each) => each.key === "POST /v1/appStoreVersions",
    );
    expect(created.body.data.attributes).toMatchObject({
      platform: "IOS",
      versionString: "0.1.0",
      releaseType: "MANUAL",
    });
  });

  it("sends the notes from the file, and marks the submission submitted", async () => {
    root = rootWithNotes("  Fixed the thing.  ");
    const calls = stubRoutes(freshRoutes());
    await submit();
    expect(
      calls.find(
        (each) =>
          each.pathname.includes("Localizations/") || each.key.includes("LOC1"),
      ).body.data.attributes.whatsNew,
    ).toBe("Fixed the thing.");
    expect(
      calls.find((each) => each.key === "PATCH /v1/reviewSubmissions/SUB1").body
        .data.attributes.submitted,
    ).toBe(true);
  });

  it("attaches the build the release actually uploaded", async () => {
    const calls = stubRoutes(freshRoutes());
    await submit();
    const attached = calls.find((each) =>
      each.key.endsWith("/relationships/build"),
    );
    expect(attached.body.data).toEqual({ type: "builds", id: "BUILD1" });
  });

  describe("resubmitting after a rejection", () => {
    it("reuses the existing version rather than making a second", async () => {
      // This is what stops a rejected 0.1.0 from spending the version string.
      const routes = {
        ...freshRoutes(),
        "GET /v1/apps/APP1/appStoreVersions": answer(200, {
          data: [{ id: "VER1", attributes: { appStoreState: "REJECTED" } }],
        }),
      };
      const calls = stubRoutes(routes);
      await submit();
      expect(
        calls.some((each) => each.key === "POST /v1/appStoreVersions"),
      ).toBe(false);
      expect(
        calls.some((each) => each.key.endsWith("/relationships/build")),
      ).toBe(true);
    });

    it("refuses a version Apple will not let it edit, and names the state", async () => {
      const routes = {
        ...freshRoutes(),
        "GET /v1/apps/APP1/appStoreVersions": answer(200, {
          data: [{ id: "VER1", attributes: { appStoreState: "IN_REVIEW" } }],
        }),
      };
      stubRoutes(routes);
      await expect(submit()).rejects.toThrow(/IN_REVIEW/);
    });

    it("reuses a review submission that is still open", async () => {
      const routes = {
        ...freshRoutes(),
        "GET /v1/apps/APP1/reviewSubmissions": answer(200, {
          data: [{ id: "SUB9", attributes: { state: "READY_FOR_REVIEW" } }],
        }),
        "POST /v1/reviewSubmissionItems": answer(201, {}),
        "PATCH /v1/reviewSubmissions/SUB9": answer(200, {}),
      };
      const calls = stubRoutes(routes);
      await submit();
      expect(
        calls.some((each) => each.key === "POST /v1/reviewSubmissions"),
      ).toBe(false);
      expect(
        calls.some((each) => each.key === "PATCH /v1/reviewSubmissions/SUB9"),
      ).toBe(true);
    });
  });

  describe("the 409s that mean 'already done'", () => {
    it("steps over notes Apple refuses on a first release", async () => {
      // A first version has nothing to be new against, and Apple rejects the field rather
      // than ignoring it. That is the app's history, not a broken release.
      const routes = {
        ...freshRoutes(),
        "PATCH /v1/appStoreVersionLocalizations/LOC1": answer(409, {
          errors: [
            { code: "X", detail: "whatsNew is not allowed on a first version" },
          ],
        }),
      };
      const calls = stubRoutes(routes);
      await submit();
      expect(
        calls.some((each) => each.key.endsWith("/relationships/build")),
      ).toBe(true);
    });

    it("tolerates the version already being in the submission", async () => {
      const routes = {
        ...freshRoutes(),
        "POST /v1/reviewSubmissionItems": answer(409, {
          errors: [{ code: "X", detail: "already added" }],
        }),
      };
      const calls = stubRoutes(routes);
      await submit();
      expect(
        calls.some((each) => each.key === "PATCH /v1/reviewSubmissions/SUB1"),
      ).toBe(true);
    });

    it("tolerates a submission Apple already has", async () => {
      const routes = {
        ...freshRoutes(),
        "PATCH /v1/reviewSubmissions/SUB1": answer(409, {
          errors: [{ code: "X", detail: "already submitted" }],
        }),
      };
      stubRoutes(routes);
      await expect(submit()).resolves.toBeUndefined();
    });
  });

  describe("the failures that must still be failures", () => {
    it("does not swallow a real error from the notes step", async () => {
      // 409/422 are tolerated there; a 400 is Apple saying the request is wrong.
      const routes = {
        ...freshRoutes(),
        "PATCH /v1/appStoreVersionLocalizations/LOC1": answer(400, {
          errors: [
            { code: "X", detail: "whatsNew exceeds the maximum length" },
          ],
        }),
      };
      stubRoutes(routes);
      await expect(submit()).rejects.toThrow(/exceeds the maximum length/);
    });

    it("does not swallow a failure to attach the build", async () => {
      // Submitting a version pointing at the wrong build, or none, is the worst possible
      // success — it reviews something other than what was uploaded.
      const routes = {
        ...freshRoutes(),
        "PATCH /v1/appStoreVersions/VER1/relationships/build": answer(409, {
          errors: [
            { code: "X", detail: "build is not valid for this version" },
          ],
        }),
      };
      stubRoutes(routes);
      await expect(submit()).rejects.toThrow(/not valid for this version/);
    });
  });
});
