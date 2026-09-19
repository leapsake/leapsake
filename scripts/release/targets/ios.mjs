// The iOS target: App Store Connect, via a local archive. No Xcode session anywhere in
// the path — `expo prebuild` generates the project, `xcodebuild` archives and exports it,
// and `altool` uploads it with an API key rather than an Apple ID session.
//
// Two constraints shape everything here, both learned the expensive way during the first
// upload — which was done by hand through the Xcode GUI, and is the reason this file exists:
//
//  1. **`apps/mobile/ios/` is generated** by `expo prebuild` and gitignored. Nothing may
//     originate there — not the team, not the signing identity, not the build number.
//     Everything is passed at invocation, which is also what makes a runner viable.
//  2. **Manual signing, always.** Under `CODE_SIGN_STYLE=Automatic` Xcode resolves
//     development *and* distribution profiles before it will archive, so a machine with no
//     registered device fails for a reason unrelated to the build — and Apple's device
//     list resets only once per membership year. A build machine has no phone plugged in.
//
// ## Where this bends a stated rule, deliberately
//
// `scripts/release/index.mjs` makes a principle of leaving the irreversible outward step to
// a person: it tags, and never pushes. From `beta` up, `publish()` below goes past the
// upload and **distributes the build to external testers** — it attaches the notes, adds
// the build to the tester group, and submits it for beta review. That is a step further
// than alpha's upload: an internal build reaches named App Store Connect users, and this
// one reaches strangers.
//
// It is automated anyway, and the reasoning belongs here rather than in a commit message.
// **Cutting the tag is the consent gesture.** `pnpm release beta` is typed by a human who
// has chosen the rung, and the rung *means* external TestFlight — there is no version of
// "yes, beta" that does not mean "yes, testers". Leaving the last four API calls to a
// browser session would not add a decision; it would add a chore, and reintroduce exactly
// the App Store Connect session this file exists to remove. What stays irreversible and
// unautomated is the part where a *new audience* is chosen: creating the tester group and
// adding people to it are App Store Connect actions, done once, by hand.
//
// The submission is also not the distribution. Apple's beta review sits between them, and
// it is the backstop this leans on: a build submitted in error is still a build a human
// can pull before any tester sees it.
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

import { AscError, ascFromEnv } from "../asc.mjs";
import { envSet, fileAt } from "../checks.mjs";
import {
  MOBILE,
  appIcon,
  must,
  readAppJson,
  pinnedConfig,
} from "../mobile.mjs";
import { commitOfBuild } from "../receipts.mjs";

/**
 * Full Xcode, not just the Command Line Tools: `xcodebuild` ships inside Xcode.app, so a
 * CLT-only machine can notarize and sign but cannot archive.
 */
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
    // The CLT path is /Library/Developer/CommandLineTools; Xcode.app's is inside the app
    // bundle. Resolve first so a symlinked selection is judged on where it lands.
    const app = dirname(dirname(resolve(selected)));
    return app.endsWith(".app")
      ? undefined
      : `xcode-select points at "${selected}" (Command Line Tools) — xcodebuild needs full Xcode: sudo xcode-select -s /Applications/Xcode.app`;
  },
};

/**
 * Export compliance, asserted by the build rather than answered by hand.
 *
 * Without this key every upload lands at *Missing Compliance* and cannot be distributed to
 * anyone — not even an internal tester — until someone clicks through App Store Connect.
 * With it, the question is never asked.
 *
 * The value is a **declaration about export control, not a build setting**. Leapsake
 * implements standard algorithms in the app (XChaCha20-Poly1305, Argon2id, HKDF-SHA256,
 * AES-256 via SQLCipher) rather than merely calling the OS, so the honest answer to Apple's
 * first question is "standard algorithms, in addition to". `false` here then asserts the
 * narrower thing: that this use is *exempt*. That is the answer already on record for
 * builds 340027 and 341572, made through Apple's own UI *(owner, 2026-08-26)*.
 *
 * So this check exists to keep the declaration from silently disappearing — deleting the
 * key would not fail a build, it would just quietly reinstate the manual step. If the EAR
 * determination ever changes, `apps/mobile/app.json` is the one place to change it.
 */
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
    "IOS_PROVISIONING_PROFILE",
    "manual signing needs an explicit App Store distribution profile name",
  ),
];

