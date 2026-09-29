// The iOS target: App Store Connect from a local archive, no Xcode session.
// See `scripts/release/README.md` → _The iOS target_.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  AppleAppStoreConnectError,
  appleAppStoreConnectFromEnv,
} from "../apple-app-store-connect.mjs";
import { envSet, fileAt } from "../checks.mjs";
import {
  MOBILE,
  appIcon,
  must,
  readAppJson,
  pinnedConfig,
} from "../mobile.mjs";
import { commitOfBuild } from "../receipts.mjs";
import { BUNDLE_IN, assertNoTestOnlyCode } from "../test-only.mjs";
import { signingFilesProblem, stageSigningIdentity } from "./ios-signing.mjs";

/** Full Xcode, as the Command Line Tools cannot archive. */
const xcodeSelected = {
  name: "Xcode",
  check: () => {
    if (process.platform !== "darwin") {
      return `an iOS archive needs macOS; this is ${process.platform}`;
    }
    let selected;
    try {
      selected = execFileSync("xcode-select", ["-p"], {
        encoding: "utf8",
      }).trim();
    } catch {
      return "xcode-select is not available — install Xcode and run `sudo xcodebuild -runFirstLaunch`";
    }
    // Resolved first, so a symlinked selection is judged on where it lands.
    const app = dirname(dirname(resolve(selected)));
    return app.endsWith(".app")
      ? undefined
      : `xcode-select points at "${selected}" (Command Line Tools) — xcodebuild needs full Xcode: sudo xcode-select -s /Applications/Xcode.app`;
  },
};

/** Export compliance declared in the build, so no upload waits on a click;
 *  see the README. */
const exportCompliance = {
  name: "export compliance",
  check: ({ root }) => {
    const value =
      readAppJson(root).expo?.ios?.infoPlist?.ITSAppUsesNonExemptEncryption;
    return typeof value === "boolean"
      ? undefined
      : "apps/mobile/app.json sets no ios.infoPlist.ITSAppUsesNonExemptEncryption — every upload will stall at Missing Compliance, undistributable until answered by hand";
  },
};

const signing = [
  envSet("APPLE_TEAM_ID", "the archive passes it as DEVELOPMENT_TEAM"),
  envSet(
    "APPLE_IOS_PROVISIONING_PROFILE",
    "manual signing needs an explicit App Store distribution profile name",
  ),
  { name: "runner signing files", check: () => signingFilesProblem() },
];

/** CocoaPods, checked before a prebuild deletes the native project. */
const cocoapods = {
  name: "CocoaPods",
  check: () => {
    if (process.platform !== "darwin") return undefined;
    const run = spawnSync("pod", ["--version"], { stdio: "ignore" });
    return run.status === 0
      ? undefined
      : "`pod` is not on PATH — expo prebuild installs the iOS pods with it";
  },
};

// One API key for the upload and, later, notarization; it runs unattended.
const appleAppStoreConnectKey = [
  // Only its existence matters; keep the `AuthKey_<id>.p8` name, which
  // `.gitignore` excludes.
  fileAt(
    "APPLE_APP_STORE_CONNECT_KEY_PATH",
    "the upload authenticates with it",
    { suffix: ".p8" },
  ),
  envSet(
    "APPLE_APP_STORE_CONNECT_KEY_ID",
    "it identifies which App Store Connect key is in use",
  ),
  envSet(
    "APPLE_APP_STORE_CONNECT_ISSUER_ID",
    "App Store Connect keys are scoped to an issuer",
  ),
];

/** _What to Test_, the plain-text note every external tester reads. */
const WHAT_TO_TEST = (root) => join(root, "release-notes", "what-to-test.txt");
const WHATS_NEW = (root) => join(root, "release-notes", "whats-new.txt");
const WHATS_NEW_MAX = 4000; // Apple's limit; longer is rejected at PATCH.

const whatToTest = {
  name: "what to test",
  check: ({ root }) => {
    const path = WHAT_TO_TEST(root);
    if (!existsSync(path)) {
      return `release-notes/what-to-test.txt does not exist — every external tester reads it before installing. Write it first`;
    }
    const text = readFileSync(path, "utf8").trim();
    if (!text) return "release-notes/what-to-test.txt is empty";
    if (text.length > WHATS_NEW_MAX) {
      return `release-notes/what-to-test.txt is ${text.length} characters; App Store Connect accepts ${WHATS_NEW_MAX}`;
    }
    return undefined;
  },
};

/** The App Store's release notes, for strangers, so a file of their own. */
const whatsNew = {
  name: "what's new",
  check: ({ root }) => {
    const path = WHATS_NEW(root);
    if (!existsSync(path)) {
      return "release-notes/whats-new.txt does not exist — it is what the App Store shows about this version. Write it first";
    }
    const text = readFileSync(path, "utf8").trim();
    if (!text) return "release-notes/whats-new.txt is empty";
    if (text.length > WHATS_NEW_MAX) {
      return `release-notes/whats-new.txt is ${text.length} characters; App Store Connect accepts ${WHATS_NEW_MAX}`;
    }
    return undefined;
  },
};

const betaGroup = envSet(
  "APPLE_APP_STORE_CONNECT_BETA_GROUP",
  "the external tester group's name is how the release finds it; create the group in App Store Connect → TestFlight",
);

