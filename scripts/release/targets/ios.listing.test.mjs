// The `rc` listing check, against a stubbed App Store Connect: it must name each field
// App Review would find empty, and pass a listing that is complete.
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runChecks } from "../checks.mjs";
import ios from "./ios.mjs";

function repoWith({ supportsTablet = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ios-listing-"));
  mkdirSync(join(root, "apps", "mobile"), { recursive: true });
  writeFileSync(
    join(root, "apps", "mobile", "app.json"),
    JSON.stringify({
      expo: { ios: { bundleIdentifier: "com.leapsake.app", supportsTablet } },
    }),
  );
  return root;
}

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: `status ${status}`,
  headers: new Headers(),
  text: async () => (body === undefined ? "" : JSON.stringify(body)),
});

function stubRoutes(routes) {
  globalThis.fetch = async (url) => {
    const key = `GET ${new URL(url).pathname}`;
    if (!(key in routes)) throw new Error(`unstubbed call: ${key}`);
    return answer(200, routes[key]);
  };
}

const shots = {
  data: [{ attributes: { assetDeliveryState: { state: "COMPLETE" } } }],
};

/** A listing with every field App Review reads filled in. */
const complete = () => ({
  "GET /v1/apps": { data: [{ id: "APP1" }] },
  "GET /v1/apps/APP1/appInfos": {
    data: [
      {
        id: "INFO1",
        attributes: {
          state: "PREPARE_FOR_SUBMISSION",
          appStoreAgeRating: "FOUR_PLUS",
        },
      },
    ],
  },
  "GET /v1/appInfos/INFO1/primaryCategory": { data: { id: "LIFESTYLE" } },
  "GET /v1/appInfos/INFO1/appInfoLocalizations": {
    data: [
      { attributes: { privacyPolicyUrl: "https://leapsake.com/privacy" } },
    ],
  },
  "GET /v1/apps/APP1/appStoreVersions": {
    data: [{ id: "VER1", attributes: {} }],
  },
  "GET /v1/appStoreVersions/VER1/appStoreVersionLocalizations": {
    data: [
      {
        id: "LOC1",
        attributes: {
          description: "A private place to remember the people you care about.",
          keywords: "people,birthdays",
          supportUrl: "https://leapsake.com/support",
        },
      },
    ],
  },
  "GET /v1/appStoreVersionLocalizations/LOC1/appScreenshotSets": {
    data: [
      { id: "SET1", attributes: { screenshotDisplayType: "APP_IPHONE_67" } },
      {
        id: "SET2",
        attributes: { screenshotDisplayType: "APP_IPAD_PRO_3GEN_129" },
      },
    ],
  },
  "GET /v1/appScreenshotSets/SET1/appScreenshots": shots,
  "GET /v1/appScreenshotSets/SET2/appScreenshots": shots,
});

const listingCheck = ios.tiers.rc.requires.filter(
  (each) => each.name === "App Store listing",
);
const reasonFor = async (root) => {
  const failures = await runChecks(listingCheck, {
    root,
    storeVersion: "0.1.0",
  });
  return failures[0]?.reason;
};

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.APPLE_APP_STORE_CONNECT_KEY_ID = "K";
  process.env.APPLE_APP_STORE_CONNECT_ISSUER_ID = "I";
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const path = join(
    mkdtempSync(join(tmpdir(), "apple-app-store-connect-")),
    "AuthKey_TEST.p8",
  );
  writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }));
  process.env.APPLE_APP_STORE_CONNECT_KEY_PATH = path;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the App Store listing check", () => {
  it("is on the rc rung", () => {
    expect(listingCheck).toHaveLength(1);
  });

  it("passes a complete listing", async () => {
    stubRoutes(complete());
    await expect(reasonFor(repoWith())).resolves.toBeUndefined();
  });

  it("names every empty field App Review would read", async () => {
    stubRoutes({
      ...complete(),
      "GET /v1/apps/APP1/appInfos": {
        data: [
          { id: "INFO1", attributes: { state: "PREPARE_FOR_SUBMISSION" } },
        ],
      },
      "GET /v1/appInfos/INFO1/primaryCategory": { data: null },
      "GET /v1/appInfos/INFO1/appInfoLocalizations": {
        data: [{ attributes: {} }],
      },
      "GET /v1/appStoreVersions/VER1/appStoreVersionLocalizations": {
        data: [{ id: "LOC1", attributes: { description: " " } }],
      },
      "GET /v1/appStoreVersionLocalizations/LOC1/appScreenshotSets": {
        data: [],
      },
    });
    const reason = await reasonFor(repoWith());
    for (const field of [
      "age rating",
      "primary category",
      "privacy policy URL",
      "no description",
      "no keywords",
      "no support URL",
      '6.9" iPhone screenshots',
      '13" iPad screenshots',
    ]) {
      expect(reason).toContain(field);
    }
  });

  it("does not count screenshots Apple has not finished processing", async () => {
    stubRoutes({
      ...complete(),
      "GET /v1/appScreenshotSets/SET1/appScreenshots": {
        data: [
          { attributes: { assetDeliveryState: { state: "UPLOAD_COMPLETE" } } },
        ],
      },
    });
    await expect(reasonFor(repoWith())).resolves.toContain('6.9" iPhone');
  });

  it("asks for iPad screenshots only from a universal app", async () => {
    stubRoutes({
      ...complete(),
      "GET /v1/appStoreVersionLocalizations/LOC1/appScreenshotSets": {
        data: [
          {
            id: "SET1",
            attributes: { screenshotDisplayType: "APP_IPHONE_67" },
          },
        ],
      },
    });
    await expect(
      reasonFor(repoWith({ supportsTablet: false })),
    ).resolves.toBeUndefined();
  });

  it("asks for the version record when rc would have nothing to submit", async () => {
    stubRoutes({
      ...complete(),
      "GET /v1/apps/APP1/appStoreVersions": { data: [] },
    });
    await expect(reasonFor(repoWith())).resolves.toContain(
      "no App Store version 0.1.0",
    );
  });
});