/**
 * CocoaPods, which `expo prebuild` shells out to. Checked here rather than discovered
 * halfway through a prebuild that has already deleted the native project.
 */
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

// One App Store Connect API key covers the upload here and macOS notarization later, and
// unlike an Apple ID session it runs unattended.
const ascKey = [
  // The key is handed to altool by path (`--p8-file-path`), so only its existence
  // matters — not its name, and not which directory it sits in. Keeping the downloaded
  // `AuthKey_<key id>.p8` filename is still wise: `.gitignore` excludes that shape at any
  // depth, and a key named anything else is one `git add` away from being published.
  fileAt("ASC_KEY_PATH", "the upload authenticates with it", { suffix: ".p8" }),
  envSet("ASC_KEY_ID", "it identifies which App Store Connect key is in use"),
  envSet("ASC_ISSUER_ID", "App Store Connect keys are scoped to an issuer"),
];

/**
 * "What to Test" — the note every external tester reads before they install.
 *
 * A **repo file**, not `git log`: release notes derived from commit subjects are written
 * for us, and this is the one piece of release copy whose entire audience is someone who
 * has never seen the code. It also has to say a specific thing at this rung — that the
 * build is not a sole copy of anything — which is the mitigation
 * `CONTRIBUTING.md` → *The E2E release gate* accepts in exchange for deferring the recovery-door
 * flows to `rc`.
 *
 * Plain text rather than Markdown because TestFlight renders none: what is in the file is
 * exactly what a tester sees, hashes and asterisks included.
 *
 * The check matters more than the file. A missing note must fail in the first ten seconds
 * of `pnpm release beta`, not after a twenty-minute archive and an upload — at which point
 * the build exists, the version is spent, and the only way forward is a second one.
 */
const WHAT_TO_TEST = (root) => join(root, "release-notes", "what-to-test.txt");
const WHATS_NEW = (root) => join(root, "release-notes", "whats-new.txt");
const WHATS_NEW_MAX = 4000; // Apple's limit on the field; a longer note is rejected at PATCH.

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

/**
 * The App Store release notes, which are a different document from *What to Test*.
 *
 * They are read by strangers deciding whether to install, not by a tester who already
 * agreed to help — so they are checked separately rather than reusing one file for both.
 * Checked in preflight for the same reason as its sibling: finding out after a
 * twenty-minute archive that the notes are missing wastes the archive.
 */
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
  "ASC_BETA_GROUP",
  "the external tester group's name is how the release finds it; create the group in App Store Connect → TestFlight",
);

/**
 * The one live probe in a preflight otherwise made entirely of offline checks.
 *
 * It buys the failures that would otherwise arrive *after* a twenty-minute archive and an
 * upload — at which point the build exists, the version number is spent, and the only way
 * forward is another one. All of them are conditions on the App Store Connect *account*,
 * which nothing offline can see:
 *
 *   - **The key's role.** A *Developer* key uploads a build perfectly well and cannot read
 *     beta groups, attach a build localization, or submit for review. It passes every
 *     offline check. The `.p8` downloads exactly once, so the repair is minting a new key —
 *     not something to discover at the end of a release.
 *   - **The group.** `ASC_BETA_GROUP` is matched by name, so a typo or a group renamed in
 *     App Store Connect is a plain string mismatch. An *internal* group is the worse case:
 *     it would be accepted, skip beta review, and quietly deliver `beta` to the alpha
 *     audience.
 *   - **The app record's own beta setup.** Test Information and Beta App Review Information
 *     are filled in by hand, once, and until they are the submission is refused. Read from
 *     the record rather than assumed, because "someone did it in the console last month" is
 *     exactly the kind of claim a release should not take on trust.
 *
 * It is several requests rather than the single one first planned, and that is a
 * deliberate widening: the cost is a few hundred milliseconds on an authenticated session
 * that has to exist anyway, and each one replaces a failure that costs a build. What it
 * does **not** do is decide anything — a network that is merely down is reported as a
 * network failure, not as a bad key.
 *
 * `demoAccountRequired: false` is checked as a value rather than as a presence, because it
 * is the one field whose default is a rejection: a reviewer who assumes Leapsake needs a
 * sign-in — it does not, and works fully local with no account — fails the build for a
 * login that does not exist.
 */
