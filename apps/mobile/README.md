# @leapsake/mobile

The Leapsake mobile app (Expo + React Native, expo-router). Unlike desktop there is no IPC
boundary: the app builds `@leapsake/core` **in-process** over an expo-sqlite driver, so the
same core surface backs both clients behind a swapped driver and key-store port.

## Layout

```
app/          # expo-router routes; (tabs)/index.tsx is Home (the reminders list)
              # Four tabs — Home, Search, New, Settings/Account. "New" never
              # navigates: it resolves to a create screen or opens a sheet.
              # Everything else (People & Pets, the holidays and gifts catalogs,
              # Data, Settings, add.tsx, every detail screen) is a root-stack
              # route that pushes full-screen over the tab bar.
components/   # AppHeader.tsx draws the header for *both* navigators, so iOS and
              # Android get one design; screens still just set `title`.
db/           # the expo-sqlite driver, store conversion, and the unlock doors
lib/          # core-context.tsx — the boot path, custody branches, and core wiring
test/         # the on-device self-tests (driver contract + custody)
maestro/      # the E2E flows; see maestro/README.md
```

**Where the data lives depends on custody.** A device with no account holds a _plaintext_
store; once an account exists it is encrypted at `stores/<accountId>/`, with the two unlock
doors in `doors.db` beside it. The full cross-repo map is in
[`@leapsake/key-custody`](../../packages/key-custody/README.md).

**Cloud backup is off on both platforms, deliberately.** Android: `android.allowBackup: false` in
`app.json`, where Expo otherwise defaults it to `true`. iOS: `plugins/with-store-backup-exclusion.js`
marks `<Documents>/SQLite` — where expo-sqlite puts every database — as excluded, because iOS backs
Documents up to iCloud by default and there is no JS API for the flag in `expo-file-system@56`.

The _restore_ path was never the problem: neither platform backs up the OS keystore, so a restore
arrives with an encrypted store, its doors, and no key — which lands on the unlock gate and costs
one password, exactly as the custody model intends (`expo-secure-store` returns `null` rather than
throwing on an invalidated key, so the boot takes its surviving-sidecar branch). What backup is off
for is the **other** store: a device with no account holds its data _plaintext by design_, and
backup would ship every person, contact method and birthday to Apple or Google in readable form —
not something a privacy product should do silently, and not something
[`../../PRIVACY.md`](../../PRIVACY.md) describes.

**The trade, stated plainly:** there is no automatic device-to-device migration, so replacing a
phone means [`@leapsake/export`](../../packages/export/README.md) or sync. That is only defensible
while the export path is real. If migration is ever wanted back, the narrower move on both
platforms is to exclude only `stores/local/` — `dataExtractionRules` on Android, a narrower path in
the plugin on iOS — rather than to switch backup off wholesale. It is wholesale today because an
exclusion rule **fails open**: a renamed slot or a new plaintext artifact silently stops matching,
and nothing goes red. Off fails closed.

## Running

```sh
pnpm --filter @leapsake/mobile ios       # dev client, iOS simulator
pnpm --filter @leapsake/mobile android   # dev client, Android emulator
```

This is a **native SQLCipher build** — Expo Go cannot host it.

Against a local relay, the simulators reach the host differently:

| Platform         | Relay URL               |
| ---------------- | ----------------------- |
| iOS simulator    | `http://localhost:4000` |
| Android emulator | `http://10.0.2.2:4000`  |

Start the relay with `pnpm --filter @leapsake/server dev` — see
[`@leapsake/server`](../server/README.md) → _Running_.

## Cutting a release

> **The bundle ID is `com.leapsake.app`, and it is permanent.** It is chosen when the App Store
> Connect record is created and cannot be edited afterwards, so it outlives every other choice
> here. It is deliberately **form-factor-neutral** — no `.ios`, no `.phone` — so a future iPad or
> watchOS target joins the *same* Apple record rather than starting a new one, and so it survives
> a React Native → native rewrite. The desktop app is a **separate** identity
> (`com.leapsake.desktop`); see [`plans/desktop-packaging.md`](../../plans/desktop-packaging.md)
> for why sharing one would have cost more than it bought.

