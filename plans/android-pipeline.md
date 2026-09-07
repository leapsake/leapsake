# The Android release target, and the Play account that publishes it

> **Deferred past v0.1** *(owner, 2026-09-06)* — v0.1 is **iOS only**, so this is no longer a
> numbered gating doc and no longer holds a place in the v0.1 order. It keeps its detail rather
> than folding into [`v0-2.md`](./v0-2.md) because the target contract below is still exactly
> what has to be built, and the account sequencing is the whole reason it waits.
>
> **Delete this doc when the work lands.** How to cut a build belongs in
> [`apps/mobile/README.md`](../apps/mobile/README.md); the rules belong in `scripts/release/`,
> which documents itself. *(Numbered `v0-1_04_mobile-pipeline.md` until 2026-09-06, when its iOS
> half had shipped and its Android half left v0.1 — `git log` has the history under both names.)*

✅ **The iOS half is done** *(2026-08-26)*, and it was the half v0.1 needed. `pnpm release alpha`
cuts a tag, gates on the suite, prebuilds, archives with manual signing, exports, validates and
uploads — `0.1.0-alpha.2` (build 341572) reached TestFlight that way with no Xcode session, and
three betas have followed. EAS is out; the whole path is local `xcodebuild` plus an App Store
Connect API key. Store identity and build numbers are settled and encoded.

**What is left is Android, and it now waits on a company rather than on engineering.**

## Why this waits, and why waiting is the cheap move

**The decision** *(owner, 2026-09-06)*: v0.1 ships iOS only from the personal account, Leapsake
incorporates, the iOS record transfers to the company, and **Android starts under the company
account** — its first upload ever. See [`shipping.md`](./shipping.md) → *Part 2*.

This is not a delay of the Play work so much as a deletion of most of it:

- **The 12-tester/14-day closed-test wall never applies.** It binds *personal* accounts created
  after 2023-11-13, which ours is. An organization account publishes straight to production.
  *(Google's page scopes the rule to personal accounts and does not discuss orgs; the exemption
  is consistent across secondary sources but is not stated by Google in those words — **confirm
  it before relying on it**, because the whole shape of this doc rests on it.)*
- **There is no Play app transfer to do**, because nothing was ever published from the personal
  account. `com.leapsake.app` is claimed on Play by the account that **first uploads** it —
  globally unique, permanent, bound to that account — so the way to bind it to the company is
  simply to never upload it from anywhere else. *(The Play **title** is a separate matter and
  never was at risk: Play titles are not exclusively reserved, checked 2026-08-26.)*
- **The calendar time moves off the critical path entirely.** The D-U-N-S wait of up to 30 days
  is real, but it runs in parallel with the iOS GA work rather than in front of a store listing.

⚠️ **The one rule this doc exists to protect: do not upload anything to Play from the personal
account.** Not an alpha, not a test, not "just to see if the AAB is accepted". The first upload
is the irreversible step, and it is the only one. Building and installing the AAB locally proves
everything except the thing that cannot be undone.

`android.mjs` stays `blocked` for exactly this reason — the release refuses it and explains why,
rather than relying on someone remembering not to pass a flag.

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
  `alpha` → internal testing, `beta`/`rc` → closed testing, `final` → production. Under a company
  account no rung starts a tester clock, so the tracks are only what they say they are.
- **Preflights, in the same shape as iOS'**, so a missing prerequisite is reported by
  `--dry-run` rather than discovered mid-upload: the keystore file and its passwords, the
  service-account JSON, and the Play track being reachable with the credentials given.

**Acceptance, in two stages** — because the second one is the irreversible half:

1. **Buildable before the company exists:** `pnpm release <rung> --dry-run` reports a clean
   `android` row — every preflight passing — and the target produces a signed AAB from a clean
   checkout that installs and runs on a device. **No upload.** All of this can be written and
   proved while the incorporation paperwork runs; it is the half that does not touch Play.
2. **Once the company account exists:** the same command without `--dry-run` uploads to the
   chosen track from the company account with no Play Console interaction — and that upload is
   what claims `com.leapsake.app` on Play, permanently and correctly, the first time.

⚠️ **Neither step reaches for `--only`, deliberately.** A release is all-or-nothing across every
ready target, and selecting one by hand is the habit that makes that untrue. What must hold
Android back is its own `blocked` status in `android.mjs`, which the release refuses and
explains, rather than a flag someone has to remember to leave off. **Do not flip that status
until the account that will publish exists** — it is the interlock standing between a local
build and an irreversible upload.

## The version-parity check this makes possible

⚠️ **This becomes real the moment Android goes `ready`, and Android arrives into a repo whose
iOS app is already published.** A tag will then ship two artifacts that claim to work together —
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
  them. Our own code symbolicates fine. ⚠️ **This is now an iOS question and it is no longer
  hypothetical** — the App Store is the rung that generates crashes from strangers, and it
  arrives before this doc does. Decide whether to care as part of GA, not here.
