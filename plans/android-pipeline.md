# Android: the release target, and the Play account that publishes it

> **In flight** *(owner, 2026-09-13)*. Android ships from the **personal** Play account to the
> internal and closed tracks; a later app transfer moves it to the company for $25. The build
> half is done and proven. **What is left is the upload half plus Play Console paperwork.**
>
> **This doc is written to be read cold** — by a person or an agent arriving with no context —
> because the work spans a repo and a web console and neither half makes sense alone.
>
> **Delete it when the work lands.** How to cut a build then belongs in
> [`apps/mobile/README.md`](../apps/mobile/README.md); the rules belong in `scripts/release/`,
> which documents itself. *(Numbered `v0-1_04_mobile-pipeline.md` until 2026-09-06; deferred
> past v0.1 that day and un-deferred on 2026-09-13 — `git log` has the history.)*

## Where this stands *(2026-09-14)*

| | State |
| --- | --- |
| Android developer verification | ✅ complete |
| Play app record `com.leapsake.app` | ✅ created, personal account, **Draft** |
| Play App Signing | ✅ enrolled — quantum-ready hybrid, Google-held key |
| Upload key + signing config plugin | ✅ built and verified end to end |
| First AAB uploaded (internal track) | ✅ `368157 (0.1.0)`, *Available to internal testers* |
| Install confirmed on a physical device | ☐ opt-in link still propagating |
| App content declarations | ☐ **next** |
| Main store listing | ☐ **gates the closed track** |
| Closed track + Google Group | ☐ this is the "Android beta" goal |
| Service account for the API | ☐ unblocks all automation |
| `play.mjs` + `android.mjs` | ☐ not written; target is still `status: "blocked"` |

**The goal in flight is an Android *beta*, which under the mapping below means the closed
track.** It is gated only by App content + the store listing — not by the 12-tester wall, which
gates *production access* alone and is a separate, later decision.

## Facts established the hard way — do not re-derive these

Each of these was checked against Google's own support pages on 2026-09-13/14, and several
contradict what this document said before. Re-deriving them costs a day.

- **The 12-tester/14-day wall gates *production access* only.** It binds personal accounts
  created after 2023-11-13 (ours). You run a closed test and *then* apply for production. It is
  not a tax on uploading, and it does not block a closed track from existing.
- **Internal testing sits outside it entirely** — no minimum testers, no review wait.
- **App transfers are routine**, not one-way doors. Package name, users, statistics, ratings,
  reviews and listing all move: $25 on the receiving side, ~2 business days. ⚠️ **The app signing
  key stays with the app unless the receiving account requests a key upgrade — never request
  one**, or Android buys the entire iOS re-key cost ([`shipping.md`](./shipping.md) → *What the
  transfer costs*) for nothing. The **Change key** button on the App signing page is that trap.
- ⚠️ **The Play Developer API cannot create an app.** It only edits an app that already has a
  bundle. The first AAB had to go through the Console by hand; that is done, and it is why
  automation was impossible until now. No tooling removes this for the *next* new app either.
- **Play has one review gate where Apple has two.** Apple separates Beta App Review from App
  Store Review; Play reviews a release when it rolls out to a track, with no separate "submit"
  action. **Managed publishing** is what recovers the `rc`/`final` split — see below.
- ⚠️ **Android developer verification** is required of new personal accounts since Sept 2026, and
  no new account reaches production without it. Ours is complete. Whether it gates *internal*
  testing was never established; it stopped mattering once ours cleared.

## Decisions already made — do not relitigate

1. **Ship from the personal account now**, transfer to the company later. The old plan waited for
   incorporation on the strength of the false "first upload binds the package name forever" claim.
2. **The rung → track mapping** (next section) is settled, including parity as the reason.
3. **Automatic protection stays OFF** (*Protected with Play*). It injects installer and anti-tamper
   checks and has Google re-sign modified APKs — which sits badly against an AGPL-3.0 repo about
   to go public, against self-host parity, and against the `LeapsakeCommit`/receipts provenance
   chain, since it ships bytes we did not build.
4. **Data safety answer is "no data collected, no data shared"** — true by construction in v0.1:
   single-device, no account, sync behind the `multiDevice` flag. ⚠️ Revisit the day the relay
   ships; a stale declaration is a policy problem.
5. **Target audience is adults, not children.** Declaring a child audience pulls the app into
   Families policy and a stack of extra requirements.