/** The preflight's one live probe: the key's role, the external group and the
 *  record's beta setup. See the README. */
const appleAppStoreConnectSetup = {
  name: "App Store Connect setup",
  check: async ({ root }) => {
    // Missing credentials are reported once, by their own checks.
    if (
      !process.env.APPLE_APP_STORE_CONNECT_KEY_ID?.trim() ||
      !process.env.APPLE_APP_STORE_CONNECT_ISSUER_ID?.trim() ||
      !process.env.APPLE_APP_STORE_CONNECT_KEY_PATH?.trim()
    ) {
      return undefined;
    }
    const groupName = process.env.APPLE_APP_STORE_CONNECT_BETA_GROUP?.trim();
    const bundleId = readAppJson(root).expo?.ios?.bundleIdentifier;
    const appleAppStoreConnect = appleAppStoreConnectFromEnv();

    let app;
    try {
      const apps = await appleAppStoreConnect.get("/v1/apps", {
        query: { "filter[bundleId]": bundleId, limit: 1 },
      });
      app = apps?.data?.[0];
    } catch (error) {
      if (
        error instanceof AppleAppStoreConnectError &&
        (error.status === 401 || error.status === 403)
      ) {
        return (
          `the App Store Connect key was refused (${error.status}). Uploading works with ` +
          "the Developer role; reading beta groups, attaching build notes and submitting " +
          "for beta review need App Manager. Check the key in App Store Connect → Users " +
          "and Access → Integrations — a different role means a new key, and the .p8 " +
          "downloads exactly once"
        );
      }
      return `could not reach App Store Connect: ${error.message}`;
    }
    if (!app) {
      return `App Store Connect has no app with bundle id ${bundleId} — the record is created by hand, and its bundle id cannot be edited afterwards`;
    }

    const missing = [];
    try {
      // The configured group must exist on this app, and be external.
      if (groupName) {
        const groups = await appleAppStoreConnect.get("/v1/betaGroups", {
          query: {
            "filter[app]": app.id,
            "filter[name]": groupName,
            limit: 10,
          },
        });
        const group = groups?.data?.find(
          (each) => each.attributes?.name === groupName,
        );
        if (!group) {
          missing.push(
            `no beta group named "${groupName}" on this app (APPLE_APP_STORE_CONNECT_BETA_GROUP) — create it in App Store Connect → TestFlight`,
          );
        } else if (group.attributes?.isInternalGroup) {
          missing.push(
            `"${groupName}" is an internal group — a build added to it skips beta review and reaches only App Store Connect users, which is the alpha rung`,
          );
        }
      }

      // Test Information: the feedback address and description a tester sees.
      const localizations = await appleAppStoreConnect.get(
        `/v1/apps/${app.id}/betaAppLocalizations`,
        { query: { limit: 10 } },
      );
      if (
        !(localizations?.data ?? []).some(
          (each) => each.attributes?.feedbackEmail,
        )
      ) {
        missing.push(
          "Test Information is empty — set the beta description and feedback email in App Store Connect → TestFlight → Test Information",
        );
      }

      // Beta App Review Information: who Apple contacts, and with what.
      const detail = await appleAppStoreConnect.get(
        `/v1/apps/${app.id}/betaAppReviewDetail`,
      );
      const review = detail?.data?.attributes ?? {};
      if (!review.contactEmail || !review.contactPhone) {
        missing.push(
          "Beta App Review Information has no contact email/phone — Apple refuses the submission without them",
        );
      }
      if (review.demoAccountRequired !== false) {
        missing.push(
          'Beta App Review Information does not say "no sign-in required" (demoAccountRequired is not false) — Leapsake works fully local with no account, and a reviewer who assumes otherwise rejects the build',
        );
      }
      if (!review.notes?.trim()) {
        missing.push(
          "Beta App Review Information has no review notes — say plainly that no account is needed and how to reach the main flows",
        );
      }
    } catch (error) {
      return `could not read this app's TestFlight setup: ${error.message}`;
    }

    return missing.length === 0
      ? undefined
      : `App Store Connect is not ready for external testing:\n        - ${missing.join("\n        - ")}`;
  },
};

/** The required screenshot slots: 6.9" iPhone, and 13" iPad if universal. */
const IPHONE_SCREENSHOTS = "APP_IPHONE_67";
const IPAD_SCREENSHOTS = "APP_IPAD_PRO_3GEN_129";

/** Whether the app has a price schedule; Apple answers 404 until one is set. */
async function hasPrice(appleAppStoreConnect, appId) {
  try {
    const prices = await appleAppStoreConnect.get(
      `/v1/appPriceSchedules/${appId}/manualPrices`,
      { query: { limit: 1 } },
    );
    return (prices?.data ?? []).length > 0;
  } catch (error) {
    if (error instanceof AppleAppStoreConnectError && error.status === 404) {
      return false;
    }
    throw error;
  }
}

