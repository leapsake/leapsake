# The Android release target, and the Play account that publishes it

> **In flight** *(owner, 2026-09-13)* — Android no longer waits for the company. It ships from
> the **personal** Play account, and a later app transfer moves it to the company for $25.
> What is left is the upload half of the target.
>
> **Delete this doc when the work lands.** How to cut a build belongs in
> [`apps/mobile/README.md`](../apps/mobile/README.md); the rules belong in `scripts/release/`,
> which documents itself. *(Numbered `v0-1_04_mobile-pipeline.md` until 2026-09-06; deferred
> past v0.1 on 2026-09-06 and un-deferred on 2026-09-13 — `git log` has the history.)*

✅ **The iOS half is done** *(2026-08-26)*. `pnpm release alpha` cuts a tag, gates on the suite,
prebuilds, archives with manual signing, exports, validates and uploads — with no Xcode session.
EAS is out; the whole path is local `xcodebuild` plus an App Store Connect API key.

✅ **The Android build half is done** *(2026-09-13)*.
[`apps/mobile/plugins/with-android-release-signing.js`](../apps/mobile/plugins/with-android-release-signing.js)
puts a real `release` signingConfig into the generated project, and `./gradlew bundleRelease`
produces an AAB whose signer fingerprint matches the upload key. **What is left is the upload.**

## Why this stopped waiting *(2026-09-13)*

⚠️ **This section used to argue the opposite, and it was wrong on every load-bearing fact.** It
claimed a Play package name is claimed *permanently* by the first account to upload it, that any
upload would meet the 12-tester/14-day wall, and that uploading from the personal account was
therefore the one irreversible step in the project. Checked against Google's own support pages:

- **The 12-tester/14-day wall gates *production access* only.** It binds personal accounts
  created after 2023-11-13 (ours), and Google's wording is that you run the closed test and
  *then* apply for production. It was never a tax on uploading.
- **Internal testing sits outside it entirely** — no minimum testers, no review, live in
  minutes, on any account type.
- **App transfers are routine.** Package name, users, statistics, ratings, reviews and listing
  all move: $25 on the receiving side, about two business days. ⚠️ **The app signing key stays
  with the app unless the receiving account requests a key upgrade — so never request one**, or
  Android buys the whole iOS re-key cost ([`shipping.md`](./shipping.md) → *What the transfer
  costs*) for nothing.

The old rule was a $25 chore wearing a one-way door's costume, and believing it cost this project
its Android timeline. *(The Play **title** never was at risk: Play titles are not exclusively
reserved, checked 2026-08-26.)*

⚠️ **The one thing that genuinely cannot be automated:** the Play Developer API cannot *create*
an app, and will only edit one that already has a bundle. **The first AAB must be uploaded
through the Console by hand.** Every upload after it can be scripted. No tooling removes this.

⚠️ **Also live, and unresolved:** Android developer verification. Since September 2026 new
personal accounts must complete identity verification, and no new account reaches production
without it. Whether it also gates *internal* testing is not stated anywhere found — treat it as
an unknown with a clock, and start it early.

## How the rungs map to Play tracks — settled *(owner, 2026-09-13)*

**A rung means the same thing on every platform, and each store's vocabulary bends to fit it.**
That is the point: iOS, Android and eventually macOS/Windows/Linux answer to one ladder, so
`beta` never means "the first strangers" on one platform and something else on another. Where a
store cannot express a rung, the rung is *withheld* on that platform — it is not redefined.

| Rung    | Play track                                          | What happens                                          |
| ------- | --------------------------------------------------- | ----------------------------------------------------- |
| `alpha` | internal                                            | ≤100 testers, live in minutes, no review wait         |
| `beta`  | closed                                              | the tester group; reviewed; testers join by opt-in link |
| `rc`    | closed **+** a production release held by managed publishing | testers get it, Google reviews it, it waits    |
| `final` | publish the approved release                        | goes live; the tag names the commit that did           |

**Why this works on Play, which has one review gate where Apple has two.** Apple separates Beta
App Review (TestFlight strangers) from App Store Review (the public listing), and that separation
is the only reason iOS `rc` can do both in one rung. Play reviews a release when it is rolled out
to a track and offers no distinct "submit to the store" action. **Managed publishing** closes the
gap: with it on, approved changes wait in *Changes ready to publish* until a person publishes
them — Play's equivalent of Apple's *Pending Developer Release*. So `rc` submits and waits,
`final` publishes and tags, exactly as on iOS. ⚠️ **Internal tracks are not covered by managed
publishing** and go out immediately, which is what `alpha` wants anyway.

**The wall is earned rather than dodged.** Under this mapping the closed-track uploads that
`beta` makes are precisely the activity that accumulates the 12-tester/14-day credit — so the
ordinary act of shipping betas is what unlocks production, instead of a detour around it. What
it costs is real testers: **12 Google accounts, opted in through the link, continuously for 14
days.** Until that clock finishes, `final` must refuse on Android.

