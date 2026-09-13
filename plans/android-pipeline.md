# The Android release target, and the Play account that publishes it

> **In flight** *(owner, 2026-09-13)* — Android no longer waits for the company. It ships from
> the **personal** Play account to the **internal testing track**, and a later app transfer
> moves it to the company for $25. What is left is the upload half of the target.
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
  minutes, on any account type. This is the track v0.1 Android ships to.
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
  `scripts/` keeps its zero dependencies.
- ⚠️ **Which track each rung ships to is an open decision.** A `ready` Android target means
  `pnpm release beta` ships Android too — that is the *name no platform* principle working as
  designed. Android cannot reach production on this account, so the higher rungs must resolve
  somewhere sane before the status flips. The proposal on the table: `alpha`/`beta`/`rc` all to
  the internal track, honestly named, with `final` refusing via a check that explains it needs
  either the closed-test credit or the company account.
- **Preflights in the same shape as iOS'**, so a missing prerequisite is reported by `--dry-run`
  rather than mid-upload: the keystore and its password file, the service-account JSON, and the
  track being reachable with the credentials given.

**Acceptance, in three stages:**

1. ✅ **A signed AAB, no Play account needed** *(2026-09-13)* — built from the plugin above, with
   the signer fingerprint verified against the upload key.
2. **The manual bootstrap** — the app record created in Play Console and the first AAB uploaded
   to the internal track by hand, because the API cannot do it. This is what makes stage 3
   possible rather than what stage 3 replaces.
3. **`pnpm release alpha` uploads to the internal track** with no Play Console interaction.

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
