# Faster CI without losing confidence: E2E drives a release build

The repo moved the proof E2E was carrying for lower tiers down into hook and integration tests;
what is left is making the E2E arc drive the artifact `rc` actually uploads. "Crucial" is
defined by an **admission rule**, written once in
[`apps/mobile/maestro/e2e/README.md`](../../apps/mobile/maestro/e2e/README.md) → _What earns a flow here_; read
it before any step below.

**Before starting, read [`README.md`](./README.md) → _Where 3 and 4 pull on each other_**:
these steps make `remote-releases.md`'s gate cheaper, and have ordering constraints against it.

## Where things stand

**The arc** is 01 → smoke → 04, with both doors as 04's closing acts: about 9 minutes on iOS.
`scripts/test-e2e.mjs` runs the whole arc at **every** rung; the rung table in
`CONTRIBUTING.md` grades which flows must be green, not which run.

**A fidelity gap the docs overstate.** `CONTRIBUTING.md` says E2E drives "the production app
binary on that OS image". It drives the dev client loading a dev-mode bundle from Metro
(`scripts/lib/mobile-harness.mjs` requires Metro and says so). That is not the artifact `rc`
uploads, and closing that gap is step 4.

**Already built for it:** the `EXPO_PUBLIC_E2E` flag and the release preflight that refuses a
store bundle with test-only code ([`apps/mobile/README.md`](../../apps/mobile/README.md) →
_Test-only deep links_), and a `console.error` failing a flow
([`apps/mobile/maestro/README.md`](../../apps/mobile/maestro/README.md) → _A logged error
fails the flow_).

## Steps, each a commit

**Order: 4c → 4d → 4e, then 8 when desktop ships.**

- **4c waits on `remote-releases.md` step 6 closing** ([`README.md`](./README.md) → _Where 3
  and 4 pull on each other_): the switch invalidates that step's numbers.
- Ideally 4c–4e land before `remote-releases.md` step 7 wires the gate into `ci.yml`: every
  push pays for whatever the gate costs from then on.

**Open decision:** whether to lower the KDF cost in E2E too. That needs a distinct `KDF_ALG`
recorded in the account row so a cheap-recipe door can never be mistaken for a real one, and it
changes what the door files say. Worth minutes per arc.

### 4. E2E drives a release-configuration build

**Decided:** E2E drives a **release-configuration build**, not the dev client. **iOS first,
then Android, and Android is part of this step, not a follow-up.** **No build-time budget:**
fidelity outranks run time; if the gate gets slow, pull other levers (the KDF question above,
caching, fewer flows) rather than go back to the dev client.

**Why.** The gate exists to protect data at `rc`, and release-only failures (Hermes bytecode,
minification, code behind `__DEV__`) are invisible to a dev bundle. The dev client is also a
source of flake: `remote-releases.md` step 6 measured three stoppers that came only from it (the
dev-menu onboarding sheet, the launcher entry vanishing mid-tap, Metro bundle waits). About a
third of `scripts/lib/mobile-harness.mjs` exists only to drive the dev client, and this step
deletes it.

**The split, by activity:** the harness (`pnpm test:e2e`, `pnpm test:native`) always drives the
release build. Driving the app by hand and scratch flows keep the dev client and Metro, where
quick JS reloads actually help (`apps/mobile/maestro/README.md` → _Driving the app by hand_).

**Two decisions this step rests on:**

1. **On iOS, key loss comes from outside the app; `dev-clear-dbkey` is never in an iOS build.**
   `xcrun simctl keychain <udid> reset`, reached from a flow as Maestro's `clearKeychain` step,
   replaces it. That loses the **whole** keychain (db-key, recovery key, device id, enclave),
   which is what a new phone or the transfer to the company account actually costs someone, so
   it also exercises the device-identity repair no flow reaches today. **Android keeps the route
   behind the flag**, because nothing outside an Android app can delete its keystore entries on
   a non-debuggable build. There, the flows tap **Clear everything**, not **Clear db-key**, so
   both platforms rehearse the same disaster.