const appleAppStoreListing = {
  name: "App Store listing",
  check: async ({ root, storeVersion }) => {
    if (
      !process.env.APPLE_APP_STORE_CONNECT_KEY_ID?.trim() ||
      !process.env.APPLE_APP_STORE_CONNECT_ISSUER_ID?.trim() ||
      !process.env.APPLE_APP_STORE_CONNECT_KEY_PATH?.trim()
    ) {
      return undefined;
    }
    const ios = readAppJson(root).expo?.ios ?? {};
    const appleAppStoreConnect = appleAppStoreConnectFromEnv();
    const missing = [];
    try {
      const apps = await appleAppStoreConnect.get("/v1/apps", {
        query: { "filter[bundleId]": ios.bundleIdentifier, limit: 1 },
      });
      const app = apps?.data?.[0];
      // The setup check already reports a missing record.
      if (!app) return undefined;

      const infos = await appleAppStoreConnect.get(
        `/v1/apps/${app.id}/appInfos`,
      );
      const info = (infos?.data ?? []).find(
        (each) => each.attributes?.state !== "READY_FOR_SALE",
      );
      if (info) {
        if (!info.attributes?.appStoreAgeRating) {
          missing.push(
            "no age rating — answer the questions in App Information",
          );
        }
        const category = await appleAppStoreConnect.get(
          `/v1/appInfos/${info.id}/primaryCategory`,
        );
        if (!category?.data) {
          missing.push("no primary category — set it in App Information");
        }
        const infoLocalizations = await appleAppStoreConnect.get(
          `/v1/appInfos/${info.id}/appInfoLocalizations`,
        );
        if (
          !(infoLocalizations?.data ?? []).some(
            (each) => each.attributes?.privacyPolicyUrl,
          )
        ) {
          missing.push("no privacy policy URL — set it in App Information");
        }
      }

      if (!(await hasPrice(appleAppStoreConnect, app.id))) {
        missing.push("no price — set one in Pricing and Availability");
      }

      const versions = await appleAppStoreConnect.get(
        `/v1/apps/${app.id}/appStoreVersions`,
        {
          query: {
            "filter[versionString]": storeVersion,
            "filter[platform]": "IOS",
            limit: 1,
          },
        },
      );
      const version = versions?.data?.[0];
      if (!version) {
        missing.push(
          `no App Store version ${storeVersion} — create it in App Store Connect and fill in its listing, since rc submits it`,
        );
      } else {
        if (!version.attributes?.copyright?.trim()) {
          missing.push(`version ${storeVersion} has no copyright`);
        }
        const reviewDetail = await appleAppStoreConnect.get(
          `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`,
        );
        const review = reviewDetail?.data?.attributes;
        if (!review?.contactEmail || !review?.contactPhone) {
          missing.push(
            `version ${storeVersion} has no App Review Information contact email and phone`,
          );
        } else if (review.demoAccountRequired !== false) {
          missing.push(
            `version ${storeVersion}'s App Review Information does not say no sign-in is required`,
          );
        }
        const localizations = await appleAppStoreConnect.get(
          `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
        );
        const listing = localizations?.data?.[0];
        for (const [field, label] of [
          ["description", "description"],
          ["keywords", "keywords"],
          ["supportUrl", "support URL"],
        ]) {
          if (!listing?.attributes?.[field]?.trim()) {
            missing.push(`version ${storeVersion} has no ${label}`);
          }
        }
        const sets = listing
          ? await appleAppStoreConnect.get(
              `/v1/appStoreVersionLocalizations/${listing.id}/appScreenshotSets`,
            )
          : undefined;
        const required = [
          [IPHONE_SCREENSHOTS, '6.9" iPhone'],
          ...(ios.supportsTablet ? [[IPAD_SCREENSHOTS, '13" iPad']] : []),
        ];
        for (const [displayType, label] of required) {
          const set = (sets?.data ?? []).find(
            (each) => each.attributes?.screenshotDisplayType === displayType,
          );
          const shots = set
            ? await appleAppStoreConnect.get(
                `/v1/appScreenshotSets/${set.id}/appScreenshots`,
              )
            : undefined;
          if (
            !(shots?.data ?? []).some(
              (each) =>
                each.attributes?.assetDeliveryState?.state === "COMPLETE",
            )
          ) {
            missing.push(`version ${storeVersion} has no ${label} screenshots`);
          }
        }
      }
    } catch (error) {
      return `could not read the App Store listing: ${error.message}`;
    }

    return missing.length === 0
      ? undefined
      : `the App Store listing is not ready for review:\n        - ${missing.join("\n        - ")}`;
  },
};

/** `method: app-store-connect` with an explicit profile: manual signing. */
function exportOptions({ bundleId, teamId, profile }) {
  const entries = [
    ["method", "app-store-connect"],
    ["teamID", teamId],
    ["signingStyle", "manual"],
  ]
    .map(([key, value]) => `  <key>${key}</key>\n  <string>${value}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries}
  <key>provisioningProfiles</key>
  <dict>
    <key>${bundleId}</key>
    <string>${profile}</string>
  </dict>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
`;
}

// TestFlight distribution, after the upload, in Apple's fixed order.

// Processing takes 5–20 minutes; giving up early costs a version number.
const PROCESSING_TIMEOUT_MS = 40 * 60 * 1000;
const PROCESSING_POLL_MS = 30_000;
const PROGRESS_EVERY_MS = 2 * 60 * 1000;

const LOCALE = "en-US"; // The only localization with copy.

const say = (message) => console.log(`   ${message}`);

const minutes = (ms) => `${Math.round(ms / 60000)}m`;

/** The app record, found by the bundle id the archive was signed for. */
async function findApp(appleAppStoreConnect, bundleId) {
  const found = await appleAppStoreConnect.get("/v1/apps", {
    query: { "filter[bundleId]": bundleId, limit: 1 },
  });
  const app = found?.data?.[0];
  if (!app) {
    throw new Error(
      `App Store Connect has no app with bundle id ${bundleId} — the record is created ` +
        "by hand, once, and its bundle id cannot be edited afterwards",
    );
  }
  return app;
}

/** The configured tester group, refused if internal, which would quietly
 *  turn `beta` into another alpha. */
async function findExternalGroup(appleAppStoreConnect, appId, name) {
  const found = await appleAppStoreConnect.get("/v1/betaGroups", {
    query: { "filter[app]": appId, "filter[name]": name, limit: 10 },
  });
  const group = found?.data?.find((each) => each.attributes?.name === name);
  if (!group) {
    const known = (found?.data ?? [])
      .map((each) => each.attributes?.name)
      .filter(Boolean);
    throw new Error(
      `no beta group named "${name}" on this app` +
        (known.length ? ` (found: ${known.join(", ")})` : "") +
        " — create it in App Store Connect → TestFlight, or fix APPLE_APP_STORE_CONNECT_BETA_GROUP",
    );
  }
  if (group.attributes?.isInternalGroup) {
    throw new Error(
      `"${name}" is an *internal* TestFlight group — a build added to it skips beta ` +
        "review and reaches only App Store Connect users, which is the alpha rung. " +
        "APPLE_APP_STORE_CONNECT_BETA_GROUP must name an external group",
    );
  }
  return group;
}

/** Waits for the build to appear, then to process; `INVALID` is Apple's
 *  verdict on the binary, so it throws. */
async function waitForProcessing(appleAppStoreConnect, appId, buildNumber) {
  const started = Date.now();
  let lastProgress = 0;
  let seen = false;

  for (;;) {
    const found = await appleAppStoreConnect.get("/v1/builds", {
      query: {
        "filter[app]": appId,
        "filter[version]": buildNumber,
        limit: 1,
        "fields[builds]": "processingState,version,expired",
      },
    });
    const build = found?.data?.[0];
    const state = build?.attributes?.processingState;
    if (build) seen = true;

    if (state === "VALID") {
      say(`build ${buildNumber} processed (${minutes(Date.now() - started)})`);
      return build;
    }
    if (state === "INVALID" || state === "FAILED") {
      throw new Error(
        `App Store Connect rejected build ${buildNumber} in processing ` +
          `(${state}) — the reason is emailed to the account and shown on the build in ` +
          "App Store Connect. It cannot be retried under this build number",
      );
    }

    const elapsed = Date.now() - started;
    if (elapsed > PROCESSING_TIMEOUT_MS) {
      throw new Error(
        seen
          ? `build ${buildNumber} was still ${state ?? "processing"} after ` +
              `${minutes(elapsed)}. The upload succeeded and Apple finishes processing on ` +
              "its own, so the build is not lost — but its notes, its group and the review " +
              "submission never happened. Re-running the release archives and uploads " +
              "again under a *new* build number, since they come from the clock, so the " +
              "cheaper repair is finishing this one in App Store Connect by hand"
          : `build ${buildNumber} never appeared in App Store Connect within ` +
              `${minutes(elapsed)} of the upload. Check the account's email for a rejection`,
      );
    }
    if (elapsed - lastProgress >= PROGRESS_EVERY_MS) {
      lastProgress = elapsed;
      say(
        `waiting for processing — ${state ?? "not visible yet"} (${minutes(elapsed)} elapsed)`,
      );
    }
    await new Promise((done) => setTimeout(done, PROCESSING_POLL_MS));
  }
}