const ascSetup = {
  name: "App Store Connect setup",
  check: async ({ root }) => {
    // The credentials have their own checks; if they are missing, say so once, there.
    if (
      !process.env.ASC_KEY_ID?.trim() ||
      !process.env.ASC_ISSUER_ID?.trim() ||
      !process.env.ASC_KEY_PATH?.trim()
    ) {
      return undefined;
    }
    const groupName = process.env.ASC_BETA_GROUP?.trim();
    const bundleId = readAppJson(root).expo?.ios?.bundleIdentifier;
    const asc = ascFromEnv();

    let app;
    try {
      const apps = await asc.get("/v1/apps", {
        query: { "filter[bundleId]": bundleId, limit: 1 },
      });
      app = apps?.data?.[0];
    } catch (error) {
      if (
        error instanceof AscError &&
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
      // The group named by .env: it must exist on this app, and it must be external.
      if (groupName) {
        const groups = await asc.get("/v1/betaGroups", {
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
            `no beta group named "${groupName}" on this app (ASC_BETA_GROUP) — create it in App Store Connect → TestFlight`,
          );
        } else if (group.attributes?.isInternalGroup) {
          missing.push(
            `"${groupName}" is an internal group — a build added to it skips beta review and reaches only App Store Connect users, which is the alpha rung`,
          );
        }
      }

      // Test Information: the feedback address and description a tester sees.
      const localizations = await asc.get(
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

      // Beta App Review Information: who Apple contacts, and what they are told.
      const detail = await asc.get(`/v1/apps/${app.id}/betaAppReviewDetail`);
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

/** `method: app-store-connect` plus an explicit profile — the manual-signing half. */
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

// --- TestFlight distribution -----------------------------------------------------------
//
// Everything below runs *after* the upload, and only at the rungs whose tier is marked
// `external`. It is the half `altool` cannot do: `altool` hands Apple a file and stops.
//
// The order is fixed by Apple, not by preference. A build has to finish processing before
// it can be localized, added to a group, or submitted — every one of those calls fails
// against a build still in `PROCESSING`, which is why the wait comes first and is the only
// slow step.

// Apple's own budget for processing is "usually a few minutes"; observed reality is 5–20,
// and occasionally worse when a release train elsewhere is busy. The ceiling is generous on
// purpose: the cost of waiting too long is a slow release, and the cost of giving up too
// early is a spent version number and a build that has to be re-cut.
const PROCESSING_TIMEOUT_MS = 40 * 60 * 1000;
const PROCESSING_POLL_MS = 30_000;
const PROGRESS_EVERY_MS = 2 * 60 * 1000;

const LOCALE = "en-US"; // The only localization Leapsake has copy for.

const say = (message) => console.log(`   ${message}`);

const minutes = (ms) => `${Math.round(ms / 60000)}m`;

/** The app record, found by the bundle id the archive was signed for. */
async function findApp(asc, bundleId) {
  const found = await asc.get("/v1/apps", {
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

/**
 * The external tester group named by `ASC_BETA_GROUP`.
 *
 * The `isInternalGroup` guard is the one worth having: adding a build to an *internal*
 * group is accepted, skips beta review entirely, and reaches nobody outside the App Store
 * Connect user list — so a typo'd or wrongly-chosen group name would silently downgrade
 * `beta` to another alpha while reporting success. That is precisely the failure the rung
 * exists to prevent.
 */
async function findExternalGroup(asc, appId, name) {
  const found = await asc.get("/v1/betaGroups", {
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
        " — create it in App Store Connect → TestFlight, or fix ASC_BETA_GROUP",
    );
  }
  if (group.attributes?.isInternalGroup) {
    throw new Error(
      `"${name}" is an *internal* TestFlight group — a build added to it skips beta ` +
        "review and reaches only App Store Connect users, which is the alpha rung. " +
        "ASC_BETA_GROUP must name an external group",
    );
  }
  return group;
}

/**
 * Wait for the uploaded build to appear and finish processing.
 *
 * Two waits in one, deliberately: a freshly uploaded build is not immediately queryable at
 * all (Apple ingests it first), so "not found yet" is a normal early state rather than an
 * error. It stops being normal at the timeout, where the message says which of the two it
 * was.
 *
 * `INVALID` is fatal and thrown on, never waited out — it is Apple's verdict on the binary
 * (a missing icon size, a disallowed API), and no amount of polling changes it.
 */
async function waitForProcessing(asc, appId, buildNumber) {
  const started = Date.now();
  let lastProgress = 0;
  let seen = false;

  for (;;) {
    const found = await asc.get("/v1/builds", {
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

/**
 * Attach "What to Test".
 *
 * PATCH-or-POST rather than POST-and-tolerate: App Store Connect sometimes creates an
 * empty `en-US` localization with the build, and sometimes does not, so both paths are
 * ordinary rather than one being an error to swallow.
 */
async function attachWhatToTest(asc, buildId, notes) {
  const existing = await asc.get(
    `/v1/builds/${buildId}/betaBuildLocalizations`,
    {
      query: { limit: 50 },
    },
  );
  const mine = existing?.data?.find(
    (each) => each.attributes?.locale === LOCALE,
  );

  if (mine) {
    await asc.patch(`/v1/betaBuildLocalizations/${mine.id}`, {
      body: {
        data: {
          type: "betaBuildLocalizations",
          id: mine.id,
          attributes: { whatsNew: notes },
        },
      },
    });
  } else {
    await asc.post("/v1/betaBuildLocalizations", {
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

/**
 * Add the build to the external group. This is what makes it a *beta* build.
 *
 * A build already in the group is success, not an error: the client retries a call whose
 * connection dropped, and a write that reached Apple before the socket died would come
 * back a conflict on the second try. Tolerating it is what makes that retry safe.
 */
async function addToGroup(asc, groupId, buildId, groupName) {
  try {
    await asc.post(`/v1/betaGroups/${groupId}/relationships/builds`, {
      body: { data: [{ type: "builds", id: buildId }] },
    });
  } catch (error) {
    if (!(error instanceof AscError) || error.status !== 409) throw error;
    say(`already in "${groupName}"`);
    return;
  }
  say(`added to "${groupName}"`);
}

/**
 * Submit for beta review, tolerating a submission that already exists.
 *
 * Recent App Store Connect often submits a build **implicitly** when it is added to an
 * external group, so the explicit call frequently loses a race with Apple's own side
 * effect. That is the desired end state arriving early, not a failure — but it cannot be
 * assumed either, because the implicit submission is undocumented behaviour that has come
 * and gone. So: ask, and treat "already submitted" as success.
 */
async function submitForBetaReview(asc, buildId) {
  try {
    await asc.post("/v1/betaAppReviewSubmissions", {
      body: {
        data: {
          type: "betaAppReviewSubmissions",
          relationships: { build: { data: { type: "builds", id: buildId } } },
        },
      },
    });
    say("submitted for beta review");
  } catch (error) {
    if (error instanceof AscError && error.status === 409) {
      say(
        `already submitted for beta review (${error.errors[0]?.detail ?? "409"})`,
      );
      return;
    }
    throw error;
  }
}

/** Upload → *in beta review*, with its notes and its group attached. */
async function distributeExternally({ asc, app, build, root }) {
  const groupName = process.env.ASC_BETA_GROUP.trim();
  const notes = readFileSync(WHAT_TO_TEST(root), "utf8").trim();

  const group = await findExternalGroup(asc, app.id, groupName);

  await attachWhatToTest(asc, build.id, notes);
  await addToGroup(asc, group.id, build.id, groupName);
  await submitForBetaReview(asc, build.id);

  say(
    `https://appstoreconnect.apple.com/apps/${app.id}/testflight/ios — the build is in ` +
      "beta review; testers get it when Apple approves it",
  );
}

// --- App Store submission ---------------------------------------------------------------
//
// The other half of `rc`, and a different audience from the one above: TestFlight reaches
// people who agreed to help, and this reaches Apple's reviewers on the way to everyone.
//
// The order is Apple's again — a version exists, carries notes, names a build, and only
// then can be submitted — and every step tolerates having already happened, because a
// rejection is resubmitted against the *same* version record rather than a fresh one.

/**
 * The states in which App Store Connect will still let a version be edited.
 *
 * Everything else is either under review or already out, and attaching a build to one is
 * refused by Apple with an error that does not say why. Naming the state in our own refusal
 * is the difference between "this version is in review, cut a new rc or cancel it" and a
 * bare 409 three steps into a release.
 */
const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

/**
 * The version record for this store version, created if this is its first submission.
 *
 * Find-or-create rather than create-and-tolerate: after a rejection the record still exists
 * and is *supposed* to be reused — that is what keeps a rejected `0.1.0` from spending the
 * version string. A second record for the same version is not something Apple would even
 * allow, so an existing one is the expected case from the second attempt onwards.
 *
 * `releaseType: MANUAL` is the deliberate part. It parks an approved version in *Pending
 * Developer Release* instead of publishing it the moment review passes, which keeps a human
 * at the one irreversible, outward step — the same principle `index.mjs` applies to pushing.
 */
async function findOrCreateVersion(asc, appId, storeVersion) {
  const found = await asc.get(`/v1/apps/${appId}/appStoreVersions`, {
    query: {
      "filter[versionString]": storeVersion,
      "filter[platform]": "IOS",
      limit: 1,
    },
  });
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
    return existing;
  }

  const created = await asc.post("/v1/appStoreVersions", {
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

/**
 * Attach the release notes to the version.
 *
 * PATCH-or-POST for the same reason `attachWhatToTest` is: App Store Connect sometimes
 * seeds a localization with the version and sometimes does not.
 *
 * ⚠️ **The very first version of an app has no "what's new".** There is nothing previous to
 * be new against, and Apple rejects the field rather than ignoring it. That is a fact about
 * the app's history rather than a mistake in the notes, so it is reported and stepped over —
 * the submission is still correct without it.
 */
async function attachWhatsNew(asc, versionId, notes) {
  const existing = await asc.get(
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
    { query: { limit: 50 } },
  );
  const mine = existing?.data?.find(
    (each) => each.attributes?.locale === LOCALE,
  );

  try {
    if (mine) {
      await asc.patch(`/v1/appStoreVersionLocalizations/${mine.id}`, {
        body: {
          data: {
            type: "appStoreVersionLocalizations",
            id: mine.id,
            attributes: { whatsNew: notes },
          },
        },
      });
    } else {
      await asc.post("/v1/appStoreVersionLocalizations", {
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
      error instanceof AscError &&
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

/** Point the version at the build. A 204, and idempotent — the same build twice is fine. */
async function attachBuild(asc, versionId, buildId, buildNumber) {
  await asc.patch(`/v1/appStoreVersions/${versionId}/relationships/build`, {
    body: { data: { type: "builds", id: buildId } },
  });
  say(`build ${buildNumber} attached to the version`);
}

/**
 * The open review submission for this app, or a new one.
 *
 * A submission is a *container* — it can carry more than one item, and one is already open
 * if a previous attempt got this far and stopped. Creating a second while one is open is
 * refused, so this looks first.
 */
async function findOrCreateSubmission(asc, appId) {
  const found = await asc.get(`/v1/apps/${appId}/reviewSubmissions`, {
    query: { "filter[platform]": "IOS", limit: 20 },
  });
  const open = found?.data?.find(
    (each) => each.attributes?.state === "READY_FOR_REVIEW",
  );
  if (open) {
    say("reusing the review submission already open");
    return open;
  }

  const created = await asc.post("/v1/reviewSubmissions", {
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

/** Put the version in the submission, tolerating its already being there. */
async function addVersionToSubmission(asc, submissionId, versionId) {
  try {
    await asc.post("/v1/reviewSubmissionItems", {
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
    if (error instanceof AscError && error.status === 409) {
      say("the version is already in this submission");
      return;
    }
    throw error;
  }
}

/** Hand the submission to Apple. Tolerates a submission already sent, as beta review does. */
async function submitForReview(asc, submissionId) {
  try {
    await asc.patch(`/v1/reviewSubmissions/${submissionId}`, {
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
    if (error instanceof AscError && error.status === 409) {
      say(
        `already submitted for App Store review (${error.errors[0]?.detail ?? "409"})`,
      );
      return;
    }
    throw error;
  }
}

/**
 * Upload → *waiting for review*, with the version created, noted and pointed at the build.
 *
 * Exported for its tests: every step is an ordered conversation with Apple whose failures
 * are 409s that mean "already done", and the only way to prove those are tolerated without
 * submitting a real app is to drive the whole sequence against a stubbed `fetch`.
 */
/**
 * The build App Store Connect has attached to a version, or `null`.
 *
 * This is the whole reason receipts exist: Apple answers with a build *number* and nothing
 * that names a commit, so the number is the only key back into the repository.
 */
async function attachedBuild(asc, versionId) {
  const found = await asc.get(`/v1/appStoreVersions/${versionId}/build`, {
    query: { "fields[builds]": "version" },
  });
  return found?.data ?? null;
}

/** Make an approved version public. Tolerates a release already requested. */
async function requestRelease(asc, versionId) {
  try {
    await asc.post("/v1/appStoreVersionReleaseRequests", {
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
    if (error instanceof AscError && error.status === 409) {
      say(`already released (${error.errors[0]?.detail ?? "409"})`);
      return;
    }
    throw error;
  }
}

/**
 * The approved version's record and the commit its build came from, without releasing it.
 * Refuses rather than guesses; `--commit=` names the commit by hand.
 */
export async function approvedRelease({ root, storeVersion, commit }) {
  const asc = ascFromEnv();
  const bundleId = readAppJson(root).expo?.ios?.bundleIdentifier;
  const app = await findApp(asc, bundleId);

  const found = await asc.get(`/v1/apps/${app.id}/appStoreVersions`, {
    query: {
      "filter[versionString]": storeVersion,
      "filter[platform]": "IOS",
      limit: 1,
    },
  });
  const version = found?.data?.[0];
  if (!version) {
    throw new Error(
      `App Store Connect has no ${storeVersion} version record — it is created when an ` +
        "rc submits, so this version was never submitted",
    );
  }

  const state = version.attributes?.appStoreState;
  if (state !== "PENDING_DEVELOPER_RELEASE" && state !== "READY_FOR_SALE") {
    throw new Error(
      `${storeVersion} is ${state}, not approved and waiting — going live is only ` +
        "possible from PENDING_DEVELOPER_RELEASE. Apple has not finished with it",
    );
  }

  const build = await attachedBuild(asc, version.id);
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
  return { asc, version, state, buildNumber, commit: resolved };
}

/** Make the approved version public, and report which commit went with it. */
export async function releaseToPublic(ctx) {
  const { asc, version, state, buildNumber, commit } =
    await approvedRelease(ctx);
  if (state === "READY_FOR_SALE") {
    say(`${ctx.storeVersion} is already on the App Store`);
  } else {
    await requestRelease(asc, version.id);
  }
  say(`build ${buildNumber} came from ${commit.slice(0, 12)}`);
  return { commit, buildNumber };
}

export async function submitToAppStore({
  asc,
  app,
  build,
  root,
  storeVersion,
}) {
  const notes = readFileSync(WHATS_NEW(root), "utf8").trim();

  const version = await findOrCreateVersion(asc, app.id, storeVersion);
  await attachWhatsNew(asc, version.id, notes);
  await attachBuild(asc, version.id, build.id, build.attributes?.version);
  const submission = await findOrCreateSubmission(asc, app.id);
  await addVersionToSubmission(asc, submission.id, version.id);
  await submitForReview(asc, submission.id);

  say(
    `https://appstoreconnect.apple.com/apps/${app.id}/appstore — ${storeVersion} is with ` +
      "Apple. Approval parks it in Pending Developer Release; it goes public only when a " +
      "person releases it",
  );
}

/**
 * What each rung means on iOS, and what it demands beyond the target's baseline.
 *
 * Hoisted out of the export so `publish()` can read the rung it is shipping: `external`
 * is the switch between "upload and stop" and "upload, then distribute to testers".
 */
const TIERS = {
  alpha: {
    // Export compliance is required at *every* rung, not just the ones strangers see:
    // without it the build is undistributable even to an internal tester.
    name: "internal TestFlight",
    requires: [exportCompliance],
    manual: ["testers must be App Store Connect users (≤100)"],
  },
  // `external` is what `publish()` branches on, and it is the same list twice on
  // purpose: both rungs distribute to the same strangers through the same group, so
  // they owe the same checks. Naming it a property of the *rung* rather than hard-coding
  // a stage list inside `publish()` keeps the rule where the rest of the rung's rules
  // are — and makes a future rung that uploads without distributing a one-line change.
  beta: {
    name: "external TestFlight",
    external: true,
    requires: [appIcon, exportCompliance, whatToTest, betaGroup, ascSetup],
    // What is left is the wait itself. The beta description and "What to Test" used to
    // be here: the notes are now a repo file this attaches, and the description is set
    // once on the app record rather than per build.
    manual: ["Beta App Review — roughly a day on the first build of a version"],
  },
  // `rc` is where a build stops being only a tester's problem: it goes to the same
  // strangers `beta` does *and* to Apple's reviewers. That is what distinguishes the rung —
  // if a build is not ready for review, it is a `beta`. `storeSubmission` is its own
  // property rather than more meaning loaded onto `external`, because the two halves reach
  // different audiences and a future rung may well want one without the other.
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
      ascSetup,
    ],
    manual: [
      "the crucial-flow catalog green on a real device",
      "App Store review — a day or so, and it reviews the metadata too",
    ],
  },
  // `final` builds nothing. The artifact it makes public was built and submitted by `rc`,
  // days earlier — going live is a state Apple confers, not something compiled — so this
  // rung releases the approved version and records which commit that was.
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

  preflight: [xcodeSelected, cocoapods, ...signing, ...ascKey],

  /**
   * The `marker` rung's whole implementation: no archive, no upload, no artifact.
   *
   * It is a sibling of `build`/`publish` rather than a stage inside them, because it shares
   * nothing with them — it reads App Store Connect and the repository's own receipts, and
   * produces a commit rather than a file.
   */
  release: releaseToPublic,

  /** The commit a marker rung will release, for `cut final` to tag before anything goes live. */
  async approved(ctx) {
    const { commit, buildNumber } = await approvedRelease(ctx);
    return { commit, buildNumber };
  },

  tiers: TIERS,

  /**
   * Generate the native project, archive it, export a signed `.ipa`.
   *
   * The prebuild is preceded by deleting `ios/` outright rather than merging into it.
   * A release has to be reproducible from a commit, and a directory that has accumulated
   * whatever a previous build or an Xcode session left behind is not that. It costs the
   * developer a re-prebuild afterwards, which is the correct trade for an artifact that
   * goes to strangers.
   */
  async build({ root, storeVersion, tag }) {
    const mobile = MOBILE(root);
    const buildDir = join(mobile, "build");
    const teamId = process.env.APPLE_TEAM_ID.trim();
    const profile = process.env.IOS_PROVISIONING_PROFILE.trim();

    const config = pinnedConfig(mobile);
    const buildNumber = config.ios?.buildNumber;
    const bundleId = config.ios?.bundleIdentifier;
    if (!buildNumber || !bundleId) {
      throw new Error(
        "expo config resolved no ios.buildNumber/bundleIdentifier — check apps/mobile/app.config.ts",
      );
    }
    // The version Expo resolved and the version the tag names must be the same number, or
    // the artifact would carry a store version the release does not know it shipped.
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
      // Signing is supplied here and nowhere else: the native project is regenerated
      // every build, so anything it claims about signing is discarded before this runs.
      `DEVELOPMENT_TEAM=${teamId}`,
      "CODE_SIGN_STYLE=Manual",
      "CODE_SIGN_IDENTITY=Apple Distribution",
      `PROVISIONING_PROFILE_SPECIFIER=${profile}`,
      "archive",
    ]);

    const optionsPath = join(buildDir, "ExportOptions.plist");
    writeFileSync(optionsPath, exportOptions({ bundleId, teamId, profile }));
    const exportPath = join(buildDir, "export");

    must("xcodebuild -exportArchive", "xcodebuild", [
      "-exportArchive",
      "-archivePath",
      archivePath,
      "-exportPath",
      exportPath,
      "-exportOptionsPlist",
      optionsPath,
    ]);

    const ipa = readdirSync(exportPath).find((entry) => entry.endsWith(".ipa"));
    if (!ipa) throw new Error(`no .ipa in ${exportPath}`);
    // `bundleId` travels with the artifact rather than being re-read in `publish()`: it is
    // what identifies the app to App Store Connect, and it must be the value Expo actually
    // resolved for *this* build, not what `app.json` says a second later.
    return { files: { ipa: join(exportPath, ipa) }, buildNumber, bundleId };
  },

  /**
   * Validate, upload — and, from `beta` up, distribute.
   *
   * Validation first because it is the cheap half: it catches a rejected bundle before the
   * upload rather than leaving a build sitting in App Store Connect in a state that has to
   * be cleaned up by hand.
   *
   * The distribution half is everything `altool` cannot reach, and it runs only for a rung
   * whose tier is `external`. At `alpha` this returns exactly where it always did, with
   * the build uploaded and nothing else claimed about it.
   */
  async publish({ artifact, root, stage, storeVersion }) {
    // `--p8-file-path` names the key directly. Without it, altool searches four fixed
    // directories for a file called `AuthKey_<key id>.p8` — which would make the key's
    // *filename* load-bearing, and would fail at the upload, after the archive.
    const credentials = [
      "--api-key",
      process.env.ASC_KEY_ID.trim(),
      "--api-issuer",
      process.env.ASC_ISSUER_ID.trim(),
      "--p8-file-path",
      resolve(process.env.ASC_KEY_PATH.trim()),
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

    // Resolved once and shared by both halves. Waiting out processing is the slow step —
    // 5–20 minutes — and an `rc` that did it twice would pay for it twice for no reason.
    const asc = ascFromEnv();
    const app = await findApp(asc, artifact.bundleId);
    const build = await waitForProcessing(asc, app.id, artifact.buildNumber);

    if (tier.external) await distributeExternally({ asc, app, build, root });
    if (tier.storeSubmission) {
      await submitToAppStore({ asc, app, build, root, storeVersion });
    }
  },
};