```sh
pnpm release cut alpha --dry-run                # the next tag, and what each platform is waiting on
pnpm release cut alpha                          # tag HEAD once the tag is typed back
git push origin v0.1.0-alpha.4                  # starts the hosted pipeline, once it exists
pnpm release ship --tag=v0.1.0-alpha.4 --here   # or ship from this machine: gate, build, upload, record
```

> **Android ships one fewer permission than prebuild writes.** Expo's template declares
> `SYSTEM_ALERT_WINDOW` — the "draw over other apps" overlay, there for React Native's dev
> menu — in the *main* manifest, so it reaches release builds too. Play treats it as sensitive
> and asks apps to justify it, which this one cannot: no code requests it, and no dependency
> declares it (the manifest-merger report names only our own file). `android.blockedPermissions`
> in `app.json` removes it. Blocking it cannot change behaviour in *any* variant, dev client
> included, because the permission is never auto-granted — a declared-but-ungranted overlay
> permission and an undeclared one both make `canDrawOverlays()` false. Verify a change here
> against `app/build/intermediates/merged_manifests/`, never the source manifest, which keeps
> listing the permission with `tools:node="remove"`.

**Name no platform.** A tag ships every target that is `ready` and reports the rest as ⏳ with
the reason, so a platform is held back by its own status in `scripts/release/targets/`, never
by a flag left off the command line.

`scripts/release/` owns the rules and documents them in its own header; `pnpm release
--help` prints the current rung/platform matrix. Credentials live in an untracked `.env`
(copy `.env.example`) — team, provisioning profile, and an App Store Connect API key.

**From `beta` up, the release does not stop at the upload.** `alpha` hands the `.ipa` to
App Store Connect and ends there, which is all an internal build needs. `beta` and `rc` go
on to wait out processing, attach _What to Test_, add the build to the external tester
group, and submit it for Beta App Review — so a build reaches strangers with no App Store
Connect session anywhere in the path. Two things follow that nothing else in the repo
implies:

- **The API key must be App Manager.** A _Developer_ key uploads builds perfectly well and
  cannot do any of the four steps above. The preflight is otherwise entirely offline and
  makes one deliberate exception — a live read of the app record — to catch that before the
  archive rather than after the upload. A role change means a **new key**, because the
  `.p8` downloads exactly once. The same probe reports what the record is still missing:
  Test Information, Beta App Review contact and notes, the tester group.
- **`release-notes/what-to-test.txt` is release copy, not a changelog.** It is what every
  external tester reads before installing, it is plain text because TestFlight renders no
  Markdown, and at this rung it has to say that the build is not a sole copy of anything.
  Preflight fails in the first ten seconds if it is missing, because the alternative is
  finding out after a twenty-minute archive.

Beta App Review runs **per version, not per build** — `0.1.0-beta.1` pays the day and
`beta.2` onwards go out in minutes — and the internal alphas buy no credit toward it,
since internal builds skip beta review entirely.

Three things about this app specifically, all of which cost an evening to learn once:

- **`ios/` is deleted and regenerated on every release.** It is `expo prebuild` output and
  gitignored, so nothing may originate there — signing is passed at invocation instead. A
  release therefore leaves you needing a fresh `pnpm --filter @leapsake/mobile ios` before
  the next dev-client run.
- **The suite's iOS tier needs a dev client that has been launched at least once against
  the running Metro**, because the harness reconnects through the dev-launcher's remembered
  server. If it times out at 180s having found no _Continue_ button, that list is empty (or
  its stored URL is a LAN address that has since changed) — relaunch the dev client rather
  than debugging the flow. `pnpm test:native --provision` (which is what a release runs)
  repairs this itself by relaunching once and retrying; without the flag it is yours to fix.
- **Export compliance is declared in `app.json`**, not answered per upload. Without
  `ITSAppUsesNonExemptEncryption` a build lands at _Missing Compliance_ and cannot be
  distributed to anyone, internal testers included.