/** Attaches _What to Test_, PATCH-or-POST, as Apple may have seeded one. */
async function attachWhatToTest(appleAppStoreConnect, buildId, notes) {
  const existing = await appleAppStoreConnect.get(
    `/v1/builds/${buildId}/betaBuildLocalizations`,
    {
      query: { limit: 50 },
    },
  );
  const mine = existing?.data?.find(
    (each) => each.attributes?.locale === LOCALE,
  );

  if (mine) {
    await appleAppStoreConnect.patch(`/v1/betaBuildLocalizations/${mine.id}`, {
      body: {
        data: {
          type: "betaBuildLocalizations",
          id: mine.id,
          attributes: { whatsNew: notes },
        },
      },
    });
  } else {
    await appleAppStoreConnect.post("/v1/betaBuildLocalizations", {
      body: {
        data: {
          type: "betaBuildLocalizations",
          attributes: { locale: LOCALE, whatsNew: notes },
          relationships: { build: { data: { type: "builds", id: buildId } } },
        },
      },
    });
  }
  say(`"What to Test" attached (${notes.length} characters)`);
}

/** Adds the build to the external group; already there is success, so a
 *  retry is safe. */
async function addToGroup(appleAppStoreConnect, groupId, buildId, groupName) {
  try {
    await appleAppStoreConnect.post(
      `/v1/betaGroups/${groupId}/relationships/builds`,
      {
        body: { data: [{ type: "builds", id: buildId }] },
      },
    );
  } catch (error) {
    if (!(error instanceof AppleAppStoreConnectError) || error.status !== 409)
      throw error;
    say(`already in "${groupName}"`);
    return;
  }
  say(`added to "${groupName}"`);
}