6. ☐ **Undecided:** *Prevent installs on risky devices* (currently off, making the Play Store
   protection panel read 6 of 7). The argument for leaving it off is consistent with #3 — it
   blocks rooted phones, custom ROMs and de-Googled devices, which is much of the natural early
   audience for a local-first privacy app, against a threat model this app does not have (no
   in-app purchases, no server-side secrets). Not verified in detail; decide deliberately rather
   than to make the counter read 7 of 7.

## How the rungs map to Play tracks — settled *(owner, 2026-09-13)*

**A rung means the same thing on every platform, and each store's vocabulary bends to fit it.**
iOS, Android and eventually macOS/Windows/Linux answer to one ladder, so `beta` never means "the
first strangers" on one platform and something else on another. Where a store cannot express a
rung, the rung is **withheld** on that platform — never redefined.

| Rung    | Play track | What happens |
| ------- | ---------- | ------------ |
| `alpha` | internal | ≤100 testers, live in minutes, no review wait |
| `beta`  | closed | the tester Group; reviewed; testers join by opt-in link |
| `rc`    | closed **+** a production release held by managed publishing | testers get it, Google reviews it, it waits |
| `final` | publish the approved release | goes live; the tag names the commit that did |

**Managed publishing is what makes `rc`/`final` work.** With it on, approved changes wait in
*Changes ready to publish* until a person publishes them — Play's equivalent of Apple's *Pending
Developer Release*. So `rc` submits and waits, `final` publishes and tags, exactly as on iOS.
⚠️ **Internal tracks bypass managed publishing** and go out immediately, which is what `alpha`
wants anyway.

**The wall is earned rather than dodged.** The closed-track uploads `beta` makes are exactly the
activity that accumulates the 12-tester/14-day credit, so shipping betas is the path to
production rather than a detour around it. Until that clock finishes, **`final` must refuse on
Android** — and its preflight must say so rather than failing mid-release after iOS has shipped.

⚠️ **A naming collision to confirm before writing the client.** Play's API track identifiers are
`internal`, `alpha`, `beta`, `production` — and historically the API's `alpha` means *closed*
testing while its `beta` means *open* testing. If that still holds, this repo's `beta` rung
targets the API track named `alpha`. **Unverified.** Confirm against the API reference and leave
a loud comment wherever the mapping is written down.

---

# Operational: the Play Console half

## Navigating the Console — read this first

- **There is no global search box.** Do not look for one.
- **The Console is two-level.** The account-level sidebar (Policy status, Users and permissions,
  Developer account…) does *not* contain app pages. Click **View app →** on the app row first;
  the app-level sidebar then shows Dashboard, Statistics, Publishing overview, Protected with
  Play, and the collapsed groups *Test and release*, *Monitor and improve*, *Grow users*,
  *Monetize with Play*. Those four are expandable headers, not links.
- **App signing lives somewhere non-obvious:** *Protected with Play → Play Store protection →
  Manage Play app signing* (URL slug `/keymanagement`). It is **not** under *Test and release*.
- **Deep links** follow `play.google.com/console/u/0/developers/<accountId>/app/<appId>/<slug>`.
  Both IDs appear in any Console URL for this app — read them from the address bar rather than
  hunting through menus, and bookmark the slugs.
- **The app Dashboard's "View tasks" flow is the authoritative setup path.** Prefer it to any
  click-path written down here, including this one.

## Remaining steps, in order

### 1. App content declarations
App-level Dashboard → *Finish setting up your app* → View tasks. Answers, all settled above:

| Declaration | Answer |
| --- | --- |
| Privacy policy | `https://leapsake.com/privacy/` (already live, same as iOS) |
| App access | All functionality available without special access — v0.1 has no login |
| Ads | No |
| Content rating | Complete the questionnaire; expect *Everyone*. Must not remain *Unrated* |
| Target audience | Adults. **Not** children |
| Data safety | No data collected, no data shared |
| News / COVID / government / financial / health | No to each |

### 2. Main store listing — **this is the gate on closed testing**
Play refuses to roll out a closed release while it is incomplete, and reports it as the track
being stuck rather than as a listing error.

