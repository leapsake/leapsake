# v0.1 · 04 — The Android release target, and the closed-test clock

> **Delete this doc when the work lands.** How to cut a build belongs in
> [`apps/mobile/README.md`](../apps/mobile/README.md); the rules belong in `scripts/release/`,
> which documents itself. This file exists only for the part that is not built yet.

✅ **The iOS half is done** *(2026-08-26)*. `pnpm release alpha` cuts a tag, gates on
the suite, prebuilds, archives with manual signing, exports, validates and uploads —
`0.1.0-alpha.2` (build 341572) reached TestFlight that way with no Xcode session. EAS is out;
the whole path is local `xcodebuild` plus an App Store Connect API key. Store identity and
build numbers are settled and encoded.

**What is left is Android, and it is the entire critical path.**

## Why this is the long pole

Google Play production access requires a closed test with **≥12 testers opted in continuously
for 14 days**, and the clock **only starts once a build is uploaded**. Nothing else in v0.1
takes as long, and no amount of engineering shortens it.

⚠️ Two halves, and only one of them is code:

1. The `android` target below — days of work at most.
2. The wall in front of production, which is **calendar time, not engineering**, and whose shape
   is an open question: 12 testers for 14 continuous days if v0.1 publishes from the *personal*
   account, or a D-U-N-S wait of up to 30 days if the owner forms the legal entity first
   (leaning that way as of 2026-08-26). Open decision 4 in [`v0-1.md`](./v0-1.md).

⚠️ **This changes where the target stops.** `com.leapsake.app` is claimed on Play by the account
that **first uploads** it — globally unique, permanent, bound to that account — so **uploading
from the personal account forecloses the org choice** and turns it into a transfer. (The Play
*title* is a separate matter and not at risk: Play titles are not exclusively reserved, checked
2026-08-26.) Until decision 4 is settled, build and verify the target **locally**, and stop
before the upload. That is the last step, and it is the only one that is hard to undo.

## What the Android target has to do

It fills in `scripts/release/targets/android.mjs`, which today is a `blocked` stub declaring
its rungs. The contract it implements is documented in `scripts/release/targets/index.mjs`;
what follows is only what is *Android-specific*.

- **Build an AAB, not an APK.** Play requires the App Bundle for new uploads.
  `expo prebuild --platform android` then `./gradlew bundleRelease`, with the build number
  pinned through `LEAPSAKE_BUILD_NUMBER` exactly as iOS does — `android/` is generated and
  gitignored on the same principle, so nothing may originate there either.
- **Signing is an upload key, not the app-signing key.** Enrol in **Play App Signing**: Google
  holds the distribution key and re-signs, and the repo only ever holds the *upload* key. That
  is the arrangement worth having — a lost upload key is a support ticket, a lost app-signing
  key is a dead listing. The keystore is passed at invocation from `.env`
  (`*.jks` / `*.keystore` are already gitignored at any depth).
- **Upload with a Google Cloud service account**, the Play equivalent of the ASC API key, via
  the Google Play Developer Publishing API. Never an interactive console upload — that is the
  step this whole workstream exists to remove.
- **Map the rungs to tracks** in the target's `tiers`, alongside the names already stubbed:
  `alpha` → internal testing, `beta`/`rc` → closed testing (this is the rung that starts the
  clock), `final` → production.
- **Preflights, in the same shape as iOS'**, so a missing prerequisite is reported by
  `--dry-run` rather than discovered mid-upload: the keystore file and its passwords, the
  service-account JSON, and the Play track being reachable with the credentials given.

**Acceptance, in two stages** — because the second one is the irreversible half:

1. **Now:** `pnpm release beta --dry-run` reports a clean `android` row — every preflight
   passing — and the target produces a signed AAB from a clean checkout that installs and runs
   on a device. No upload.
2. **Once decision 4 is settled:** the same command without `--dry-run` ships both platforms
   from one tag, uploading to the chosen track from the chosen account with no Play Console
   interaction.

⚠️ **Neither step reaches for `--only`, deliberately.** A release is all-or-nothing across every
ready target, and selecting one by hand is the habit that makes that untrue — see
[`10`](./v0-1_10_external-testflight.md) → *Not gating*. Until decision 4 is settled the thing
that must hold Android back is its own `blocked` status in `android.mjs`, which the release
refuses and explains, rather than a flag someone has to remember to leave off.

## The version-parity check this makes possible

Once both targets are `ready`, one tag ships two artifacts that claim to work together —
which is the point of the single-version rule ([`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *Versioning and
releases*) and also the first moment it can be **wrong**: identical version numbers say nothing
if the two builds resolve `@leapsake/flags` differently.

A check that both platforms resolve the same flag state, run as a release preflight, is the
cheapest form of that guarantee. Worth doing while the second target is fresh.

## Still open, and not blocking Android

- ✅ **The app icon is real** *(2026-08-26)* — generated from one vector source in
  `assets/icon/`, with `pnpm test:icons` guarding every raster against it. iOS' `beta` rung
  checks it (`scripts/release/targets/ios.mjs`); Android needs the equivalent once its rungs
  are real.
- **dSYMs are missing** for React Native's prebuilt XCFrameworks (`React`,
  `ReactNativeDependencies`, `hermesvm`), so crash reports will not symbolicate frames inside
  them. Our own code symbolicates fine. Decide whether to care before external testers start
  generating crashes worth reading.