/** Submits for beta review; already submitted, often implicitly by Apple, is
 *  success. */
async function submitForBetaReview(appleAppStoreConnect, buildId) {
  try {
    await appleAppStoreConnect.post("/v1/betaAppReviewSubmissions", {
      body: {
        data: {
          type: "betaAppReviewSubmissions",
          relationships: { build: { data: { type: "builds", id: buildId } } },
        },
      },
    });
    say("submitted for beta review");
  } catch (error) {
    if (error instanceof AppleAppStoreConnectError && error.status === 409) {
      say(
        `already submitted for beta review (${error.errors[0]?.detail ?? "409"})`,
      );
      return;
    }
    throw error;
  }
}

/** Upload to _in beta review_, with its notes and group attached. */
async function distributeExternally({
  appleAppStoreConnect,
  app,
  build,
  root,
}) {
  const groupName = process.env.APPLE_APP_STORE_CONNECT_BETA_GROUP.trim();
  const notes = readFileSync(WHAT_TO_TEST(root), "utf8").trim();

  const group = await findExternalGroup(
    appleAppStoreConnect,
    app.id,
    groupName,
  );

  await attachWhatToTest(appleAppStoreConnect, build.id, notes);
  await addToGroup(appleAppStoreConnect, group.id, build.id, groupName);
  await submitForBetaReview(appleAppStoreConnect, build.id);

  say(
    `https://appstoreconnect.apple.com/apps/${app.id}/testflight/ios — the build is in ` +
      "beta review; testers get it when Apple approves it",
  );
}

// App Store submission, `rc`'s other half; every step tolerates being done.

/** The states in which a version can still be edited, so a refusal can name
 *  the state rather than a bare 409. */
const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

/** The version record, reused after a rejection, and `MANUAL` so approval
 *  waits for `final`. */
