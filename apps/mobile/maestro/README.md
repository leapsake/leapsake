# Mobile native test tier — Maestro harness

This directory holds the **blackbox harness** for the mobile driver-contract self-test
(see [`../README.md`](../README.md) → *Why the driver test needs a device*). It drives
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
ios`), clears any SpringBoard/dev-menu overlay, and waits for the People tab. The
  runner invokes it; you don't run it directly. It does **not** touch `driver-selftest.yaml`.
- **`staged-gift-occasions.yaml`** (+ `subflows/`) — a **UI** flow rather than a contract
  one: it drives the add person/pet screen through the five ways a staged gift's occasion
  can resolve (milestone kept/removed, holiday kept/removed, and the milestone case again
  for a pet, where the bearer type takes a different route). It is the regression gate on
  the two pieces of machinery that have no unit-testable seam at the screen level — the
  staged-key → real-id remap and the prune-on-removal — and it is **verified non-vacuous by
  sabotage**: breaking the remap turns case 1 red, breaking the prune turns case 2 red on
  its pre-save assertion and case 4 red on its saved one. The flow's own header comment
  records which line each regression lands on.

  Not wired into `pnpm test:native`, which is built around one flow and a PASS token. Run
  it directly against a **freshly loaded** app (see *Running the flow directly* below):

  ```
  maestro --udid <sim> test staged-gift-occasions.yaml
  ```

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
    failure surfaces several steps later somewhere unrelated. Dismiss and *assert* the
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
2. **A booted Android emulator:**
   ```
   emulator -list-avds
   emulator -avd <name>
   ```
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

The self-test flow (`driver-selftest.yaml`) runs unchanged on iOS. The only iOS-specific
piece is the **prepare** step: the Android bundle-load deep link does not work on iOS (a
SpringBoard confirm intercepts it), so the runner drives `ios-prepare.yaml` to reconnect
through the dev-launcher instead. Per-session iOS setup:

1. **Maestro CLI** — same one-time install as Android (above).
2. **A booted iOS simulator** — e.g. from Xcode, or:
   ```
   xcrun simctl list devices available
   xcrun simctl boot <udid> && open -a Simulator
   ```
3. **The dev-client build installed + Metro running + a "last dev server" set.** The one
   command that does all three:
   ```
   pnpm --filter @leapsake/mobile ios   # builds, installs, launches, starts Metro
   ```
   This must have connected the dev client to Metro at least once — the iOS prepare's
   "Continue"/`launchApp` reconnect relies on that remembered server (the symmetric
   counterpart to Android's `adb`-loaded bundle). The self-test screen is `__DEV__`-only,
   so this must be a dev-client build. If you add/remove a native module, rebuild with the
   same command (a stale build missing a new native module redboxes on launch).

`scripts/test-native.mjs` then runs `ios-prepare.yaml` (which `launchApp`s, clears any
dev-launcher/SpringBoard/dev-menu overlay, and waits for the People tab), runs the
self-test flow with `maestro --udid <sim>`, and propagates its exit code — the same shape
as Android.

### When the prepare step can't find the dev server

`ios-prepare.yaml` reconnects through the dev-launcher's _remembered_ server. That memory
is not always there — a simulator that has been shut down, or a dev client that was
terminated while on the launcher screen, can come back to **"No development servers
found"**, at which point `pnpm test:native` fails with "the app's home screen never
appeared" no matter how many times you re-run it. Reconnect explicitly, by URL:

```
xcrun simctl openurl <udid> "exp+leapsake://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

Then run the flow directly (`maestro --udid <udid> test driver-selftest.yaml`) rather than
through `pnpm test:native`, whose prepare step `launchApp`s cold and can land back on the
launcher.

### Editing a test? The deep link does not reload the bundle

`leapsake://dev-selftest` re-opens the route against the **already-loaded** bundle, so a
source edit does not take effect and the screen re-runs the _old_ suite — which looks
exactly like a passing run of the new one. Force a fresh bundle between edits:

```
xcrun simctl terminate <udid> com.leapsake.app
xcrun simctl openurl <udid> "exp+leapsake://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

This bites hardest when deliberately breaking a case to confirm it goes RED: without the
reload the sabotage appears to pass, and a genuinely vacuous suite would read as verified.

## Driving forms and fields — the traps, in the order you'll hit them

These cost several sessions to find. All of them look like "the app is broken" and are not.

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

### One flow still can't be driven

The **last-device Forget-account confirmation**: the keyboard covers "Delete all data", and
dismissing it first does not help because the layout reflows as the keyboard goes and the tap
lands on whatever moved under it (the tab bar, in practice). The screen wants a
`KeyboardAvoidingView`; fix that before trying to make this cycle an E2E flow. There is no
harness-side workaround worth having.
