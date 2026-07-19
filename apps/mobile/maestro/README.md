# Mobile native test tier — Maestro harness

This directory holds the **blackbox harness** for the mobile driver-contract self-test
(testing backlog **step 3b**; see [`plans/testing/`](../../../plans/testing/)). It drives
the in-app self-test on an emulator/simulator and asserts **PASS** from the command line,
so the mobile driver leg is a *terminal, automated* gate — not a human opening
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
nothing reachable here (no device booted / toolchain absent) — *blocked*, not a failure.

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