async function findOrCreateVersion(appleAppStoreConnect, appId, storeVersion) {
  const found = await appleAppStoreConnect.get(
    `/v1/apps/${appId}/appStoreVersions`,
    {
      query: {
        "filter[versionString]": storeVersion,
        "filter[platform]": "IOS",
        limit: 1,
      },
    },
  );
  const existing = found?.data?.[0];
  if (existing) {
    const state = existing.attributes?.appStoreState;
    if (!EDITABLE_STATES.has(state)) {
      throw new Error(
        `App Store version ${storeVersion} is ${state}, which cannot take a new build — ` +
          "cancel its submission in App Store Connect, or ship the next version instead",
      );
    }
    say(`App Store version ${storeVersion} already exists (${state})`);
    // A hand-made record releases on approval, which `final` cannot follow.
    if (existing.attributes?.releaseType !== "MANUAL") {
      await appleAppStoreConnect.patch(`/v1/appStoreVersions/${existing.id}`, {
        body: {
          data: {
            type: "appStoreVersions",
            id: existing.id,
            attributes: { releaseType: "MANUAL" },
          },
        },
      });
      say(`set App Store version ${storeVersion} to manual release`);
    }
    return existing;
  }

  const created = await appleAppStoreConnect.post("/v1/appStoreVersions", {
    body: {
      data: {
        type: "appStoreVersions",
        attributes: {
          platform: "IOS",
          versionString: storeVersion,
          releaseType: "MANUAL",
        },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    },
  });
  say(`created App Store version ${storeVersion} (manual release)`);
  return created.data;
}

/** Attaches the release notes, PATCH-or-POST; ⚠️ an app's first version takes
 *  none, so that refusal is stepped over. */
async function attachWhatsNew(appleAppStoreConnect, versionId, notes) {
  const existing = await appleAppStoreConnect.get(
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
    { query: { limit: 50 } },
  );
  const mine = existing?.data?.find(
    (each) => each.attributes?.locale === LOCALE,
  );

  try {
    if (mine) {
      await appleAppStoreConnect.patch(
        `/v1/appStoreVersionLocalizations/${mine.id}`,
        {
          body: {
            data: {
              type: "appStoreVersionLocalizations",
              id: mine.id,
              attributes: { whatsNew: notes },
            },
          },
        },
      );
    } else {
      await appleAppStoreConnect.post("/v1/appStoreVersionLocalizations", {
        body: {
          data: {
            type: "appStoreVersionLocalizations",
            attributes: { locale: LOCALE, whatsNew: notes },
            relationships: {
              appStoreVersion: {
                data: { type: "appStoreVersions", id: versionId },
              },
            },
          },
        },
      });
    }
    say(`release notes attached (${notes.length} characters)`);
  } catch (error) {
    if (
      error instanceof AppleAppStoreConnectError &&
      (error.status === 409 || error.status === 422)
    ) {
      say(
        `release notes not set (${error.errors[0]?.detail ?? error.status}) — expected on ` +
          "a first release, which has nothing to be new against",
      );
      return;
    }
    throw error;
  }
}

/** Points the version at the build; idempotent. */
async function attachBuild(
  appleAppStoreConnect,
  versionId,
  buildId,
  buildNumber,
) {
  await appleAppStoreConnect.patch(
    `/v1/appStoreVersions/${versionId}/relationships/build`,
    {
      body: { data: { type: "builds", id: buildId } },
    },
  );
  say(`build ${buildNumber} attached to the version`);
}

/** The app's open review submission, or a new one; a second is refused. */
async function findOrCreateSubmission(appleAppStoreConnect, appId) {
  const found = await appleAppStoreConnect.get(
    `/v1/apps/${appId}/reviewSubmissions`,
    {
      query: { "filter[platform]": "IOS", limit: 20 },
    },
  );
  const open = found?.data?.find(
    (each) => each.attributes?.state === "READY_FOR_REVIEW",
  );
  if (open) {
    say("reusing the review submission already open");
    return open;
  }

  const created = await appleAppStoreConnect.post("/v1/reviewSubmissions", {
    body: {
      data: {
        type: "reviewSubmissions",
        attributes: { platform: "IOS" },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    },
  });
  return created.data;
}

/** Apple's reasons for a refusal, including those nested in `meta`. */
function appleReasons(error) {
  const reasons = error.errors.flatMap((each) =>
    Object.values(each.meta?.associatedErrors ?? {})
      .flat()
      .map((associated) => associated.detail),
  );
  const top = error.errors.map((each) => each.detail);
  return (reasons.length > 0 ? reasons : top).filter(Boolean);
}

/** Puts the version in the submission, tolerating it already there. */
async function addVersionToSubmission(
  appleAppStoreConnect,
  submissionId,
  versionId,
) {
  try {
    await appleAppStoreConnect.post("/v1/reviewSubmissionItems", {
      body: {
        data: {
          type: "reviewSubmissionItems",
          relationships: {
            reviewSubmission: {
              data: { type: "reviewSubmissions", id: submissionId },
            },
            appStoreVersion: {
              data: { type: "appStoreVersions", id: versionId },
            },
          },
        },
      },
    });
  } catch (error) {
    if (!(error instanceof AppleAppStoreConnectError) || error.status !== 409) {
      throw error;
    }
    // A 409 means "already there" or "not reviewable"; ask which.
    const items = await appleAppStoreConnect.get(
      `/v1/reviewSubmissions/${submissionId}/items`,
      { query: { include: "appStoreVersion" } },
    );
    if (
      (items?.data ?? []).some(
        (each) => each.relationships?.appStoreVersion?.data?.id === versionId,
      )
    ) {
      say("the version is already in this submission");
      return;
    }
    throw new Error(
      `App Store Connect will not put the version up for review:\n        - ${appleReasons(error).join("\n        - ")}`,
    );
  }
}

/** Hands the submission to Apple, tolerating one already sent. */
async function submitForReview(appleAppStoreConnect, submissionId) {
  try {
    await appleAppStoreConnect.patch(`/v1/reviewSubmissions/${submissionId}`, {
      body: {
        data: {
          type: "reviewSubmissions",
          id: submissionId,
          attributes: { submitted: true },
        },
      },
    });
    say("submitted for App Store review");
  } catch (error) {
    if (!(error instanceof AppleAppStoreConnectError) || error.status !== 409) {
      throw error;
    }
    const submission = await appleAppStoreConnect.get(
      `/v1/reviewSubmissions/${submissionId}`,
    );
    const state = submission?.data?.attributes?.state;
    if (state === "WAITING_FOR_REVIEW" || state === "IN_REVIEW") {
      say(`already submitted for App Store review (${state})`);
      return;
    }
    throw new Error(
      `App Store Connect refused the review submission (${state ?? "state unknown"}):\n        - ${appleReasons(error).join("\n        - ")}`,
    );
  }
}

/** The build number a version has attached, or `null`: the only key back to
 *  a commit. */
async function attachedBuild(appleAppStoreConnect, versionId) {
  const found = await appleAppStoreConnect.get(
    `/v1/appStoreVersions/${versionId}/build`,
    {
      query: { "fields[builds]": "version" },
    },
  );
  return found?.data ?? null;
}

/** Makes an approved version public, tolerating one already requested. */
async function requestRelease(appleAppStoreConnect, versionId) {
  try {
    await appleAppStoreConnect.post("/v1/appStoreVersionReleaseRequests", {
      body: {
        data: {
          type: "appStoreVersionReleaseRequests",
          relationships: {
            appStoreVersion: {
              data: { type: "appStoreVersions", id: versionId },
            },
          },
        },
      },
    });
    say("released — the App Store is publishing it now");
  } catch (error) {
    if (error instanceof AppleAppStoreConnectError && error.status === 409) {
      say(`already released (${error.errors[0]?.detail ?? "409"})`);
      return;
    }
    throw error;
  }
}

/** A refusal `cut final --if-approved` reads as “not yet”, not failure. */
const notApproved = (message) =>
  Object.assign(new Error(message), { name: "NotApproved" });

/** The approved version and its build's commit, unreleased; refuses rather
 *  than guesses, and `--commit=` names it by hand. */
export async function approvedRelease({ root, storeVersion, commit }) {
  const appleAppStoreConnect = appleAppStoreConnectFromEnv();
  const bundleId = readAppJson(root).expo?.ios?.bundleIdentifier;
  const app = await findApp(appleAppStoreConnect, bundleId);

  const found = await appleAppStoreConnect.get(
    `/v1/apps/${app.id}/appStoreVersions`,
    {
      query: {
        "filter[versionString]": storeVersion,
        "filter[platform]": "IOS",
        limit: 1,
      },
    },
  );
  const version = found?.data?.[0];
  if (!version) {
    throw notApproved(
      `App Store Connect has no ${storeVersion} version record — it is created when an ` +
        "rc submits, so this version was never submitted",
    );
  }

  const state = version.attributes?.appStoreState;
  if (state !== "PENDING_DEVELOPER_RELEASE" && state !== "READY_FOR_SALE") {
    throw notApproved(
      `${storeVersion} is ${state}, not approved and waiting — going live is only ` +
        "possible from PENDING_DEVELOPER_RELEASE. Apple has not finished with it",
    );
  }

  const build = await attachedBuild(appleAppStoreConnect, version.id);
  const buildNumber = build?.attributes?.version;
  if (!buildNumber) {
    throw new Error(
      `App Store Connect reports no build attached to ${storeVersion} — without it there ` +
        "is no way to know which commit is live",
    );
  }

  const resolved =
    commit ?? commitOfBuild(root, { target: "ios", buildNumber });
  if (!resolved) {
    throw new Error(
      `no single receipt names build ${buildNumber}, so the commit behind ${storeVersion} ` +
        "cannot be established — push refs/notes/releases from the machine that shipped " +
        "it, or name the commit with --commit=<sha>",
    );
  }
  return {
    appleAppStoreConnect,
    version,
    state,
    buildNumber,
    commit: resolved,
  };
}

/** Makes the approved version public, and reports its commit. */
export async function releaseToPublic(ctx) {
  const { appleAppStoreConnect, version, state, buildNumber, commit } =
    await approvedRelease(ctx);
  if (state === "READY_FOR_SALE") {
    say(`${ctx.storeVersion} is already on the App Store`);
  } else {
    await requestRelease(appleAppStoreConnect, version.id);
  }
  say(`build ${buildNumber} came from ${commit.slice(0, 12)}`);
  return { commit, buildNumber };
}

export async function submitToAppStore({
  appleAppStoreConnect,
  app,
  build,
  root,
  storeVersion,
}) {
  const notes = readFileSync(WHATS_NEW(root), "utf8").trim();

  const version = await findOrCreateVersion(
    appleAppStoreConnect,
    app.id,
    storeVersion,
  );
  await attachWhatsNew(appleAppStoreConnect, version.id, notes);
  await attachBuild(
    appleAppStoreConnect,
    version.id,
    build.id,
    build.attributes?.version,
  );
  const submission = await findOrCreateSubmission(appleAppStoreConnect, app.id);
  await addVersionToSubmission(appleAppStoreConnect, submission.id, version.id);
  await submitForReview(appleAppStoreConnect, submission.id);

  say(
    `https://appstoreconnect.apple.com/apps/${app.id}/appstore — ${storeVersion} is with ` +
      "Apple. Approval parks it in Pending Developer Release; it goes public only when a " +
      "person releases it",
  );
}

/** Each rung on iOS; `external` switches `publish()` from upload-and-stop to
 *  distributing to testers. */
const TIERS = {
  alpha: {
    // Export compliance at every rung, or not even an internal tester gets it.
    name: "internal TestFlight",
    requires: [exportCompliance],
    manual: ["testers must be App Store Connect users (≤100)"],
  },
  // `beta` and `rc` reach the same strangers, so they owe the same checks.
  beta: {
    name: "external TestFlight",
    external: true,
    requires: [
      appIcon,
      exportCompliance,
      whatToTest,
      betaGroup,
      appleAppStoreConnectSetup,
    ],
    // Only the wait itself is left to a person.
    manual: ["Beta App Review — roughly a day on the first build of a version"],
  },
  // `rc` also goes to App Review, a separate audience, so a separate switch.
  rc: {
    name: "external TestFlight + App Store review",
    external: true,
    storeSubmission: true,
    requires: [
      appIcon,
      exportCompliance,
      whatToTest,
      whatsNew,
      betaGroup,
      appleAppStoreConnectSetup,
      appleAppStoreListing,
    ],
    manual: [
      "the crucial-flow catalog green on a real device",
      "the App Privacy answers published — Apple's API cannot read them",
      "App Store review — a day or so, and it reviews the metadata too",
    ],
  },
  // `final` builds nothing: it releases what `rc` submitted, and records it.
  final: {
    name: "release to the public",
    marker: true,
    requires: [],
    manual: [
      "Apple must have approved it — the version has to be in Pending Developer Release",
    ],
  },
};

export default {
  id: "ios",
  label: "iOS (App Store Connect)",
  platform: "ios",
  host: "macos",
  status: "ready",

  preflight: [xcodeSelected, cocoapods, ...signing, ...appleAppStoreConnectKey],

  /** The marker rung: no archive or upload, only a release and its commit. */
  release: releaseToPublic,

  /** The commit a marker rung will release, for `cut final` to tag first. */
  async approved(ctx) {
    const { commit, buildNumber } = await approvedRelease(ctx);
    return { commit, buildNumber };
  },

  tiers: TIERS,

  /** Deletes and regenerates `ios/`, archives it, and exports a signed `.ipa`,
   *  reproducible from the commit. */
  async build({ root, storeVersion, tag }) {
    const mobile = MOBILE(root);
    const buildDir = join(mobile, "build");
    const teamId = process.env.APPLE_TEAM_ID.trim();
    const profile = process.env.APPLE_IOS_PROVISIONING_PROFILE.trim();

    const config = pinnedConfig(mobile);
    const buildNumber = config.ios?.buildNumber;
    const bundleId = config.ios?.bundleIdentifier;
    if (!buildNumber || !bundleId) {
      throw new Error(
        "expo config resolved no ios.buildNumber/bundleIdentifier — check apps/mobile/app.config.ts",
      );
    }
    // Expo's resolved version must be the tag's, or the release misreports it.
    if (config.version !== storeVersion) {
      throw new Error(
        `expo resolved version ${config.version} but ${tag} means ${storeVersion} — apps/mobile/package.json and the tag disagree`,
      );
    }
    console.log(`   ${bundleId} ${config.version} (${buildNumber})`);

    rmSync(buildDir, { recursive: true, force: true });
    rmSync(join(mobile, "ios"), { recursive: true, force: true });
    mkdirSync(buildDir, { recursive: true });

    must(
      "expo prebuild",
      "pnpm",
      ["exec", "expo", "prebuild", "--platform", "ios"],
      {
        cwd: mobile,
        env: { ...process.env, LEAPSAKE_BUILD_NUMBER: String(buildNumber) },
      },
    );

    const workspace = readdirSync(join(mobile, "ios")).find((entry) =>
      entry.endsWith(".xcworkspace"),
    );
    if (!workspace) throw new Error("expo prebuild produced no .xcworkspace");
    const scheme = workspace.replace(/\.xcworkspace$/, "");
    const archivePath = join(buildDir, `${scheme}.xcarchive`);

    const optionsPath = join(buildDir, "ExportOptions.plist");
    const exportPath = join(buildDir, "export");
    const unstageSigning = stageSigningIdentity();
    try {
      must("xcodebuild archive", "xcodebuild", [
        "-workspace",
        join(mobile, "ios", workspace),
        "-scheme",
        scheme,
        "-configuration",
        "Release",
        "-destination",
        "generic/platform=iOS",
        "-archivePath",
        archivePath,
        // Signing is supplied here only; the project is regenerated each build.
        `DEVELOPMENT_TEAM=${teamId}`,
        "CODE_SIGN_STYLE=Manual",
        "CODE_SIGN_IDENTITY=Apple Distribution",
        `PROVISIONING_PROFILE_SPECIFIER=${profile}`,
        "archive",
      ]);

      writeFileSync(optionsPath, exportOptions({ bundleId, teamId, profile }));

      must("xcodebuild -exportArchive", "xcodebuild", [
        "-exportArchive",
        "-archivePath",
        archivePath,
        "-exportPath",
        exportPath,
        "-exportOptionsPlist",
        optionsPath,
      ]);
    } finally {
      unstageSigning();
    }

    const ipa = readdirSync(exportPath).find((entry) => entry.endsWith(".ipa"));
    if (!ipa) throw new Error(`no .ipa in ${exportPath}`);
    assertNoTestOnlyCode(join(exportPath, ipa), BUNDLE_IN.ipa);
    // The bundle id Expo resolved for this build travels with it.
    return { files: { ipa: join(exportPath, ipa) }, buildNumber, bundleId };
  },

  /** Validates first, as the cheap half, then uploads, and from `beta` up
   *  distributes. */
  async publish({ artifact, root, stage, storeVersion }) {
    // By path, or altool hunts four directories for a fixed filename.
    const credentials = [
      "--api-key",
      process.env.APPLE_APP_STORE_CONNECT_KEY_ID.trim(),
      "--api-issuer",
      process.env.APPLE_APP_STORE_CONNECT_ISSUER_ID.trim(),
      "--p8-file-path",
      resolve(process.env.APPLE_APP_STORE_CONNECT_KEY_PATH.trim()),
    ];

    must("altool --validate-app", "xcrun", [
      "altool",
      "--validate-app",
      "-f",
      artifact.files.ipa,
      "-t",
      "ios",
      ...credentials,
    ]);

    must("altool --upload-app", "xcrun", [
      "altool",
      "--upload-app",
      "-f",
      artifact.files.ipa,
      "-t",
      "ios",
      ...credentials,
    ]);

    console.log(`   uploaded build ${artifact.buildNumber}`);

    const tier = TIERS[stage];
    if (!tier?.external && !tier?.storeSubmission) {
      console.log(
        "   App Store Connect takes a few minutes to finish processing it; internal " +
          "testers get it automatically once it does",
      );
      return;
    }

    // Shared by both halves, so `rc` waits out processing once.
    const appleAppStoreConnect = appleAppStoreConnectFromEnv();
    const app = await findApp(appleAppStoreConnect, artifact.bundleId);
    const build = await waitForProcessing(
      appleAppStoreConnect,
      app.id,
      artifact.buildNumber,
    );

    if (tier.external)
      await distributeExternally({ appleAppStoreConnect, app, build, root });
    if (tier.storeSubmission) {
      await submitToAppStore({
        appleAppStoreConnect,
        app,
        build,
        root,
        storeVersion,
      });
    }
  },
};
