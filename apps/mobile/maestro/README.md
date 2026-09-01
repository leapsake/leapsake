# Mobile native test tier — Maestro harness

This directory holds the **blackbox harness** for the mobile driver-contract self-test
(see [`../README.md`](../README.md) → _Why the driver test needs a device_). It drives
the in-app self-test on an emulator/simulator and asserts **PASS** from the command line,
so the mobile driver leg is a _terminal, automated_ gate — not a human opening
`leapsake://dev-selftest` and reading the screen (principle #1: automate over manual).

- **`driver-selftest.yaml`** — the Maestro flow: deep-link to the self-test route, wait
  for the async contract run to finish, assert the `driver-selftest-status` element's
  accessibility label is `PASS`. Vendor-neutral: plain open-source Maestro YAML, no
  mobile.dev cloud coupling — it runs on the local `maestro` CLI against any booted
  device, **byte-identical on Android and iOS** (its `id`/`text` selectors map to
  Android resource-id/content-desc and iOS accessibilityIdentifier/accessibilityLabel).
  Keying on the stable `PASS`/`FAIL`/`ERROR` token (not the human-readable `N/N` count)
  makes it non-vacuous: a broken contract case turns the flow RED.
- **`ios-prepare.yaml`** — an **iOS-only** helper flow that gets the dev client from a
  cold launch to the app's home screen (the bundle-load "prepare" step). Android loads
  the bundle with an `adb` deep link; on iOS that deep link is intercepted by a
  SpringBoard "Open in Leapsake?" confirm and ignored, so this flow instead reconnects
  through the dev-launcher's last dev server (set by `pnpm --filter @leapsake/mobile
ios`), clears any SpringBoard/dev-menu overlay, and waits for the Search tab. The
  runner invokes it; you don't run it directly. It does **not** touch `driver-selftest.yaml`.
- **`global-nav.yaml`** — the navigation shell: that the bar holds Home, Search, New
  and Settings/Account; that **New opens the chooser without navigating** (the property
  the "never selected" rule is really about); that a browse tile opens its catalog with
  the bar still under it and no back control; that New on a _filtered_ Search skips the
  chooser and lands in the form; and that a back control is absent inside the tab
  navigator and present one screen up. All of those are claims no lower tier can check —
  `lib/new-action.ts` is unit-tested, but nothing below E2E proves its table is wired to
  a tab press.

  It deliberately does **not** assert the selected-tab tint: that is a colour, and Maestro
  reads the accessibility tree rather than pixels. Verify by sabotage against case 2 —
  drop the `preventDefault` in `app/(tabs)/_layout.tsx` and the flow goes red.

  Taps use the tab buttons' `testID`s (`tab-home`, `tab-search`, `tab-new`, `tab-account`)
  rather than their labels. Text selectors are full-match, so a tab label match has to be
  a loose `.*New.*` — which would just as happily hit a reminder titled "New camera" on the
  list behind the bar.

  Creates nothing, so it needs no per-run tag and can be re-run indefinitely. Not wired
  into `pnpm test:native`, which is built around one flow and a PASS token:

  ```
  maestro --udid <sim> test global-nav.yaml
  ```

- **`staged-gifts.yaml`** — a **UI** flow rather than a contract one: it drives the create
  form through adding a gift as an open row, saving, reading it back on the person's page
  as not-given, then ticking it off on the row itself and reading it back as given. It is
  the regression gate on the two screen-level seams a gift has — that "Add gift" appends a
  row the form's own Save writes, and that the row's own ✓/○ applies where it stands — and
  it is **verified non-vacuous by sabotage**: making `applyEntityForm` skip `value.gifts`
  turns case 2 red, making `GiftsSection`'s `setGiven` a no-op turns case 3 red.

  It used to reopen the whole record's edit form to reach the tick. That form is gone —
  each part of a saved person is now its own small screen, and a gift's tick is not a draft
  at all — so the second half of the flow acts on the detail page directly.

  Not wired into `pnpm test:native`, which is built around one flow and a PASS token. Run
  it directly against a **freshly loaded** app (see _Running the flow directly_ below):

  ```
  maestro --udid <sim> test staged-gifts.yaml
  ```

  ⚠️ **Not yet run on a simulator** — written 2026-08-20 alongside the gift-scope cut and
  revised 2026-08-22 for the per-item edit screens; reviewed against the source both times,
  never executed. It replaces `staged-gift-occasions.yaml` (+
  `subflows/stage-gift-for-occasion.yaml`), which was green on both platforms and drove the
  occasion picker through the five ways a staged occasion could resolve. Occasions left
  v0.1 scope; that flow and its platform-branching `SelectField` subflow went with them, and
  with it the only place a flow here had to branch per platform at all.

  The dev-menu floating button has to be off or this flow cannot pass — see the trap below.

  It needs a clean start because `openLink` to a route **already in the stack reuses that
  screen rather than remounting it** — so a previous failed run's half-filled form is still
  there, and the next run stacks its milestones on top of it. Between its own five cases
  this is a non-issue: each ends in a save, and the add screen `replace`s itself.

  Two traps it encodes, both of which cost a session each and neither of which looks like
  a harness problem when you hit it — see `subflows/dismiss-keyboard.yaml` for the long
  version:
  - **Maestro does not model the keyboard as occluding anything.** An element behind it
    still reads as visible, so `scrollUntilVisible` stops as soon as it has scrolled that
    far and the next tap lands on a key. The step "COMPLETED", nothing happened, and the
    failure surfaces several steps later somewhere unrelated. Dismiss and _assert_ the
    dismissal before reaching for anything low on the screen.
  - **Fixed record names make a data-creating flow degrade with every run.** Run N leaves
    the Nth copy of each name, and the post-save duplicate detector then has to score and
    render every one of them — the review screen grows a row per previous run until the
    flow times out. Stamp created records with a per-run tag instead.

## Run it

```
pnpm test:native                    # every booted platform (Android + iOS)
pnpm test:native --platform=ios     # just one
pnpm test:native --platform=android
```

That runs [`scripts/test-native.mjs`](../../../scripts/test-native.mjs), which owns the
environment prep (the flaky part of driving a dev client) and then invokes the flow. With
no flag it attempts **both** platforms and reports each one's status; a platform whose
device isn't booted (or whose toolchain is absent) prints as **BLOCKED**, never silently
skipped. It **assumes a prepared environment** and fails with the exact command to run if
a piece is missing. Exit codes: `0` = at least one platform passed and none failed; `1` =
a booted device went RED or its env is broken (Metro down / app not installed); `3` =
nothing reachable here (no device booted / toolchain absent) — _blocked_, not a failure.

One-time / per-session setup, Android:

1. **Maestro CLI** (once):
   ```
   curl -Ls "https://get.maestro.mobile.dev" | bash
   ```
   Then restart your shell (or ensure `~/.maestro/bin` is on `PATH`).
2. **A booted Android emulator**, with cores *and memory* — see
   [Budget the waits for the emulator](#budget-the-waits-for-the-emulator-not-for-the-simulator)
   for why the default AVD is not enough:
   ```
   emulator -list-avds
   emulator -avd <name> -cores 6 -memory 8192
   ```
   Boot **one** device per platform. With two emulators up (or a phone plugged in) the
   harness refuses rather than guessing which to drive, and tells you how to pick:
   `--device=<serial|udid|name>`, or `LEAPSAKE_E2E_DEVICE`. Under `--provision` it shuts
   the extras down instead, since nobody is watching.
3. **The dev-client build installed + Metro running.** The simplest way to get both is:
   ```
   pnpm --filter @leapsake/mobile android   # builds, installs, and starts Metro
   ```
   (or `pnpm --filter @leapsake/mobile dev` to start Metro against an already-installed
   build). The self-test screen is `__DEV__`-only, so this must be a **dev-client** build
   (Expo dev-client + Metro), not a release binary. If you add or remove a native module,
   rebuild with `pnpm --filter @leapsake/mobile android`.

`scripts/test-native.mjs` then sets `adb reverse tcp:8081`, loads the JS bundle into the
dev client (a cold dev-client launch shows the expo-dev-launcher, not the app — the
script deep-links past it deterministically over adb), waits for the app's home screen,
runs the flow, and propagates Maestro's exit code.

### Running the flow directly

`maestro test driver-selftest.yaml` works too, but the flow deliberately does **not**
`launchApp` (a cold dev-client launch lands on the launcher, and the self-test route only
exists once JS is loaded). So first open the app to its home screen against a running
Metro, then run the flow. `pnpm test:native` does this for you.

## iOS (step 9 — done)

The self-test flow (`driver-selftest.yaml`) runs unchanged on iOS. The **prepare** step is
now the same shape as Android's — the harness opens the bundle-load deep link
(`leapsake://expo-development-client/?url=http://localhost:8081`) with `xcrun simctl
openurl` — and `ios-prepare.yaml` only settles overlays and waits for home afterwards.
Per-session iOS setup:

1. **Maestro CLI** — same one-time install as Android (above).
2. **A booted iOS simulator** — e.g. from Xcode, or:
   ```
   xcrun simctl list devices available
   xcrun simctl boot <udid> && open -a Simulator
   ```
3. **The dev-client build installed + Metro running.** The one command that does both:
   ```
   pnpm --filter @leapsake/mobile ios   # builds, installs, launches, starts Metro
   ```
   The self-test screen is `__DEV__`-only, so this must be a dev-client build. If you
   add/remove a native module, rebuild with the same command (a stale build missing a new
   native module redboxes on launch).

`scripts/test-native.mjs` then opens the deep link, runs `ios-prepare.yaml` (which clears
any SpringBoard/dev-menu overlay and waits for the Search tab), runs the self-test flow
with `maestro --udid <sim>`, and propagates its exit code — the same shape as Android.

### The prepare no longer depends on a remembered dev server — keep it that way

It used to. `ios-prepare.yaml` tapped the dev-launcher's **"Continue"**, which reopens the
last dev server *by the absolute URL it was loaded from* — `http://192.168.1.16:8081`, the
Mac's LAN address at the time. Change networks, or just get a new DHCP lease, and that
address answers nothing: the dev client shows the launcher, "Continue" is not on the screen
at all, and prepare burns its whole budget before reporting "the app's home screen never
appeared". Nothing in that failure mentions the machine's IP, and re-running never helps.
It cost a session on 2026-08-31, with `.16` and `.42` remembered and the host on `.9`.

The deep link names `localhost`, which the simulator resolves to the host, so it is the
same address on every machine and every network. (The deep link *was* rejected on iOS when
this tier was written — a SpringBoard confirm, and the launcher ignoring the `?url=` behind
it, verified 2026-07-18. Re-verified 2026-08-31 on the same simulator: it now launches the
app straight onto home, no confirm.) To do it by hand:

```
xcrun simctl openurl <udid> "leapsake://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

**Do not put `launchApp` back into `ios-prepare.yaml`.** Maestro force-stops the app as
part of launching it, which throws away the bundle the deep link just loaded and drops the
simulator back on the launcher — the state the flow cannot get out of on its own.

### Editing a test? The deep link does not reload the bundle

`leapsake://dev-selftest` re-opens the route against the **already-loaded** bundle, so a
source edit does not take effect and the screen re-runs the _old_ suite — which looks
exactly like a passing run of the new one. Force a fresh bundle between edits:

```
xcrun simctl terminate <udid> com.leapsake.app
xcrun simctl openurl <udid> "leapsake://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

This bites hardest when deliberately breaking a case to confirm it goes RED: without the
reload the sabotage appears to pass, and a genuinely vacuous suite would read as verified.

## `e2e/` — the crucial-flow catalog

`e2e/` holds the [crucial-flow catalog](../../../plans/testing/crucial-flows.md) — the tier
that proves a real user can complete the journeys, as opposed to `driver-selftest.yaml`
which proves the driver contract. It is run by `pnpm test:e2e`
(`scripts/test-e2e.mjs`), a sibling of `pnpm test:native`; both sit on the shared harness
in `scripts/lib/mobile-harness.mjs`, which owns device detection, provisioning, the
dev-client install, Metro, and the per-platform bundle-load prepare.

**These flows are an ordered arc, not a set.** `01` resets the app and asserts a first run,
`02` fills it with Ada Lovelace and Augustus De Morgan, `03` writes a milestone onto Ada.
They share app state on purpose (the catalog takes 1→4 as one arc), so the runner stops a
platform at the first red flow rather than reporting three failures that are really one.
**A consequence worth knowing before you debug one:** a flow run *standalone* after a failed
run may not start, because the app is wherever the last failure left it — a modal still
open, a form still half-filled. `01`'s relaunch is what clears that, so re-run the arc
rather than the flow.

What is here covers the **`beta` rung** — Flows 1-5, on-screen assertions only. The
out-of-band custody assertions and Flows 7b/7c belong to `rc`; see
[`plans/v0-1_06_e2e-and-release-gate.md`](../../../plans/v0-1_06_e2e-and-release-gate.md)
→ §C's rung table. All five are written, and the `e2e` tier in `scripts/test-all.mjs` is
`ready` — it went `ready` only once the *whole* beta bar was there, because a partial
catalog that ran and went green would read as the gate being met.

### What the app's own state looks like from here

- **Every run starts from a wiped app, and the harness is what guarantees it.** Before the
  first flow, `mobile-harness.mjs` → `wipe` clears the app's data from *outside*: `adb
  shell pm clear` on Android, and on iOS a delete of `Documents/SQLite` (stores, doors,
  roster) plus `simctl keychain reset` (expo-secure-store's secrets). That is what makes a
  run's verdict independent of the run before it — the arc ends on Flow 4 with an account
  and keys, and a wedged app cannot be driven to its own reset screen at all.
- **The blunt tools are still the wrong ones**, which is why the iOS wipe is assembled by
  hand: `clearState` and `simctl uninstall` take the whole data container, including
  `Library/Preferences` — the dev-menu preferences the runner just settled and the
  dev-launcher's own state. The wipe above touches neither.
- **`subflows/factory-reset.yaml` stays, and is not redundant.** The harness wipe is the
  *precondition*; the subflow is the *coverage* — the only thing in the suite that drives
  the erase a user would perform, on a store whose contents are known. It also means the
  reset always takes its "Factory reset" branch rather than "Forget account", because the
  device now always arrives unauthenticated.
- **A factory reset is not a first run, and its aftermath is racy.** The reminders engine
  reconciles asynchronously and the in-place provider rebuild does not wait for it: reset
  twice and Home comes back once empty and once already showing the `add-first-person`
  nudge. The subflow relaunches and *waits* for the nudge, which is deterministic. Assert
  nothing about the screen between the erase and the relaunch.
- **Assert specific expected text, never emptiness or counts.** Home is time-dependent —
  the reminders and holidays engines mint `system` rows by date — and it is *not* empty on
  a first run: the `add-first-person` nudge is there, and it is the better assertion
  because it also proves the engine ran.

### Three selector traps this tier added to the list below

- **A list row's accessibility text carries a trailing space.** The hierarchy reads
  `"Ada Lovelace "`, and Maestro matches in full, so `assertVisible: "Ada Lovelace"` fails
  against a row that is plainly on screen while the same string passes on the detail page,
  where it is the screen title. Wrap anything selected out of a list: `.*Ada Lovelace.*`.
- **A filter box makes its own text a decoy.** Type "Friend" into a picker's filter and the
  *input* now matches `tapOn: "Friend"` as well as the option row does — Maestro takes the
  input, iOS raises its Paste/Select callout, and the modal stays open. The failure then
  lands two steps later on a field that is behind the modal. Constrain the row with
  `below: {id: <the filter's id>}`.
- **On Android the keyboard is a *second* decoy for the same word, and `below:` does not
  escape it.** Gboard's suggestion strip offers the word you just typed, and the strip sits
  below the filter — so it satisfies the very constraint that separates the row from the
  box. Maestro picked the suggestion (`resource-id=com.google.android.inputmethod.latin:…`,
  `accessibilityText=Friend`), tapped it, reported **COMPLETED**, and selected nothing; the
  sheet stayed open and Flow 2 failed two steps on. It reads as a slow list, because the
  identical two commands pass by hand a minute later — the strip has stopped offering the
  word by then. `maestro.log` is what identifies it: the `Tapping on element:` line names
  the keyboard package outright.

  There is no selector-shaped fix — anything matching the label matches all three. **Give
  the rows ids.** `PickerField` now does (`<field testID>-option-<key>`, e.g.
  `relationship-other-role-option-friend`), which is the same answer as the secure fields
  below, for the same reason.

### Budget the waits for the emulator, not for the simulator

The flows are byte-identical across platforms; their **timeouts** still have to suit the
slowest device the suite runs on, and that is the Android emulator. Flow 4's wait on the
account conversion was 60s and green on the iOS simulator four runs running; on Android the
button was still reading "Encrypting your data…" when Maestro gave up, and the reveal
appeared shortly after. Argon2id is deliberately slow and an emulator is the slowest place
we run it.

A generous budget is the cheap mistake here. Too long costs a couple of extra minutes on a
build that is genuinely broken; too short turns the gate red on a build that works, which is
the failure that gets a gate ignored.

**But fix the emulator before you touch a timeout.** Android Studio creates AVDs with as
little as **one CPU core and 2GB of RAM**, and a React Native dev client on one of those is
not merely slow — it is a different machine. Both halves of that were measured on this
repo's own `Medium_Phone_API_36.0`, one commit, one emulator image, 2026-08-31:

- **Cores.** With `hw.cpu.ncore=1`, a factory reset's relaunch needed over 90s to reach the
  tab bar — 13-second GC pauses in the logcat — and Flow 1 went red on a 60s wait. Booted
  with `-cores 6`, the same commit reached the app home in **7s**.
- **Memory, which was much harder to see.** At `-memory 4096` the guest sat at ~3.7GB of
  4GB with ~800MB in swap, and Flow 4's account conversion went **bimodal**: ~50s when it
  fit in RAM, **four to seven minutes when it did not**, red about half the time on a build
  that was working. Argon2id is *memory-hard* by design — a 19MiB buffer touched at random —
  so it is the worst thing in the suite to page out. `adb shell cat /proc/vmstat` is what
  identifies it: `pswpout` had passed 1.4M pages (~5.6GB) on an emulator up for an hour. At
  `-memory 8192` the suite passed three runs running, conversion back at ~50-80s.

`--provision` now boots with `-cores 6 -memory 8192` (`EMULATOR_SIZE` in the harness), and
the Android prepare warns when it lands on a device with fewer than four cores — an
emulator someone else started, from Android Studio or `expo run:android`, still gets
whatever its AVD config says. Boot it yourself with:

```
emulator -avd <name> -cores 6 -memory 8192
```

or raise both in Android Studio → Device Manager → Edit. A suite tuned to pass on a starved
emulator is one that can no longer tell slow from broken, which is why the knob to reach for
is the device.

### Do not leave both devices booted at once

The two platforms run in sequence; their **hardware** did not, until 2026-08-31. An Android
emulator and an iOS simulator booted together are two VMs on the same cores and the same
RAM, which is the pressure the section above shows Flow 4 cannot absorb.

This is the smaller half of that story — the emulator's own memory mattered more — but it
compounds, and it crosses platforms in a way that is very hard to read from a log: an
Android phase cut off mid-conversion leaves the app burning a core, and the **iOS** phase
after it then fails on a Maestro `testmanagerd` snapshot timeout that has nothing to do
with iOS. That happened, and it is why the harness now stops the app on the way out of a
platform however it ended.

`--provision` also shuts each platform's device down as soon as its flows are done —
**every platform, including the last**, so a provisioned run is boot → run → shut down and
inherits nothing from the run before it. Running the suite by hand, the devices are yours,
so it only warns: **run one platform at a time**, with only that platform's device booted.

```
pnpm test:e2e --platform=android    # with the simulator shut down
pnpm test:e2e --platform=ios        # with the emulator shut down
```

### Screens that are pushed *over* the tab navigator

`app/data.tsx`, `app/settings.tsx` and `app/people/[id]/` are root-level routes: they are
pushed over the tabs and have a Back control instead of a tab bar, so **`tapOn: {id:
tab-home}` fails from any of them**. Hop back with `openLink: "leapsake://"` first. The
fourth tab is also a *menu* (`app/(tabs)/menu.tsx`) rather than the account screen — its
rows read "<glyph> <label>", so reaching the account screen is `tab-account` then
`.*Account.*`.

## Driving forms and fields — the traps, in the order you'll hit them

These cost several sessions to find. All of them look like "the app is broken" and are not.

### The dev client's floating menu button swallows taps — on **both** platforms

It is an **overlay**, so a `tapOn` underneath it reports **COMPLETED** while the dev menu
opens instead, and the flow then fails somewhere unrelated, one or more steps later. This
is the single most expensive trap in this directory: it cost two flows their whole run and
looks nothing like its cause in either case.

- **Android**, `global-nav.yaml`: case 3's `tapOn: search-here-people` hit the bubble, and
  the run went red two lines on at `search-filter-chip is visible`.
- **iOS**, the retired `staged-gift-occasions.yaml`: the button's _stored position_ sat over
  the add screen's holiday row, so `stage-christmas`'s tap on the holiday field hit it and
  the flow died three cases in. Hiding it took that flow from red to **green on all five
  cases** with no edit to the flow itself.

`pnpm test:native` now settles this on both platforms before loading the bundle — see
`settleDevMenu()` / `settleDevMenuIos()` in
[`scripts/test-native.mjs`](../../../scripts/test-native.mjs). Android writes the three
prefs a **fresh install** gets wrong (`showFab`, `isOnboardingFinished`, `showsAtLaunch`)
over `adb run-as`; iOS writes `EXDevMenuShowFloatingActionButton` over `simctl spawn
defaults`.

**On iOS the build itself now carries the setting** — `ios.infoPlist` in `app.json` — so a
fresh install has the button off before anything runs, including a flow run directly. That is
a _registered default_, though: an **explicit** `UserDefaults` value wins over it, so a
simulator where the button was ever toggled by hand keeps whatever it was toggled to. Clear it
once and the build's default takes over:

```sh
xcrun simctl terminate <udid> com.leapsake.app
xcrun simctl spawn <udid> defaults delete com.leapsake.app \
  EXDevMenuShowFloatingActionButton
```

**Android has no build-level equivalent** — the pref is only ever read from
SharedPreferences — so `pnpm test:native` is the only thing that sets it, and **running a
flow directly bypasses that**. Once per install: dev menu (`Ctrl+m`) → **Tools button** → off.

Two more first-run overlays in the same family, both Android:

- the **dev-menu onboarding panel** ("This is the developer menu"), which covers the app on
  the first launch after an install until it is dismissed — handled by
  `isOnboardingFinished` above;
- the system's **stylus handwriting** dialog ("Try out your stylus"), which opens over the
  app the first time a text field takes focus. It made `add-person.yaml` fail on
  `person-last-name` with _element not found_ — the id really was absent, because the whole
  app was behind a system dialog. Disable it per emulator:
  ```sh
  adb shell settings put secure stylus_handwriting_enabled 0
  ```

### A secure field needs a `testID`, not a better tap

Two `secureTextEntry` fields on one screen (password + confirm password) carry **identical,
empty accessibility text**, so a driver has nothing to tell them apart by. Tapping the second
one by text or by point reports **COMPLETED** and types into nothing — the form then fails its
own "passwords don't match" check, or the submit button stays disabled, and it reads as a
platform limitation on secure input. It isn't: it is a selector problem.

The account form carries ids for exactly this reason (`app/settings.tsx`):
`account-username`, `account-password`, `account-confirm-password`, `account-submit`. Target
those and the form fills first try. **Add ids to any other form you need to drive** — that is
the anchor set `plans/v0-1_06_e2e-and-release-gate.md` plans, grown one flow at a time.

### iOS does not draw the dots in a `newPassword` field under automation

A field with `textContentType="newPassword"` holds the value you typed but renders **empty**
in a screenshot. Judge by a side effect instead — the password-strength hint below the field,
or the submit button enabling — never by looking for dots. Its sibling trap:

### Turn off AutoFill Passwords in the simulator

With **Settings → AutoFill & Passwords** on, iOS's "Automatic Strong Password" cover view
swallows keystrokes into `textContentType="newPassword"` fields entirely. Turn it off once per
simulator (done on this machine's iPhone 16 Pro).

### Selector and keyboard miscellany

- Maestro text selectors are **full-match**: the tab bar wants `.*Settings.*`, not `Settings`.
- `hideKeyboard` fails on secure fields. Use `pressKey: Enter`, or tap a static label.
- With two account forms on screen, every duplicated label ("Username", "Password") needs an
  explicit `index` — or, better, an id.

### The Forget-account confirmation *is* drivable now

This section used to say the **last-device Forget-account confirmation** could not be driven —
the keyboard covers "Delete all data", and dismissing it was thought not to help because the
layout reflows as the keyboard goes and the tap lands on whatever moved under it. Retried while
building the E2E arc *(2026-08-28)* and it works, with the same two things the Factory-reset
confirmation needs: an `id` on the confirm field, and `dismiss-keyboard.yaml` anchored on a
plain `Text` *above* the reflow — the section title, not the button.
`subflows/factory-reset.yaml` drives it, which is what makes the arc re-runnable: Flow 4
leaves an account behind, and this is the only in-app way back.

The screen would still be better with a `KeyboardAvoidingView`; that is now a UX preference
rather than a harness blocker.