- Title ≤30 chars, short description ≤80, full description ≤4,000
- App icon 512×512
- **Feature graphic 1024×500, JPEG or 24-bit PNG, no transparency** — required, not optional
- ≥2 phone screenshots (max 8). Must be **Android** captures; iOS ones are the wrong aspect.
  The repo can produce these — `scripts/lib/mobile-harness.mjs` boots and drives an emulator
- Category, contact details, countries/regions

### 3. Rebuild the AAB from a clean tree before the closed release
⚠️ **Do not use *Promote release* to move the existing internal build to closed.** Build `368157`
was produced from a dirty working tree and corresponds to no commit. Promoting it would put an
unreproducible artifact in front of testers for weeks. Rebuilding costs ~4 minutes:

```sh
cd apps/mobile/android
export LEAPSAKE_ANDROID_KEYSTORE="$(grep '^LEAPSAKE_ANDROID_KEYSTORE=' ../../../.env | cut -d= -f2-)"
export LEAPSAKE_ANDROID_KEY_ALIAS=leapsake-upload
export LEAPSAKE_ANDROID_KEYSTORE_PASSWORD="$(cat "$HOME/.leapsake/upload-keystore-password.txt")"
./gradlew bundleRelease
# → app/build/outputs/bundle/release/app-release.aab
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab
```

The signer SHA-256 must read
`61:B6:0B:A8:D5:FE:D8:FD:F2:6D:89:30:87:68:7A:39:7A:70:29:B7:DF:00:FF:0E:8D:09:7A:B0:40:C1:73:D4`
— the upload key's fingerprint, confirmed against the certificate Play itself issues. It is a
certificate fingerprint, not a secret. A *fresh* prebuild is needed first if `android/` is absent
(`pnpm --filter @leapsake/mobile exec expo prebuild --platform android`).

### 4. Create the closed track
*Test and release → Testing → Closed testing → Manage track → Testers.* Use a **Google Group**
(`name@googlegroups.com`) rather than an email list: membership changes then never touch Play
Console, and the tester roster stays out of the release path. Compare iOS, where the group *name*
is the contract (`ASC_BETA_GROUP`) and renaming it breaks the release.

This is the "Android beta" the current work is aiming at.

### 5. Service account — unblocks every automated step
1. Enable the API: <https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com>
2. Create the account and a JSON key:
   <https://console.cloud.google.com/iam-admin/serviceaccounts>. Save it beside the other
   credentials in `~/.leapsake/`; `credentials.json` is gitignored at any depth.
3. Account-level *Users and permissions* → **Invite new users** → the `…iam.gserviceaccount.com`
   address → grant **"Release apps to testing tracks"**. That is least privilege and enough for
   `alpha`/`beta`/`rc`. Production release permission is a later, separate grant — and `final` is
   blocked on production access regardless.

### 6. Turn on managed publishing
*Publishing overview → Managed publishing → on.* Required before `rc`/`final` mean what the
mapping says. Internal tracks bypass it.

## Traps that have already cost time

- **Testers must match in two independent places.** The Google account in the **browser** that
  opens the opt-in link joins the test; the account **active in the Play Store app** performs the
  install. If they differ, the app silently does not appear — no error explains why. Multiple
  accounts on one device are fine; switching the Play Store account is the fix. ⚠️ **Send this
  instruction along with the opt-in link**, or a 12-tester recruitment drive quietly stalls at 9.
- **A first test link takes hours to propagate**, sometimes into the next day. "Item not found"
  after successfully opting in is the expected symptom, not a misconfiguration — if Console says
  *Available to internal testers*, it worked. ⚠️ **Do not republish or re-upload to "fix" it**;
  each attempt burns a version code that can never be reused.
- **"Not reviewed" on an internal release is normal** and matches the "(unreviewed)" label testers
  see on the opt-in page. Internal testing requires no review.
- **Play's "no deobfuscation file" warning is expected** — see *Still open* below.

---

# Technical: what is left to build

`scripts/release/targets/android.mjs` is still a `blocked` stub — blocked because the upload is
unwritten, **not** because uploading is dangerous. The target contract is documented in
`scripts/release/targets/index.mjs`; below is only what is Android-specific.

- ✅ **Build an AAB, not an APK** — `expo prebuild --platform android` then `./gradlew
  bundleRelease`, build number pinned through `LEAPSAKE_BUILD_NUMBER` as iOS does. `android/` is
  generated and gitignored, so nothing may originate there — the signing config is injected by
  [`apps/mobile/plugins/with-android-release-signing.js`](../apps/mobile/plugins/with-android-release-signing.js),
  which documents its own reasoning and its anchors.