### Android and the Play Console

Android ships from the **personal** Play account to the internal and closed tracks; a later
app transfer moves it to the company. What is still unbuilt on this side is
[`plans/android-pipeline.md`](../../plans/android-pipeline.md). Everything below is settled.

**A rung means the same thing on every platform, and each store's vocabulary bends to fit it.**
Where a store cannot express a rung, the rung is **withheld**, never redefined.

| Rung    | Play track                                                       | What happens                                                  |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `alpha` | `internal`                                                       | ≤100 testers, live in minutes, no review wait                 |
| `beta`  | `alpha` _(closed)_                                               | the tester list; reviewed; testers join by opt-in link        |
| `rc`    | `alpha` _(closed)_ **plus a held production release, once possible** | testers get it, Google reviews it, it waits               |
| `final` | `production`                                                     | publishes what review approved; the tag names the commit that did |

⚠️ **The rung named `beta` ships to the API track named `alpha`.** Play's `alpha` is closed
testing and its **`beta` is open testing, the whole internet**. No rung here may ever target it;
`android.release.test.mjs` asserts that, because drifting by one name would publish a beta to
strangers and report success. `final` refuses on Android until production access exists, from
the preflight pass rather than mid-release; `rc` is closed-only for the same reason.

**Play facts that will not be re-derived:**

- **The 12-tester/14-day wall gates _production access_ only.** It binds personal accounts
  created after 2023-11-13 (ours). You run a closed test and _then_ apply. It is not a tax on
  uploading, and the closed-track uploads `beta` makes are exactly the activity that earns it.
  **Internal testing sits outside it entirely.**
- **App transfers are routine.** Package name, users, statistics, ratings, reviews and listing
  all move: $25 on the receiving side, about two business days. ⚠️ **The app signing key stays
  with the app unless the receiving account requests a key upgrade. Never request one**, or
  Android buys the entire iOS re-key cost ([`@leapsake/key-custody`](../../packages/key-custody/README.md)
  → _The signing identity owns the enclave key_) for nothing; the **Change key** button on the
  App signing page is that trap. Two things do **not** ride along: the service account's grant,
  which must be re-invited under the receiving account's _Users and permissions_, and **Android
  developer verification**, which every account needs on its own.
- **`tracks.update` replaces the whole `releases` array**, so a release body must always be
  complete: anything omitted is gone. Tester lists live behind a separate resource
  (`edits/{id}/testers/{track}`) that reads `{}` for an email-list track, because it only ever
  exposed Google Groups. That also means **no tooling can watch the opt-in count**; the Console's
  _Testers_ tab is the only place the real number lives.
- ⚠️ **The Play Developer API cannot create an app.** It only edits an app that already has a
  bundle, which is why the first AAB went through the Console by hand.
- **Play has one review gate where Apple has two.** Play reviews a release when it rolls out to a
  track, with no separate "submit" action.