**Tester lists.** Internal takes an email list (≤100). Closed takes email lists (≤200 lists ×
2,000) **or Google Groups, which have no size limit** — prefer a Group, so adding and removing
testers never touches Play Console and the roster stays out of the release path. Compare iOS,
where the group *name* is the contract (`ASC_BETA_GROUP`) and renaming it breaks the release.

⚠️ **A naming collision to confirm before writing the client.** Play's API track identifiers are
`internal`, `alpha`, `beta`, `production` — and historically the API's `alpha` means *closed*
testing while its `beta` means *open* testing. If that still holds, this repo's `beta` rung
targets the API track named `alpha`, which is exactly the sort of thing that reads as a bug
forever after. **Unverified** — confirm against the API reference and leave a loud comment
wherever the mapping is finally written down.

## What the Android target still has to do

It fills in `scripts/release/targets/android.mjs`, still a `blocked` stub — blocked now because
the upload is unwritten, not because uploading is dangerous. The contract is documented in
`scripts/release/targets/index.mjs`; what follows is only what is *Android-specific*.

- ✅ **Build an AAB, not an APK** — `expo prebuild --platform android` then
  `./gradlew bundleRelease`, with the build number pinned through `LEAPSAKE_BUILD_NUMBER` as iOS
  does. `android/` is generated and gitignored, so nothing may originate there.
- ✅ **Signing is an upload key, not the app-signing key.** Play App Signing holds the
  distribution key; the repo only ever holds the upload key, passed at invocation from `.env`.
- **Upload with a Google Cloud service account** over the Play Developer API — `edits.insert` →
  POST the AAB to the `/upload/` host → `edits.tracks.update` → `edits.commit`. Auth is an RS256
  JWT for scope `androidpublisher`, exchanged at `oauth2.googleapis.com/token`. Worth building
  hand-rolled against `node:crypto` and `fetch`, exactly as `scripts/release/asc.mjs` is, so
  `scripts/` keeps its zero dependencies. One edit can update **several tracks**, which is how
  `rc` reaches the closed track and the held production release in a single commit.
- **`final` builds nothing**, as on iOS: it publishes what review already approved and tags the
  commit that went live, resolved out of `refs/notes/releases`.
- **Preflights in the same shape as iOS'**, so a missing prerequisite is reported by `--dry-run`
  rather than mid-upload: the keystore and its password file, the service-account JSON, the
  track being reachable with the credentials given, and — for `final` — production access
  actually existing, which is the check that keeps a half-finished release from happening.

**Acceptance, in three stages:**

1. ✅ **A signed AAB, no Play account needed** *(2026-09-13)* — built from the plugin above, with
   the signer fingerprint verified against the upload key.
2. **The manual bootstrap** — the app record created in Play Console and the first AAB uploaded
   by hand, because the API cannot do it. Going straight to the closed track is fine; Play does
   not require walking the tracks in order. Expect the **App content** declarations here
   (privacy policy, data safety, content rating, target audience) — the Android twin of the App
   Store Connect metadata in [`shipping.md`](./shipping.md) → *Part 1*, from the same answers.
3. **The ladder runs unattended** — `alpha` to internal, `beta` to closed, `rc` to closed plus a
   held production release, `final` publishing it. With no Play Console interaction.

## The version-parity check this makes possible

⚠️ **This becomes real the moment Android goes `ready`, and Android arrives into a repo whose
iOS app is already published.** A tag will then ship two artifacts that claim to work together —
which is the point of the single-version rule ([`../CONTRIBUTING.md`](../CONTRIBUTING.md) →
*Versioning and releases*) and also the first moment it can be **wrong**: identical version
numbers say nothing if the two builds resolve `@leapsake/flags` differently.

A check that both platforms resolve the same flag state, run as a release preflight, is the
cheapest form of that guarantee. Worth doing while the second target is fresh.

## Still open, and not blocking Android

- ✅ **The app icon is real** *(2026-08-26)* — generated from one vector source in
  `assets/icon/`, with `pnpm test:icons` guarding every raster against it. iOS' `beta` rung
  checks it (`scripts/release/targets/ios.mjs`); Android needs the equivalent once its rungs
  are real.
- **dSYMs are missing** for React Native's prebuilt XCFrameworks (`React`,
  `ReactNativeDependencies`, `hermesvm`), so crash reports will not symbolicate frames inside
  them. Our own code symbolicates fine. ⚠️ **This is now an iOS question and it is no longer
  hypothetical** — the App Store is the rung that generates crashes from strangers, and it
  arrives before this doc does. Decide whether to care as part of GA, not here. *(Android is the
  happier case: `bundleRelease` ships native debug symbols in `BUNDLE-METADATA/`, which Play
  strips from delivery and uses to symbolicate, so Android crash reports arrive legible.)*