2. **Android E2E uses a new `e2e` build type, signed with the debug key.** It matches `release`
   in everything that changes behaviour (minified, Hermes, JS bundled in, no dev tools) and
   differs only in its signature. The upload key stays off CI runners. Play rejects a
   debug-signed build, so an `e2e` build cannot be uploaded by accident, and
   `plugins/with-android-release-signing.js`'s rule that `release` never falls back to the debug
   key stays as it is. Keep the same `applicationId`, so the Maestro `appId` and the harness
   paths do not fork.

**Key loss happens mid-flow, with no shell.** The door acts need the key lost partway through
one `maestro test` process, because the captured phrase cannot leave it. A new
`subflows/lose-keys.yaml` branches with `when: platform:`:

- **iOS:** `stopApp` → `clearKeychain` → `launchApp`. Stop first, so the next launch reads an
  empty keychain rather than a key still held in memory.
- **Android:** open `leapsake://dev-clear-dbkey` → **Clear everything** → relaunch.

It replaces the key-loss lines at the top of `subflows/unlock-after-key-loss.yaml`; Flow 4
itself does not change. Once a door act loses **everything**, Flow 4's phrase act no longer
reaches the reseal (no recovery key survives to reseal under), so that rule rests on
`apps/mobile/lib/open-active-store.test.ts` alone, which covers both key-loss shapes. For any
future host-side need, check Maestro's built-in host steps first (`clearKeychain`,
`clearState`, `addMedia`, permissions, location) before adding a server to the harness.

**It will not fix dropped input by itself.** React Native does a JS round trip per keystroke,
so a busy JS thread still loses characters; the flows keep their read-back retries
(`maestro/subflows/type-checked.yaml`). **Pasting and seeding fixtures through a dev route were
both checked and rejected**: Maestro 2.8.0's `pasteText` only pastes what `copyTextFrom` took
off the screen, and the arc already shares state, so the typing left is what each flow proves.

**Commits:**

- **4c. iOS switches.** The harness builds a Release-configuration simulator app with the flag
  and drops Metro, the launcher and dev-menu handling on the iOS path (`ios-prepare.yaml` should
  shrink to a readiness wait, or go). Key loss goes through `lose-keys.yaml`. Verify the app
  sees a keychain reset made mid-session without the simulator rebooting, and that `launchApp`
  behaves (`ios-prepare.yaml`'s warning against it is about the dev client discarding Metro's
  bundle). Arc green, and **record the build time and the arc time in the commit message**, as
  numbers, not as a gate.
- **4d. The Android `e2e` build type**, the Android half of `lose-keys.yaml`, and the Android
  path switched. The harness's `run-as` step for dev-menu prefs goes: `run-as` needs a
  debuggable build, and there is no dev menu left to settle.
- **4e. Delete what is left of dev-client handling in `mobile-harness.mjs`**, and correct the
  docs: `CONTRIBUTING.md` → _The E2E release gate_ (its "production app binary" sentence becomes
  true), `apps/mobile/maestro/README.md` (_Run it_ and the dev-client traps), and
  `apps/mobile/README.md` where it says the self-test needs a dev-client build.

### 8. Desktop, when it ships

Not now. When `desktop-packaging.md` lands, the desktop E2E harness is Playwright over the
packaged app, running the same catalog (the catalog is tool-agnostic on purpose), keyed
`mac` in the tier registry, and gated by [`remote-releases.md`](./remote-releases.md)'s
per-cell readiness. Before that, the cheapest confidence for desktop is the same move as
mobile: the router's inline loaders and actions become named functions that call `CoreApi`, and
get integration tests beside the existing ones.

## Not worth doing

Sharding Vitest, reordering static tiers, or moving the Astro site build out of the run. The
inner loop is already well under a minute.