- ✅ **Signing is an upload key**, held in `~/.leapsake/` and named by path from `.env`
  (`LEAPSAKE_ANDROID_KEYSTORE`, `_KEY_ALIAS`, `_KEYSTORE_PASSWORD_PATH`). ⚠️ The password is read
  from a **file** and passed to Gradle in the child environment — `.env` holds paths, never
  secrets, per its own header.
- ☐ **`scripts/release/play.mjs`** — the API transport, mirroring `scripts/release/asc.mjs` in
  shape and in having **no dependencies**: `node:crypto` signs an RS256 JWT, exchanged for an
  access token at `https://oauth2.googleapis.com/token` with
  `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` for scope
  `https://www.googleapis.com/auth/androidpublisher`. Then the edit flow: `edits.insert` → POST
  the AAB to the **upload host**
  (`https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{pkg}/edits/{editId}/bundles`)
  → `edits.tracks.update` → `edits.commit`. Transport only, no policy — `asc.mjs`'s header
  explains why that split matters. One edit can update **several tracks**, which is how `rc`
  reaches the closed track and the held production release in a single commit.
- ☐ **`android.mjs` itself** — preflights in the same shape as iOS' (`envSet`/`fileAt` from
  `scripts/release/checks.mjs`), so a missing prerequisite is reported by `--dry-run` rather than
  discovered mid-upload: the keystore, its password file, the service-account JSON, the track
  reachable with those credentials, and — for `final` — **production access actually existing**,
  which is the check that stops a half-finished cross-platform release.
- ☐ **`final` builds nothing**, as on iOS: it publishes what review already approved and tags the
  commit that went live, resolved out of `refs/notes/releases`.
- ☐ **Flipping `status` to `"ready"`** is the last step, not the first. A ready target ships on
  every tag, so `pnpm release beta` will start shipping Android alongside iOS the moment it flips.

## The version-parity check this makes possible

⚠️ **This becomes real the moment Android goes `ready`**, arriving into a repo whose iOS app is
already published. A tag will then ship two artifacts claiming to work together — the point of the
single-version rule ([`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *Versioning and releases*) and
also the first moment it can be **wrong**: identical version numbers say nothing if the two builds
resolve `@leapsake/flags` differently. A preflight asserting both platforms resolve the same flag
state is the cheapest form of that guarantee. Worth doing while the second target is fresh.

## Still open, and not blocking Android

- ✅ **The app icon is real** *(2026-08-26)* — one vector source in `assets/icon/`, with
  `pnpm test:icons` guarding every raster. iOS' `beta` rung checks it
  (`scripts/release/targets/ios.mjs`); Android needs the equivalent once its rungs are real.
- ⚠️ **The commit does not ride inside the Android artifact** *(2026-09-14)*.
  `apps/mobile/app.config.ts` bakes `LeapsakeCommit` into the shipped `Info.plist`, where
  `plutil -p` reads it out of an `.ipa` **without launching anything** — the property a provenance
  claim needs, since it survives the app being unable or unwilling to report on itself. The
  `android` block sets only `versionCode`, so an AAB's manifest names no commit and the claim
  falls back to `extra.commit` in the JS bundle, which requires the app to *run*. The fix mirrors
  the two plugins already in `apps/mobile/plugins/`: a `withAndroidManifest` plugin writing a
  `<meta-data>` element that `aapt2 dump badging` can read. Worth doing when the target is built,
  since that is when receipts start mattering here.
- **No R8 mapping file is uploaded**, because `enableMinifyInReleaseBuilds` is off — so Play's
  "no deobfuscation file" warning on every upload is correct and harmless. ⚠️ The day
  minification is turned on for app size, that warning becomes real and the mapping upload has to
  join `publish()`.
- **dSYMs are missing** for React Native's prebuilt XCFrameworks (`React`,
  `ReactNativeDependencies`, `hermesvm`), so iOS crash reports will not symbolicate frames inside
  them. ⚠️ **An iOS question, no longer hypothetical** — the App Store generates crashes from
  strangers. Decide as part of GA, not here. *(Android is the happier case: `bundleRelease` ships
  native debug symbols in `BUNDLE-METADATA/`, which Play strips from delivery and uses to
  symbolicate, so Android crash reports arrive legible.)*