- ⚠️ **Google's own API documentation is not reliable here.** The
  [APKs and Tracks](https://developers.google.com/android-publisher/tracks) page calls the
  internal track `qa` and never says which of `alpha`/`beta` is closed. `edits.tracks.list`
  against the app is the authority: `internal`, `alpha`, `beta`, `production`.
- **The Console and the API do not enforce the same preconditions.** A hand rollout was accepted
  while the API refused the same app over the advertising-ID declaration. "It worked by hand" is
  not evidence the scripted path will work; the cheap way to find the next gate is an API call
  against a disposable track. `consolePreconditions` in `scripts/release/targets/android.mjs`
  asks with `:validate` before anything is built. ⚠️ Whether `:validate` reports the two
  one-time refusals it was written for (a _draft app_ accepting only `status: "draft"`; a missing
  advertising-ID declaration) is **unverified**, because reproducing either means breaking a
  declaration on a live listing. If a `:commit` is ever refused while the preflight passed, that
  is the finding, and the fallback is a preflight that reads _App content_ state directly.
- **Retries are load-bearing.** Play's `POST /edits` and App Store Connect's `GET /v1/apps` have
  both failed transiently and recovered on retry; a red that survives four attempts is real.
- **After a release, read the closed track back.** The release should carry the _tag's_ name
  (`0.1.0-beta.9`, not `0.1.0`).

**Decisions made, do not relitigate:**

1. **Ship from the personal account now**, transfer to the company later. A Play transfer costs
   users nothing while the signing key stays put, so data safety does not decide where Android
   launches, and nothing else does either.
2. **Automatic protection stays OFF** (_Protected with Play_). It injects installer and
   anti-tamper checks and has Google re-sign modified APKs, which sits badly against an AGPL-3.0
   repo, against self-host parity, and against the `LeapsakeCommit`/receipts provenance chain,
   since it ships bytes we did not build.
3. **Testers are an email list, not a Google Group.** The Group argument was convenience; the
   email list wins on privacy, since Group members can see each other by default. ⚠️ Whether
   changing tester method preserves tester continuity was never established, so switch, if ever,
   before a 14-day clock starts.
4. **The closed track targets all countries.** It is invite-only regardless, so restricting it
   buys nothing and adds a third way a tester silently fails. Adding countries later is free;
   removing one strands whoever already installed.
5. **The placeholder feature graphic ships for the closed test.** Play leads a listing with the
   screenshot carousel, and closed testers arrive through an opt-in link, so the asset is
   invisible to them and a listing review holds up neither the rollout nor the clock. It has to
   be right for GA, which buys a review cycle anyway.

**Play declarations and their revisit triggers.** Each row is answered for **what ships**, and
each becomes wrong on a specific event. A declaration that no longer matches the app is a policy
problem, not stale paperwork; declaration changes go through review, so they cannot be flipped on
rollout morning. Sequence them **with** the release that changes the behaviour, not after it.

| Declaration                         | Answered                                                                                         | Becomes wrong when                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Data safety                         | no data collected, no data shared                                                                | the **relay** ships (v0.2)                                                                                              |
| Sign in details                     | No, nothing restricted                                                                           | the **relay** ships: a relay login is a real sign-in. Also if a device lock is ever forced at first run                  |
| Advertising ID                      | **No**: no `AD_ID` permission in the release manifest, no `play-services-ads` on the classpath   | any ads, attribution or analytics SDK lands. ⚠️ Required since targetSdk 33; the **API refuses the edit commit** without it |
| Content rating                      | _Everyone_, All Other App Types                                                                  | **purchases**, **sharing**, or **multimedia** land                                                                      |
| Target audience                     | **18 and over** only                                                                             | GA, _if_ teens ever become an audience worth designing for                                                              |
| App Store **App Privacy** (iOS)     | mirrors Data safety                                                                              | the **relay** ships. ⚠️ Same event, _different store_                                                                   |

⚠️ **The relay is one event that invalidates three declarations across two stores.** Updating
Play alone and shipping a stale iOS declaration is the failure this table exists to prevent. A
version-parity preflight that refuses a release until each answer has been re-confirmed since the
behaviour it describes changed is the check that should eventually replace this table
([`plans/android-pipeline.md`](../../plans/android-pipeline.md)).

Four answers are right for non-obvious reasons:

- **Sign in details → No**, and _not_ because v0.1 has no login. It ships a **local account**
  whose creation is what turns encryption on. The answer is No because nothing is _restricted_:
  there is no launch gate, every feature works without one, and there is no server-side account
  to provision for a reviewer. ⚠️ A **mandatory** PIN, password or biometric at first run would
  put this in play, and would first have to reverse the rule that first-run onboarding never
  forces account setup ([`@leapsake/key-custody`](../../packages/key-custody/README.md)).
- **Cash rewards / gift cards → No** despite the Gifts feature: those are private records of
  presents, not instruments of transferable value.
- **Web browser or search engine → No** despite the Search tab: it searches local records.
- **User Content Sharing stays No even after the relay ships.** Sync moves one user's data
  between their own devices, which is not exchanging content with _other_ users. Only sharing
  changes it.

⚠️ **Target audience is 18+, with "restrict users Google determines to be minors" left OFF.**
The declaration says who the app is _designed and marketed for_ and is not an access control;
_that checkbox_ is, and it would block minors from an app rated **Everyone** for no benefit.
Reconsider at GA with multimedia. Answer _Store presence_ consistently, since contradicting the
target-age answer is its own flag. ⚠️ **Purchases are the sharp one**: answering yes to digital
goods pulls in Play billing policy, not merely a rating change.

**Navigating the Console:**

- **There is no global search box.**
- **The Console is two-level.** The account-level sidebar (Policy status, Users and permissions,
  Developer account…) does _not_ contain app pages: click **View app →** first. Conversely
  _Users and permissions_ is **not** reachable from inside an app.
- **App signing lives somewhere non-obvious:** _Protected with Play → Play Store protection →
  Manage Play app signing_ (slug `/keymanagement`), not under _Test and release_.
- **Deep links** follow `play.google.com/console/u/0/developers/<accountId>/app/<appId>/<slug>`.
  Read both IDs from the address bar.
- **The app Dashboard's "View tasks" flow is the authoritative setup path.** Prefer it to any
  click-path written down here.
- **The closed-test opt-in link** is on _Test and release → Testing → Closed testing →
  **Testers** tab_, below the tester list, as "Copy link"; testers must already be on the email
  list to use it. Play does not reliably email testers on your behalf.

**Traps that have already cost time:**

- **Testers must match in two independent places.** The Google account in the **browser** that
  opens the opt-in link joins the test; the account **active in the Play Store app** performs the
  install. If they differ the app silently does not appear, with no error. **Send this
  instruction along with the opt-in link.**
- **A first test link takes hours to propagate**, sometimes into the next day. "Item not found"
  after opting in is the expected symptom. ⚠️ **Do not republish to "fix" it**: each attempt
  burns a version code that can never be reused.
- **"Not reviewed" on an internal release is normal.** Internal testing requires no review.
- **Play's "no deobfuscation file" warning is expected** until minification is turned on and an
  R8 mapping is uploaded with it.

## Why the driver test needs a device

**expo-sqlite's real engine cannot run in a headless Node/Vitest process.** It is a native
module: its graph resolves to `requireNativeModule('ExpoSQLite')`, which throws without an Expo
native runtime. That is structural, not a missing config — and it is why the mobile driver is
proven on an emulator instead of in the fast local suite.

Three substitutes were verified against expo-sqlite's shipped source and all fail. **Do not
re-litigate them:**

1. **The native path throws.** `build/index.js → SQLiteDatabase → ExpoSQLite.js →
requireNativeModule('ExpoSQLite')`. No native runtime in Node ⇒ throws at import.
2. **The Node branch is a no-op stub.** `ExpoSQLite.web.js`'s `typeof window === 'undefined'`
   branch loads `web/SQLiteModule.node`, whose own header calls it a _"dummy implementation for
   the server runtime."_ Every method no-ops, so the contract suite would pass while asserting
   nothing — the "fake it" trap in its purest form.
3. **The wa-sqlite WASM build is a different engine.** `web/SQLiteModule.ts` is real SQLite in
   WASM, but it is a _browser_ artifact (`new Worker`, SharedArrayBuffer/`Atomics`, needs
   `window`) and it is the **web** engine — not the iOS/Android native SQLCipher build that
   ships. A different engine violates "match production".

**jest-expo** _mocks_ the native module and **wa-sqlite** is the wrong engine, so neither is
prod-faithful. (jest-expo remains fine for pure-JS mobile _unit_ tests — just not for the
driver.) Using **better-sqlite3** "as mobile" is the same trap from the other side: that is
desktop's engine.

So the real `expoSqliteDriver` runs **inside the app on a simulator/emulator**: a `__DEV__`-gated
route builds a real `openDatabaseAsync(...)` → `expoSqliteDriver` and runs the **shared
`runDriverContract` spec** — the same one desktop runs — in-process against the real engine and
real SQLCipher. A Maestro flow launches the app on a booted device, deep-links to it, and asserts
the result from the command line, which is what makes an emulator run _automated_ rather than
manual.

**The harness assertion contract:** wait for `testID=driver-selftest-status` and assert its
`accessibilityLabel` reads `PASS` — `FAIL` on any failed case _or_ a zero-case run, `ERROR` if
the suite could not start. Key on that stable token, never the human-readable `N/N` count.

### Why Maestro _(owner-confirmed)_

The harness also founds the mobile E2E tier, so the choice was weighed long-term rather than for
this one self-test.

|                                  | **Maestro**                     | **Detox**                            | Appium                  |
| -------------------------------- | ------------------------------- | ------------------------------------ | ----------------------- |
| Model                            | **Blackbox** UI (YAML flows)    | Gray-box (instruments the RN bridge) | Blackbox (WebDriver)    |
| Sync / flakiness                 | retries + timeouts              | **bridge-idle sync** (fewest flakes) | manual waits (flakiest) |
| Install weight                   | single binary                   | npm + jest + native build config     | heavy server + drivers  |
| App coupling                     | none (drives the installed app) | instruments the build                | none                    |
| Fit to "as blackbox as possible" | **best**                        | weaker                               | ok                      |

Maestro wins on blackbox fit and install weight, and it is _arch-agnostic_ — it never touches the
RN bridge, so New-Architecture/Fabric is a non-issue, whereas Detox's instrumented build is the
part most likely to fight it. **Detox stays in reserve** for the day an elaborate flow
(sync/pairing) turns flaky and its bridge-idle determinism earns back the gray-box cost; the
tool-agnostic flow catalog keeps that switch cheap. Appium is overkill here.

## Form controls: the four pickers

Forms here are ports of the desktop forms — keep them behaviorally faithful (same fields,
same validation) and adapt only the input controls, because React Native has no `<select>`
and no `<datalist>`.

Four components cover every case, and each one's doc-comment states which list shape it is
for and why the other three are wrong for it — read those rather than a table here, since
they sit next to the code that has to honour them:

| Component                                       | The list it is for                                                |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| [`SelectField`](./components/SelectField.tsx)   | a short, finite enum — the native wheel/dropdown                  |
| [`SuggestField`](./components/SuggestField.tsx) | free text with a handful of usual answers                         |
| [`Typeahead`](./components/Typeahead.tsx)       | a long list picked _inline_, where the field can afford the width |
| [`PickerField`](./components/PickerField.tsx)   | a long **closed** list picked in a sheet, when it cannot          |

[`SegmentedControl`](./components/SegmentedControl.tsx) is the fifth, and not a picker: it
is for a genuinely small, glanceable, mutually-exclusive choice (`EntityTypeToggle`).

Prefer a native element over novel custom UI for any of these.

## Debugging a native module

### Adding one: regenerate, don't pod-install into a stale project

**Symptom** *(cost 25 minutes, 2026-09-07, adding `expo-sharing` + `expo-file-system`)*: the build
fails to link with dozens of missing **React Native** symbols —
`facebook::react::DebugStringConvertible`, `Sealable`, `ShadowNode::getDebugName`,
`_OBJC_CLASS_$_RCTPackagerConnection` — plus `cannot link directly with 'SwiftUICore'`.

**It is not the module you just added.** Those symbols have nothing to do with it, and reading
the new pod's Swift for SwiftUI imports is a dead end. The cause is `pod install` running into an
`ios/` project generated against an older pod state; with RN's prebuilt artifacts, the result is
an inconsistent debug link.

`ios/` is **gitignored** and CNG-managed — every native fact lives in `app.json` — so throwing it
away costs nothing but build time, and is the first thing to try:

```sh
rm -rf ~/Library/Developer/Xcode/DerivedData/Leapsake-*
CI=1 pnpm --filter @leapsake/mobile exec expo prebuild --clean --platform ios
CI=1 pnpm --filter @leapsake/mobile exec expo run:ios --device <simulator-udid>
```

Two things to expect from that last command in a non-interactive shell. It fails at the *end*
with `osascript … System Events` — that is Expo trying to focus the Simulator window, **after** a
successful build; install and launch by hand instead:

```sh
APP=~/Library/Developer/Xcode/DerivedData/Leapsake-*/Build/Products/Debug-iphonesimulator/Leapsake.app
xcrun simctl install booted "$APP" && xcrun simctl launch booted com.leapsake.app
```

And when checking that a module linked, note that **a pod may link statically** (`libFoo.a`) and
so be absent from `Leapsake.app/Frameworks` — in a debug build its symbols are in
`Leapsake.app/Leapsake.debug.dylib`, not the thin `Leapsake` binary. `nm -gU` the dylib.

### Two traps once it is linked

Two traps that cost a day chasing an `expo-contacts` bug (birthdays never reaching the contact
import). Neither is contacts-specific — both apply to **any** Expo native module.

**The Swift in `node_modules/<module>/ios/` is not what runs.** Several Expo pods ship a
**precompiled `.xcframework`** (look for `ios/artifacts/*.tar.gz` and a `*.xcframework` under
`ios/Pods/<Module>/`); those sources are reference material. Reading them and reasoning about
what "must" happen proves nothing. Inspect the **binary** instead:

```sh
APP=$(xcrun simctl get_app_container booted com.leapsake.app)
nm -a "$APP/Frameworks/ExpoContacts.framework/ExpoContacts" | grep getPaginated
echo '<mangled symbol>' | xcrun swift-demangle
```

A changed signature names the version outright — `getPaginated(… unifyResults: Bool?)` was
56.0.10, `Bool` was 56.0.13. That settled in one command what source-reading could not.

**Bumping the package is not enough.** After `pnpm install` + `pod install`, Xcode unpacked the
new xcframework into `Build/Products/…/XCFrameworkIntermediates` but left a **stale copy inside
`Leapsake.app/Frameworks`**, so the rebuilt app still ran the old code and the upgrade looked
like a no-op. Compare the two with `nm`; if they disagree, delete the copy under
`…/Build/Products/Debug-iphonesimulator/Leapsake.app/Frameworks/<Module>.framework` and rebuild.

The iOS Contacts framework logs every fetch it performs — `keysToFetch` and `unifyResults`
included — which is how the non-unified fetch was first spotted. React Native's `console.log`
does **not** reach `os_log`, but this does:

```sh
xcrun simctl spawn booted log show --last 3m --style compact \
  --predicate 'processImagePath CONTAINS "Leapsake"'
```

### On a physical device

```sh
xcrun devicectl device info details --device <udid> | grep -i developerMode
CI=1 pnpm --filter @leapsake/mobile exec expo run:ios --device <udid>
xcrun devicectl device process launch --device <udid> \
  --payload-url "leapsake://dev-selftest" com.leapsake.app
```

- `devicectl list devices` **caches** `developerModeStatus` and will report `disabled` long after
  it is on. `device info details` queries the device and is the one to trust.
- `CI=1` avoids interactive prompts (team selection resolves itself from the existing
  provisioning profile) but also **skips starting Metro** — have a dev server up, or the Debug
  build installs and then has no bundle to load.
- **There is no `simctl io … screenshot` equivalent for a physical device.** `devicectl device
copy` can pull the app container; otherwise a human has to read the screen. On the simulator,
  screenshots plus querying the app's sqlite directly
  (`$(xcrun simctl get_app_container booted com.leapsake.app data)/Documents/SQLite/…`) make a
  much faster loop — reproduce there first if you can.

## `__DEV__` deep links

```sh
leapsake://dev-selftest       # driver contract + the custody suite, on device
leapsake://dev-clear-dbkey    # simulate keychain loss
```

`dev-clear-dbkey` offers **three scopes**, and the difference matters:

- the **db-key alone** raises the unlock gate;
- **everything** reaches the master-key repair;
- **device identity** keeps the db-key, and so is the one route to the _Degraded_ state.

> Editing a self-test needs a **bundle reload**, not just re-firing the deep link. See
> [`maestro/README.md`](./maestro/README.md), which also covers the automated
> `pnpm test:native` gate.
