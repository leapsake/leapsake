# Remote releases: what is left

The tag-triggered pipeline is built: `.github/workflows/` (how it works and its portability
rules are in that folder's `README.md`), `scripts/release/` (`pnpm release --help`), and
CONTRIBUTING.md → _Versioning and releases_. What landed is `git log -- .github scripts/release
scripts/ci`. **This doc holds only what is open; delete it when the last item closes.**

`0.1.0` is live (2026-10-17), so nothing here waits on it any more.

## Open: are hosted runners good enough for the gate? _(owner's call)_

The gate runs on GitHub's runners: iOS on `macos-latest` (3 cores), Android on `ubuntu-latest`
(4 cores, KVM). Flow 4's Argon2id pass is not bimodal on either. A cold job takes about
27–39 min on Android and 48–63 min on iOS; nothing is cached yet.

Since the Android crash patch (80cc189), five runs of three jobs per platform
(`35990530595`, `36080753935`, `36284601968`, `36294303309`, `36295332721`):

- **Android: 15 of 15 jobs clean.** The react-native-screens backport holds.
- **iOS: one native crash in 13 gate jobs** (plus one `pnpm install` failure, which is
  infrastructure). In `36295332721` "ios (2)" the app aborted itself (`SIGABRT`) while
  relaunching into the recovery gate in Flow 4's `unlock-after-key-loss.yaml`, right after
  `dev-clear-dbkey`. The cause is unknown. iOS crashed natively twice before, on 2026-09-21
  (`35483355076`, `35554646445`), and it is not known whether that was the same bug. The next
  crash prints its abort message and backtrace into the gate's annotation: read it with
  `node scripts/ci/results.mjs <run>`.

**The choices:** go ahead and diagnose the crash as it recurs; keep `REMOTE_RELEASES` off
until an iOS backtrace is in hand; or move the gate off hosted runners. Deciding closes this
section, and unblocks `ci-and-test-tiers.md` step 4c.

## What the owner needs to do

1. **Make the call above.**
2. **Add the Actions secrets**, under the names in `.env.example` → _On a runner_:
   - eight files, base64-encoded (`base64 -i <file>`): the App Store Connect `.p8`; the Apple
     Distribution identity exported from the login keychain as a `.p12`, and a file holding
     its export password; the app's and the share extension's App Store profiles as
     `.mobileprovision`s; the Play upload keystore, and a file holding its password; the Play
     service-account JSON. The `.p12` and the `.mobileprovision`s do not exist as files yet.
   - seven plain values: `APPLE_TEAM_ID`, `APPLE_IOS_PROVISIONING_PROFILE` and
     `APPLE_IOS_SHARE_EXTENSION_PROVISIONING_PROFILE` (the profiles' names),
     `APPLE_APP_STORE_CONNECT_KEY_ID`, `APPLE_APP_STORE_CONNECT_ISSUER_ID`,
     `APPLE_APP_STORE_CONNECT_BETA_GROUP`, `GOOGLE_PLAY_UPLOAD_KEY_ALIAS`.
3. **Once the secrets exist**, set the repository variable
   `REMOTE_RELEASES=true`. Before that, a pushed tag, including your own `v0.1.0`, starts
   nothing.
4. **Then** set `AUTO_FINAL=true`. The hourly `cut final --if-approved` then
   tags each future final once Apple parks it in Pending Developer Release, and does nothing
   otherwise.
5. **Prove it end to end**, which nothing has done yet (no workflow has run on GitHub, and the
   keychain import has never met a real `.p12`):
   - a `cut beta` from the button produces a tag, and the tag runs to two uploads and a
     pushed receipts note;
   - a deliberately broken build (a bad `--build-number`) ends with the tag deleted and
     nothing uploaded.
6. **Once that run is green, retire the iOS `rc` rung's sentence about the catalog**: the
   `manual:` line "the crucial-flow catalog green on a real device" in
   `scripts/release/targets/ios.mjs`, since the pipeline now runs the catalog itself.

## Open: a new core's App Store version record is made by hand

`rc`'s listing preflight refuses until App Store Connect has a version record for the core, so
a remote `rc` on a fresh core stops there. A record made through the API inherits the previous
version's listing, screenshots and review details. Either let `rc` create the record before it
checks the listing, or keep it a step in this list.

## Not blocking

- **No build cache in `ci.yml`.** Step 6 never managed to save one; add it once someone can
  read the save step's log.

## When the last item closes

Delete this doc, and the pointers to it: its row in `README.md`, `plans/README.md`,
`plans/status.md`, `plans/android-pipeline.md`, `plans/desktop-packaging.md`,
`apps/mobile/maestro/e2e/README.md` and `ci-and-test-tiers.md`.
