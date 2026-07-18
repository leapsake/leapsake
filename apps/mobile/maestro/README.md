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
  device. Keying on the stable `PASS`/`FAIL`/`ERROR` token (not the human-readable
  `N/N` count) makes it non-vacuous: a broken contract case turns the flow RED.

## Run it

```
pnpm test:native
```

That runs [`scripts/test-native.mjs`](../../../scripts/test-native.mjs), which owns the
environment prep (the flaky part of driving a dev client) and then invokes the flow. It
**assumes a prepared environment** and fails with the exact command to run if a piece is
missing. One-time / per-session setup, Android:

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

## iOS (follow-on, step 9)

The flow is platform-identical — the same deep links and the same `testID`/
`accessibilityLabel` selectors map to iOS `accessibilityIdentifier`/`accessibilityLabel`.
Enabling iOS is mostly a device-target add in `scripts/test-native.mjs` (resolve
`xcrun simctl`, `openurl` the same links against a booted simulator). Not implemented yet.
