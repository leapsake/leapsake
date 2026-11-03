# Releases and CI — what is unbuilt

The tag-triggered pipeline is built: [`.github/workflows/`](../.github/workflows/README.md),
`scripts/release/` (`pnpm release --help`), and [`CONTRIBUTING.md`](../CONTRIBUTING.md) →
_Versioning and releases_. Releases still run locally until the owner switches it on. What is
left, in order:

1. **The owner's call: are hosted runners good enough for the gate?**
2. **The owner switches remote releases on and proves them.**
3. **E2E drives a release build** (4c → 4d → 4e), ideally before the gate is wired into
   `ci.yml`, since every push to `main` pays whatever the gate costs from then on.

## 1. Hosted runners _(owner's call)_

The gate runs on GitHub's runners: iOS on `macos-latest` (3 cores), Android on
`ubuntu-latest` (4 cores, KVM). A cold job takes about 27–39 min on Android and 48–63 min on
iOS; nothing is cached yet. Since the Android crash patch (80cc189), five runs of three jobs
per platform (`35990530595`, `36080753935`, `36284601968`, `36294303309`, `36295332721`):

- **Android: 15 of 15 jobs clean.**
- **iOS: one native crash in 13 gate jobs.** In `36295332721` "ios (2)" the app aborted
  (`SIGABRT`) relaunching into the recovery gate after `dev-clear-dbkey`, cause unknown; iOS
  also crashed natively on 2026-09-21 (`35483355076`, `35554646445`). The next crash prints its
  backtrace into the gate's annotation: `node scripts/ci/results.mjs <run>`.

**The choices:** go ahead and diagnose the crash as it recurs; keep `REMOTE_RELEASES` off until
an iOS backtrace is in hand; or move the gate off hosted runners. Deciding unblocks 4c, whose
switch invalidates these numbers.

## 2. Switching remote releases on

1. **Add the Actions secrets**, under the names in `.env.example` → _On a runner_:
   - eight files, base64-encoded (`base64 -i <file>`): the App Store Connect `.p8`; the Apple
     Distribution identity as a `.p12`, and a file holding its export password; the app's and
     the share extension's App Store profiles as `.mobileprovision`s; the Play upload keystore,
     and a file holding its password; the Play service-account JSON. The `.p12` and the
     `.mobileprovision`s do not exist as files yet.
   - seven plain values: `APPLE_TEAM_ID`, `APPLE_IOS_PROVISIONING_PROFILE`,
     `APPLE_IOS_SHARE_EXTENSION_PROVISIONING_PROFILE`, `APPLE_APP_STORE_CONNECT_KEY_ID`,
     `APPLE_APP_STORE_CONNECT_ISSUER_ID`, `APPLE_APP_STORE_CONNECT_BETA_GROUP`,
     `GOOGLE_PLAY_UPLOAD_KEY_ALIAS`.
2. **Set `REMOTE_RELEASES=true`**, then **`AUTO_FINAL=true`** (the hourly
   `cut final --if-approved`). Until then a pushed tag starts nothing.
3. **Prove it end to end.** No workflow has run on GitHub, and the keychain import has never met
   a real `.p12`:
   - a `cut beta` from the button produces a tag, two uploads and a pushed receipts note;
   - a deliberately broken build (a bad `--build-number`) ends with the tag deleted and nothing
     uploaded.
4. **Then retire the iOS `rc` rung's `manual:` line** "the crucial-flow catalog green on a real
   device" in `scripts/release/targets/ios.mjs`, since the pipeline runs the catalog itself.

**Open, not blocking:**

- **A new core's App Store version record is made by hand.** `rc`'s listing preflight refuses
  until it exists, so a remote `rc` on a fresh core stops there. Either let `rc` create it (an
  API-made record inherits the previous listing, screenshots and review details), or keep it a
  manual step.
- **No build cache in `ci.yml`.** No run has managed to save one; add it once someone can read
  the save step's log.

## 3. E2E drives a release build

E2E drives the dev client loading a dev bundle from Metro (`scripts/lib/mobile-harness.mjs`),
not the artifact `rc` uploads, so release-only failures (Hermes bytecode, minification, code
behind `__DEV__`) are invisible to it, and three of the runners' stoppers came from the dev
client alone. **Decided:** the harness (`pnpm test:e2e`, `pnpm test:native`) drives a
**release-configuration build**, iOS then Android, with **no build-time budget**; if the gate
gets slow, pull other levers rather than go back. Driving by hand and scratch flows keep the dev
client. What earns a flow is the admission rule in
[`apps/mobile/maestro/e2e/README.md`](../apps/mobile/maestro/e2e/README.md).

**Key loss, mid-flow.** The door acts lose the key partway through one `maestro test` process,
because the captured phrase cannot leave it. A new `subflows/lose-keys.yaml` replaces the
key-loss lines in `subflows/unlock-after-key-loss.yaml`, branching on `platform:`:

- **iOS:** `stopApp` → `clearKeychain` → `launchApp`, and `dev-clear-dbkey` leaves iOS builds.
  Losing the whole keychain is what a new phone or the account transfer actually costs, and it
  exercises the device-identity repair no flow reaches today.
- **Android:** open `leapsake://dev-clear-dbkey` → **Clear everything** → relaunch. Nothing
  outside the app can delete its keystore entries on a non-debuggable build, so the route stays
  behind the flag.

With no recovery key surviving, Flow 4's phrase act no longer reaches the reseal; that rule
then rests on `apps/mobile/lib/open-active-store.test.ts` alone. Typing stays as it is, with
`subflows/type-checked.yaml`'s read-back retries: a busy JS thread still drops characters.

**Android E2E uses a new `e2e` build type, signed with the debug key.** It matches `release` in
everything that changes behaviour (minified, Hermes, bundled JS, no dev tools), keeps the same
`applicationId`, keeps the upload key off runners, and cannot be uploaded to Play by accident.
`plugins/with-android-release-signing.js`'s rule that `release` never falls back to the debug
key stays.

**Commits:**

- **4c. iOS switches.** The harness builds a Release simulator app with the flag and drops
  Metro, the launcher and dev-menu handling on the iOS path (`ios-prepare.yaml` shrinks to a
  readiness wait, or goes). Verify the app sees a keychain reset mid-session without a simulator
  reboot, and that `launchApp` behaves. Record the build and arc times in the commit message.
- **4d. Android:** the `e2e` build type, the Android half of `lose-keys.yaml`, and the path
  switched. The harness's `run-as` step for dev-menu prefs goes.
- **4e. Delete the rest of the dev-client handling** in `mobile-harness.mjs`, and correct
  `CONTRIBUTING.md` → _The E2E release gate_ ("the production app binary" becomes true),
  `apps/mobile/maestro/README.md` (_Run it_ and the dev-client traps), and
  `apps/mobile/README.md` where the self-test needs a dev-client build.

**Open:** whether E2E lowers the KDF cost too. Worth minutes per arc, but it needs a distinct
`KDF_ALG` in the account row so a cheap-recipe door can never pass for a real one.

Delete this doc when the last item lands, and its pointers in `README.md`, `status.md`,
`android-pipeline.md`, `desktop-packaging.md` and `apps/mobile/maestro/README.md`.
