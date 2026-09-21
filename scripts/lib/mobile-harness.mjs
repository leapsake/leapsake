// The shared mobile test harness: everything both mobile tiers need to get a Maestro
// flow in front of a booted device, and nothing about what the flow asserts.
//
// Two tiers sit on this, and the split between them is the same one
// `apps/mobile/maestro/README.md` draws for a single flow:
//
//   - **`scripts/test-native.mjs`** — the driver-contract self-test (one flow, one PASS
//     token).
//   - **`scripts/test-e2e.mjs`** — the crucial-flow catalog (an ordered arc of flows that
//     share state).
//
// This file owns *environment prep* — the flaky, imperative part of driving a dev client —
// and the *platform plumbing*. The Maestro YAML owns the *assertion*, the portable half.
// It was extracted from `test-native.mjs` when the E2E tier arrived;
// everything here was proven by that tier first, and the comments are its findings.
//
// The file is:
//   - a platform-agnostic CORE — resolve `maestro`, the shared Metro `/status` check,
//     `maestro --udid <device> test <flow>`, and provisioning;
//   - two DRIVERS — `android` (adb) and `ios` (xcrun simctl) — each detecting its booted
//     device, checking the dev-client is installed, wiping the app back to a first run, and
//     loading the bundle with the same `localhost` deep link (over `adb` / `simctl
//     openurl`), which iOS follows with a small Maestro flow to settle overlays;
//   - a SUITE runner + CLI (`runSuite`) that both tiers hand a flow list to.
//
// By default it ASSUMES a prepared environment per platform — a booted device, the
// installed dev-client build, and a running Metro dev server — and fails with the exact
// command to run for whichever prerequisite is missing. That is the right answer for the
// inner loop, where the developer already has all three and a "here is the command"
// failure beats a ten-minute native rebuild they did not ask for.
//
// `--provision` inverts it: instead of printing the command, run it. Boot an emulator or
// simulator, build + install the dev client, start Metro — so `pnpm release` is one
// command on a machine (or a CI runner) that has nothing prepared.
//
// Platforms: with no flag, BOTH platforms are attempted and each self-classifies
// (pass / fail / blocked) — an un-booted simulator prints as BLOCKED, never silently
// skipped (principle #6). `--platform=ios|android` runs just one.
//
// Exit codes (aggregated across the platforms run): 0 = at least one passed and none
// failed; 1 = a device was booted but a flow went RED or the env is broken (Metro down
// / app not installed / prepare never reached home); 3 = nothing reachable here (no device
// booted, or the platform toolchain is absent) — *blocked*, not a failure.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { KEY_STORE_NOTE } from "./custody-assertions.mjs";

export const APP_ID = "com.leapsake.app"; // app.json → android.package / ios.bundleIdentifier
export const SCHEME = "leapsake"; // app.json → scheme
const METRO_PORT = 8081;
const METRO_URL = `http://localhost:${METRO_PORT}`;
// Expo dev-server deep link that tells the dev client which packager to load. Uses
// localhost — reachable from the Android emulator via `adb reverse`, and from an iOS
// simulator directly — so it is machine- and LAN-independent, which is the whole point:
// the dev-launcher's own memory of a dev server is an absolute LAN URL that goes stale
// with the Mac's IP (see the iOS `prepare`). This is open-source Expo/Metro, not a vendor
// API. **Both** platforms now use it; on iOS it was rejected in 2026-07 (a SpringBoard
// confirm intercepted it) and re-verified working 2026-08-31.
const DEV_CLIENT_LINK = `${SCHEME}://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MAESTRO_DIR = join(ROOT, "apps", "mobile", "maestro");
const IOS_PREPARE_FLOW = join(MAESTRO_DIR, "ios-prepare.yaml"); // iOS bundle-load helper
const IOS_AUTOFILL_FLOW = join(MAESTRO_DIR, "ios-autofill.yaml"); // iOS AutoFill preflight

// **What the emulator is given, rather than what its AVD happens to say.** Android Studio
// creates AVDs with as little as one core and 2GB of RAM, and a React Native dev client on
// one of those is not merely slow — it is a different machine. Both halves were measured
// on this repo's own AVD, 2026-08-31, one commit, one emulator image:
//
//   - **Cores.** With `hw.cpu.ncore=1`, a factory reset's relaunch took over 90s to reach
//     the tab bar (13-second GC pauses in the logcat) and Flow 1 went red on a 60s wait.
//     Booted with `-cores 6`, the same commit reached the app home in 7s.
//   - **Memory, which was the harder one to see.** At `-memory 4096` the guest ran ~3.7GB
//     of 4GB used with ~800MB in swap, and Flow 4's account conversion — a 19MiB
//     *memory-hard* Argon2id pass, so the worst possible thing to page out — became
//     **bimodal: ~50s when it fit, four to seven minutes when it did not**, failing about
//     half of all runs on a build that was working. `/proc/vmstat` told the story:
//     `pswpout` had passed 1.4M pages (~5.6GB) on an emulator up for an hour. At
//     `-memory 8192` the same suite passed three runs running with the conversion back at
//     ~50-80s.
//
// The flags override the AVD's stored config without editing it, so this is the harness's
// own choice rather than a machine someone has to set up right. Lower them only against a
// measurement: **the right knob here is the device, not the timeouts** — a suite tuned to
// pass on a starved emulator is one that can no longer tell slow from broken.
const EMULATOR_SIZE = ["-cores", "6", "-memory", "8192"];

/** Linux with no display (a hosted runner): boot without a window, on software GL. */
const EMULATOR_HEADLESS =
  process.platform === "linux" && !process.env.DISPLAY
    ? ["-no-window", "-no-audio", "-gpu", "swiftshader_indirect"]
    : [];

const HOME_TIMEOUT_MS = 180_000; // budget for the first Metro bundle build → app home
const BOOT_TIMEOUT_MS = 300_000; // budget for a cold emulator/simulator boot
const METRO_TIMEOUT_MS = 120_000; // budget for `expo start` → packager-status:running
const SHUTDOWN_TIMEOUT_MS = 60_000; // budget for an emulator to leave `adb devices`
const INSTALL_TIMEOUT_MS = 60 * 60_000; // budget for a cold `expo run:<platform>` build

// Per-platform outcomes. These are aggregated into the process exit code at the end.
export const PASS = "pass"; // device booted, flows green
export const FAIL = "fail"; // device booted, but a flow went RED or env broken → exit 1
export const BLOCKED = "blocked"; // not reachable here (no device / no toolchain) → exit 3

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seconds = (since) => `${((Date.now() - since) / 1000).toFixed(0)}s`;

/**
 * Turn Android's window animations off, so a tap cannot land on a moving screen.
 *
 * Three hosted-runner failures were exactly that (`plans/fable-investigation/
 * remote-releases.md` → step 6): a pane still sliding in when Maestro tapped where the
 * element had been. Scale 0 is the standard CI setting and makes every transition instant;
 * the app's own animations are untouched, so nothing under test is skipped. Best-effort:
 * a device that refuses is slower and flakier, not wrong.
 */
function stopAnimations(adb, device) {
  const scales = [
    "window_animation_scale",
    "transition_animation_scale",
    "animator_duration_scale",
  ];
  const failed = scales.filter(
    (scale) =>
      run(adb, ["-s", device, "shell", "settings", "put", "global", scale, "0"])
        .status !== 0,
  );
  if (failed.length > 0) {
    console.warn(
      `  ! could not turn off ${failed.join(", ")} — taps may land on a moving screen`,
    );
  }
}

// --- shared: which device ---------------------------------------------------------
//
// **A run must not depend on which device happened to be first in a list.** Both drivers
// used to take `[0]` of whatever was booted, so a developer with two emulators up — or a
// phone plugged in — got a different device (and a different verdict) than the one they
// had prepared, and the failure named a missing app or a missing screen rather than the
// wrong device. With more than one candidate there is no defensible pick, so the harness
// refuses and says how to choose, rather than guessing.
//
// `--device=<id>` (or `LEAPSAKE_E2E_DEVICE`) pins one; under `--provision`, where nobody
// is watching, the extras are shut down instead so an unattended release still runs.

/** The `--device=`/env pin, if any. Set by {@link runSuite} before anything detects. */
let devicePin = process.env.LEAPSAKE_E2E_DEVICE?.trim() || null;

/**
 * Reduce the booted candidates to exactly one, or explain why it cannot.
 *
 * `candidates` is `[{ id, label }]`; the pin matches either, case-insensitively, so
 * `--device=Pixel_9` works as well as `--device=emulator-5554`.
 *
 * Returns `{ device }`, or `{ status, detail }` in the shape `detect()` returns.
 */
function resolveOneDevice({ candidates, shutdownExtras, provision, hint }) {
  const pinned = devicePin
    ? candidates.filter(
        ({ id, label }) =>
          id.toLowerCase() === devicePin.toLowerCase() ||
          label.toLowerCase() === devicePin.toLowerCase(),
      )
    : candidates;
  if (devicePin && pinned.length === 0) {
    return {
      status: FAIL,
      detail:
        `--device=${devicePin} matches none of the booted devices:\n` +
        candidates.map(({ id, label }) => `    ${id}  (${label})`).join("\n"),
    };
  }
  if (pinned.length === 1) return { device: pinned[0].id };

  // More than one, and nothing to pick by. Under --provision, keep the first and shut the
  // rest down — that is the unattended path, and a release that stops to ask is no use.
  if (provision) {
    const [keep, ...extras] = pinned;
    for (const extra of extras) {
      console.log(
        `  shutting down the extra device ${extra.id} (${extra.label})`,
      );
      shutdownExtras(extra.id);
    }
    return { device: keep.id };
  }
  return {
    status: FAIL,
    detail:
      `${pinned.length} devices are booted, so which one to test is ambiguous:\n` +
      pinned.map(({ id, label }) => `    ${id}  (${label})`).join("\n") +
      `\n  Pick one and re-run:\n    ${hint}\n` +
      "  (or set LEAPSAKE_E2E_DEVICE, or shut the others down.)",
  };
}

// --- shared: maestro + Metro -----------------------------------------------------

// `maestro` from its default install dir (~/.maestro/bin — the installer adds this to
// PATH only in login shells, which a `pnpm` subprocess may not be), else PATH.
function resolveMaestro() {
  const p = join(homedir(), ".maestro", "bin", "maestro");
  if (existsSync(p)) return p;
  return "maestro";
}
const maestro = resolveMaestro();

const maestroPresent = () => run(maestro, ["--version"]).status === 0;

// Metro must be serving (the dev client loads its JS bundle from it). The dev-only routes
// some flows use are __DEV__-only, so a release build won't have them — a running Metro
// implies dev. Memoized: the same host Metro serves every platform, so we probe it once
// per run.
let metroCache;
async function metroReachable() {
  if (metroCache !== undefined) return metroCache;
  metroCache = await fetch(`${METRO_URL}/status`, {
    signal: AbortSignal.timeout(3000),
  })
    .then((r) => r.text())
    .then((t) => t.includes("packager-status:running"))
    .catch(() => false);
  return metroCache;
}

/**
 * Run one Maestro flow against a specific device, returning its exit code (0 = green).
 *
 * Both platforms select the device with the top-level `--udid <device>` flag — required
 * here because with an Android emulator *and* an iOS sim booted an un-targeted
 * `maestro test` is ambiguous.
 */
/** The text and ids on screen in a Maestro hierarchy, for a failure that must say what it saw. */
export function screenLabels(tree, limit = 40) {
  const seen = new Set();
  const walk = (node) => {
    const a = node?.attributes ?? {};
    for (const key of ["text", "accessibilityText", "resource-id"]) {
      const value = a[key]?.trim();
      if (value) seen.add(key === "resource-id" ? `#${value}` : value);
    }
    for (const child of node?.children ?? []) walk(child);
  };
  walk(tree);
  return [...seen].slice(0, limit);
}

function onScreen(device) {
  const out = run(maestro, ["--udid", device, "hierarchy"]).stdout ?? "";
  try {
    return screenLabels(JSON.parse(out.slice(out.indexOf("{")))).join(" · ");
  } catch {
    return "(the hierarchy could not be read)";
  }
}

/**
 * Wait until Maestro can open a session against `device`, or say it never could.
 *
 * Maestro installs and launches its own UITest runner the first time it drives a simulator,
 * and on a hosted runner straight off a cold build that has failed outright —
 * `MaestroSessionManager.newSession`, twice, always on the job that built (2026-09-20). The
 * first *flow* then carries the blame for it. A cheap `hierarchy` call is the same handshake,
 * so doing it here makes the wait explicit and the failure honest.
 */
async function maestroReady(device, timeoutMs = 120_000) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    const probe = run(maestro, ["--udid", device, "hierarchy"]);
    if (probe.status === 0) {
      console.log(`  maestro ready (${seconds(started)})`);
      return { ok: true };
    }
    last = (probe.stderr || probe.stdout || "")
      .trim()
      .split("\n")
      .slice(-3)
      .join("\n");
    await sleep(5000);
  }
  return {
    ok: false,
    detail:
      `maestro could not open a session on ${device} within ${timeoutMs / 1000}s — its ` +
      "UITest runner never came up. Last error:\n" +
      last,
  };
}

function runMaestroFlow(device, file) {
  const flow = run(maestro, ["--udid", device, "test", file], {
    stdio: "inherit",
  });
  return flow.status ?? 1;
}

// --- shared: provisioning (--provision) ------------------------------------------
//
// Everything below exists so that `pnpm release` can be ONE command. The rest of this
// file deliberately assumes a prepared environment and fails with the command to run;
// under `--provision` it runs those commands itself instead.
//
// It stays opt-in because the two callers want opposite things. A developer in the inner
// loop already has a simulator up and a dev client installed, and would not thank a test
// run for booting a second one or spending ten minutes on a native rebuild — for them the
// "here is the command" failure is the faster answer. A release, and a CI runner, start
// from nothing and must not need a human. So: `pnpm test:native` behaves as it always has,
// and `pnpm release` passes `--provision`.
//
// **What it starts, it stops — and only what it started.** A Metro this script spawned is
// killed on the way out; a Metro that was already serving is left alone, because it is
// almost certainly the developer's own and killing it would be a surprising thing for a
// test run to do.
//
// Devices used to be the other way round — booting one is slow, so they were left booted
// and reported. They no longer are, and only under `--provision`, where the harness is the
// one that booted them: each platform's device is shut down as soon as its flows are done,
// so a provisioned run is boot → run → shut down and owes nothing to the run before it.
// Two device VMs on one Mac compete for the cores and RAM that the suite's heaviest step
// is least able to share (the measurement is on `EMULATOR_SIZE` and `runSuite`'s loop).

/** The Metro we spawned, if we spawned one. Never a Metro that was already serving. */
let metroStarted = null;

/**
 * Ensure Metro is serving, starting it if it is not.
 *
 * The readiness signal is the same `/status` probe the non-provisioning path uses, polled
 * rather than assumed: `expo start` returns long before the packager answers, so spawning
 * it and proceeding would just move the failure to the next step.
 */
async function ensureMetro() {
  // Drop a memoized *negative*: `expo run:<platform>` starts a dev server of its own, so
  // a `false` probed before the install step may no longer be true. A memoized `true`
  // cannot go stale in the other direction within one run.
  if (metroCache !== true) metroCache = undefined;
  if (await metroReachable()) return { ok: true };

  console.log("  starting Metro (expo start --dev-client)…");
  // detached so it survives this process and can be signalled as a group; Expo spawns
  // workers that would outlive a bare kill of the parent.
  const child = spawn("pnpm", ["--filter", "@leapsake/mobile", "dev"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  metroStarted = child;

  const started = Date.now();
  while (Date.now() - started < METRO_TIMEOUT_MS) {
    await sleep(1000);
    metroCache = undefined; // re-probe; the memoized `false` is what we are fixing
    if (await metroReachable()) {
      console.log(
        `  Metro up (${((Date.now() - started) / 1000).toFixed(0)}s)`,
      );
      return { ok: true };
    }
  }
  return {
    ok: false,
    detail:
      `Metro did not start serving within ${METRO_TIMEOUT_MS / 1000}s. Run it in its own ` +
      "terminal to see why:\n    pnpm --filter @leapsake/mobile dev",
  };
}

/** Kill a Metro this script started. A pre-existing one is never touched. */
function stopMetroIfStarted() {
  if (!metroStarted) return;
  const { pid } = metroStarted;
  metroStarted = null;
  // Negative pid signals the whole process group — see `detached` above.
  try {
    process.kill(-pid, "SIGTERM");
    console.log("\n  stopped the Metro this run started");
  } catch {
    // Already gone, which is the outcome we wanted anyway.
  }
}

/**
 * Build + install the dev client with `expo run:<platform>`, targeting one device.
 *
 * `--device` is passed explicitly rather than letting Expo choose: with more than one
 * simulator booted it prompts interactively, which would hang a release. It takes the name
 * *Expo* knows the device by, which on Android is not the adb serial — see
 * `androidExpoName`. Output is streamed because this is the slowest step by an order of
 * magnitude (a full native build) and a silent ten minutes is indistinguishable from a
 * hang.
 *
 * On iOS this prebuilds a *debug* `apps/mobile/ios/`. That is harmless: the release's own
 * `build()` deletes the directory and prebuilds again for the Release archive, and the
 * gate runs to completion before shipping starts — so nothing from here can reach the
 * artifact.
 */
function installDevClient(platform, device) {
  console.log(
    `  building + installing the dev client (expo run:${platform}) — several minutes…`,
  );
  const started = Date.now();
  const built = spawnSync(
    "pnpm",
    [
      "--filter",
      "@leapsake/mobile",
      "exec",
      "expo",
      `run:${platform}`,
      "--device",
      device,
      // Without it, `expo run` starts its own Metro when none is up and never exits.
      "--no-bundler",
    ],
    { cwd: ROOT, stdio: "inherit", timeout: INSTALL_TIMEOUT_MS },
  );
  console.log(`  expo run:${platform} took ${seconds(started)}`);
  if (built.error?.code === "ETIMEDOUT") {
    console.log(
      `  expo run:${platform} passed ${INSTALL_TIMEOUT_MS / 60_000}m and was stopped`,
    );
  }
  return built.status === 0;
}

// --- android driver --------------------------------------------------------------

// `adb` from the Android SDK (ANDROID_HOME / ANDROID_SDK_ROOT), else PATH.
function resolveAdb() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const p = join(sdk, "platform-tools", "adb");
    if (existsSync(p)) return p;
  }
  return "adb"; // fall back to PATH
}

/** Every attached, fully-booted device serial, in adb's order. */
const bootedSerials = (adb) =>
  run(adb, ["devices"])
    .stdout.split("\n")
    .slice(1)
    .filter((l) => l.endsWith("\tdevice"))
    .map((l) => l.split("\t")[0]);

/** The first attached, fully-booted device serial, or undefined. */
const bootedSerial = (adb) => bootedSerials(adb)[0];

/**
 * What `expo run:android --device` calls this device — which is **not** its adb serial.
 *
 * Expo resolves the flag against its own device list, and that list names a booted
 * emulator by its **AVD** (`adb emu avd name`), a physical device by its `model:` prop.
 * Passing `emulator-5554` therefore fails with "Could not find device with name:
 * emulator-5554" *while that emulator is plainly attached* — which reads like a broken
 * emulator rather than a wrong flag. Maestro is the other way round and wants the serial,
 * so the two identifiers coexist on purpose: `ctx.device` is the serial everything else
 * uses, and this is the one place that needs Expo's name for it.
 *
 * Falls back to the serial rather than throwing: if the mapping ever fails, letting Expo
 * report what it could not find beats inventing a second error message here.
 */
function androidExpoName(adb, serial) {
  if (serial.startsWith("emulator-")) {
    const name = run(adb, ["-s", serial, "emu", "avd", "name"])
      .stdout?.split("\n")
      .map((line) => line.trim())
      .find((line) => line && line !== "OK");
    if (name) return name;
  }
  const model = run(adb, ["-s", serial, "shell", "getprop", "ro.product.model"])
    .stdout?.trim()
    .replace(/\s+/g, "_");
  return model || serial;
}

/** `emulator` from the SDK, else PATH — the same resolution order as `adb`. */
function resolveEmulator() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const p = join(sdk, "emulator", "emulator");
    if (existsSync(p)) return p;
  }
  return "emulator";
}

// The three expo-dev-menu settings a *fresh install* gets wrong, all of which break flows
// in ways that do not look like a harness problem:
//
//   - `showFab` — the floating "Tools" bubble. It is an overlay, so a `tapOn` under it
//     reports COMPLETED while the dev menu opens instead, and the flow fails several steps
//     later on an unrelated assertion. Confirmed on `global-nav.yaml` (case 3's
//     `search-here-people`) and suspected on the retired `staged-gift-occasions.yaml`.
//   - `isOnboardingFinished` — the one-time "This is the developer menu" panel, which
//     covers the app on first launch after an install.
//   - `showsAtLaunch` — the dev menu opening over the app on every launch.
//
// The dev client reads these from SharedPreferences at start, so they are settable over
// `adb run-as` (debuggable builds only — which a dev client always is) *while the app is
// stopped*: a running process holds them in memory and would write its copy back over ours.
//
// `mkdir -p` first, because under `--provision` this runs immediately after a **fresh
// install**, and `shared_prefs/` is created by the app's first launch rather than by the
// installer. Without it the redirect fails with "No such file or directory", the run
// continues with the Tools bubble still on, and the flow that dies is several steps later
// somewhere unrelated — the most expensive trap in this harness, arriving through its own
// mitigation.
const DEV_MENU_PREFS = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <boolean name="isOnboardingFinished" value="true" />
    <boolean name="showsAtLaunch" value="false" />
    <boolean name="showFab" value="false" />
</map>
`;
const DEV_MENU_PREFS_PATH =
  "shared_prefs/expo.modules.devmenu.sharedpreferences.xml";

// Best-effort: a failure here costs flakiness, not correctness, so it warns rather than
// failing the run — the flows themselves are still the gate.
function settleDevMenu(adb, device) {
  run(adb, ["-s", device, "shell", "am", "force-stop", APP_ID]);
  const wrote = run(
    adb,
    [
      "-s",
      device,
      "shell",
      "run-as",
      APP_ID,
      "sh",
      "-c",
      `'mkdir -p ${dirname(DEV_MENU_PREFS_PATH)} && cat > ${DEV_MENU_PREFS_PATH}'`,
    ],
    { input: DEV_MENU_PREFS },
  );
  if (wrote.status !== 0) {
    console.warn(
      "  ! could not settle the dev-menu prefs (run-as failed) — the floating Tools\n" +
        "    button may swallow taps. Turn it off by hand: dev menu → Tools button.",
    );
  }
}

/**
 * Every installed package that claims `leapsake://`.
 *
 * More than one is an environment fault with a distinctive failure: Android answers the
 * deep link with an **"Open with" chooser** listing two apps called Leapsake, the chooser
 * sits over everything, and the flow fails on whatever it asserted next — `tab-search is
 * not visible`, which reads as a broken app or a wrong selector. It cost a session on the
 * first Android E2E run, where the second claimant was this repo's own **previous package
 * name** (`net.leapsake.mobile`, renamed to `com.leapsake.app`) still installed on the
 * emulator from before the rename.
 *
 * Detected rather than worked around, because there is nothing to work around: Maestro's
 * `openLink` cannot name a package, so a device with two claimants cannot run these flows
 * at all. What the harness owes is a failure that says so.
 */
function schemeClaimants(adb, device) {
  const out = run(adb, [
    "-s",
    device,
    "shell",
    "cmd",
    "package",
    "query-activities",
    "-a",
    "android.intent.action.VIEW",
    "-c",
    "android.intent.category.BROWSABLE",
    "-d",
    `${SCHEME}://`,
  ]).stdout;
  if (!out) return [];
  const names = out
    .split("\n")
    .map((line) => line.match(/^\s*packageName=(\S+)/)?.[1])
    .filter(Boolean);
  return [...new Set(names)];
}

const androidDriver = {
  key: "android",
  label: "Android",

  // { status, detail } — a terminal blocked/fail result, or { device } to proceed.
  detect(provision) {
    const adb = resolveAdb();
    if (run(adb, ["version"]).status !== 0) {
      return {
        status: BLOCKED,
        detail:
          "`adb` not found. Install the Android SDK platform-tools and set ANDROID_HOME " +
          "(e.g. via Android Studio), or add `adb` to PATH.",
      };
    }
    // A booted device/emulator must be attached.
    const serials = bootedSerials(adb);
    if (serials.length === 0) {
      return {
        status: BLOCKED,
        detail:
          "no booted Android emulator. Boot one, e.g.:\n" +
          "    emulator -list-avds\n" +
          "    emulator -avd <name>\n" +
          "  or build+install+launch the dev client in one go:\n" +
          "    pnpm --filter @leapsake/mobile android",
      };
    }
    // Exactly one, or say why not. `adb devices` lists a plugged-in phone alongside every
    // emulator, so this is not a rare state — and it names them by AVD/model, which is
    // what a developer recognises, not by serial alone.
    const chosen = resolveOneDevice({
      // Emulators first, so that when `--provision` has to keep one unattended it keeps
      // one it is also allowed to have booted — and never a plugged-in phone, which it
      // could not shut down and should not be flashing test data onto.
      candidates: serials
        .slice()
        .sort(
          (a, b) =>
            Number(b.startsWith("emulator-")) -
            Number(a.startsWith("emulator-")),
        )
        .map((id) => ({ id, label: androidExpoName(adb, id) })),
      shutdownExtras: (id) => {
        if (!id.startsWith("emulator-")) {
          console.warn(`  ! ${id} is not an emulator — leaving it attached`);
          return;
        }
        run(adb, ["-s", id, "emu", "kill"]);
      },
      provision,
      hint: `pnpm test:e2e --device=${serials[0]}`,
    });
    if (chosen.status) return chosen;
    return { adb, device: chosen.device };
  },

  // The dev-client build must be installed.
  installed(ctx) {
    return run(ctx.adb, [
      "-s",
      ctx.device,
      "shell",
      "pm",
      "list",
      "packages",
      APP_ID,
    ]).stdout.includes(APP_ID);
  },

  installHint:
    `the dev-client build (${APP_ID}) is not installed. Build + install it with:\n` +
    "    pnpm --filter @leapsake/mobile android",

  // --provision: boot the first defined AVD and wait for Android to finish coming up.
  // `sys.boot_completed` is the signal rather than adb's mere presence — the daemon
  // answers well before the framework is up, and installing into a half-booted system
  // fails in ways that read like a build error.
  async boot() {
    const emulator = resolveEmulator();
    const list = run(emulator, ["-list-avds"]);
    if (list.status !== 0) {
      return {
        ok: false,
        detail:
          "`emulator` not found — install the Android SDK emulator package and set " +
          "ANDROID_HOME (Android Studio → SDK Manager).",
      };
    }
    // `-list-avds` prints one name per line, but the binary also emits the odd INFO
    // banner; an AVD name has no whitespace, which is enough to tell them apart.
    const avd = list.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/\s/.test(l))[0];
    if (!avd) {
      return {
        ok: false,
        detail:
          "no AVD is defined — create one in Android Studio → Device Manager, then " +
          "re-run.",
      };
    }

    console.log(`  booting the Android emulator (${avd})…`);
    const child = spawn(
      emulator,
      ["-avd", avd, ...EMULATOR_SIZE, ...EMULATOR_HEADLESS],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();

    const adb = resolveAdb();
    const started = Date.now();
    while (Date.now() - started < BOOT_TIMEOUT_MS) {
      const serial = bootedSerial(adb);
      if (
        serial &&
        run(adb, [
          "-s",
          serial,
          "shell",
          "getprop",
          "sys.boot_completed",
        ]).stdout?.trim() === "1"
      ) {
        console.log(
          `  emulator up (${((Date.now() - started) / 1000).toFixed(0)}s)`,
        );
        stopAnimations(adb, serial);
        return { ok: true };
      }
      await sleep(2000);
    }
    return {
      ok: false,
      detail: `the emulator did not finish booting within ${BOOT_TIMEOUT_MS / 1000}s`,
    };
  },

  install: (ctx) =>
    installDevClient("android", androidExpoName(ctx.adb, ctx.device)),

  // `pm clear` erases the app's whole data dir — every store, the roster, the doors, and
  // the SharedPreferences that hold expo-secure-store's ciphertext (the AndroidKeyStore
  // key survives, but with nothing left to decrypt it is inert). It is exactly the wipe
  // the flows' in-app factory reset performs, done from outside, so it works on an app too
  // wedged to drive — and it takes the dev-menu prefs with it, which is why `prepare`
  // re-settles them straight after (see `settleDevMenu`, and the ordering note in
  // `runPlatform`).
  wipe(ctx) {
    const cleared = run(ctx.adb, [
      "-s",
      ctx.device,
      "shell",
      "pm",
      "clear",
      APP_ID,
    ]);
    return cleared.stdout?.includes("Success")
      ? { ok: true }
      : {
          ok: false,
          detail:
            `\`adb shell pm clear ${APP_ID}\` did not report Success, so this run would ` +
            "start on whatever the last one left behind:\n  " +
            (cleared.stderr || cleared.stdout || "no output").trim(),
        };
  },

  // Nothing to check: the AutoFill preflight guards an iOS-only system behaviour.
  preflight: () => ({ ok: true }),

  // What Android's crash buffer holds for our package, for a flow that found the app gone.
  // The head of a tombstone, not its tail: the signal and the abort message say what died,
  // where 40 frames of `libreactnative.so` do not.
  crashes(ctx) {
    const out =
      run(ctx.adb, [
        "-s",
        ctx.device,
        "logcat",
        "-d",
        "-b",
        "crash",
        "-t",
        "400",
      ]).stdout ?? "";
    const lines = out
      .split("\n")
      .filter(
        (line) =>
          /signal \d|Abort message|FATAL EXCEPTION|ANR in|Cmdline|^\s*#0[0-9] /.test(
            line,
          ) ||
          (line.includes(APP_ID) && !line.includes("/base.apk!")),
      );
    return lines.slice(0, 14).join("\n");
  },

  stop: (ctx) =>
    run(ctx.adb, ["-s", ctx.device, "shell", "am", "force-stop", APP_ID]),

  /** `emu kill` returns before the emulator is gone; wait, so the next tier boots its own. */
  async shutdown(ctx) {
    run(ctx.adb, ["-s", ctx.device, "emu", "kill"]);
    const started = Date.now();
    while (Date.now() - started < SHUTDOWN_TIMEOUT_MS) {
      if (!run(ctx.adb, ["devices"]).stdout.includes(ctx.device)) return;
      await sleep(1000);
    }
    console.warn(
      `  ! ${ctx.device} was still attached ${seconds(started)} after emu kill`,
    );
  },

  // Load the JS bundle and wait for the app home. On Android a deep link does this
  // deterministically (no SpringBoard-style confirm), so we drive it over adb here rather
  // than through Maestro. Returns { ok, detail }.
  async prepare(ctx) {
    const { adb, device } = ctx;
    // Exactly one app may answer `leapsake://`, or the chooser eats every deep link.
    const claimants = schemeClaimants(adb, device);
    const strangers = claimants.filter((name) => name !== APP_ID);
    if (strangers.length > 0) {
      return {
        ok: false,
        detail:
          `${claimants.length} installed apps claim ${SCHEME}:// on this device, so ` +
          'Android answers every deep link with an "Open with" chooser that covers the\n' +
          "  app — the flows cannot drive past it. Uninstall the others:\n" +
          strangers
            .map((name) => `    adb -s ${device} uninstall ${name}`)
            .join("\n"),
      };
    }
    // Say so when the device is one this suite cannot be trusted on. `--provision` boots
    // with EMULATOR_SIZE, but an emulator someone else started — Android Studio, or
    // `expo run:android` — gets whatever its AVD config says, and Android Studio's default
    // is one core. That is the shape the reds of 2026-08-31 had: every flow timing out a
    // step or two further along, none of them pointing at the cause. A warning, not a
    // failure — the run may well still pass, and refusing to try would be worse.
    const cores = Number(
      run(adb, ["-s", device, "shell", "nproc"]).stdout?.trim(),
    );
    // `> 0` as well as `< 4`: a device without `nproc` answers with nothing, and `Number("")`
    // is 0 — which would warn about a machine we simply could not measure.
    if (Number.isFinite(cores) && cores > 0 && cores < 4) {
      console.warn(
        `  ! this emulator has ${cores} CPU core${cores === 1 ? "" : "s"} — a dev client ` +
          "needs more, and the\n    flows will time out on waits that are not really slow. " +
          "Re-boot it with:\n" +
          `      emulator -avd <name> ${EMULATOR_SIZE.join(" ")}\n` +
          "    or raise the AVD's cores in Android Studio → Device Manager → Edit.",
      );
    }
    // Reverse-tunnel so the emulator reaches the host's Metro at localhost:8081.
    run(adb, [
      "-s",
      device,
      "reverse",
      `tcp:${METRO_PORT}`,
      `tcp:${METRO_PORT}`,
    ]);
    // Both settles also cover a device someone else booted, where `boot` never ran.
    stopAnimations(adb, device);
    // Put the dev menu in a state that does not fight the flows. This force-stops the app,
    // so it has to come before the deep link that launches it.
    settleDevMenu(adb, device);
    // Load the JS bundle by pointing the dev client at Metro. A cold launch alone opens
    // the expo-dev-launcher; this deep link makes it load the app.
    console.log("  loading JS bundle into the dev client…");
    run(adb, [
      "-s",
      device,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      DEV_CLIENT_LINK,
      APP_ID,
    ]);
    // Wait for the app's home screen, keyed on the Search tab's `testID` — absent from the
    // dev-launcher, which only has Home/Updates/Settings. This absorbs the first Metro
    // bundle build. It is the same signal `ios-prepare.yaml` waits for, deliberately: this
    // used to key on a "People" tab, which increment 09 removed, and the runner then spun
    // the full timeout on an app that was in fact up. An id survives a label change.
    const started = Date.now();
    let dump = "";
    while (Date.now() - started < HOME_TIMEOUT_MS) {
      dump =
        run(adb, ["-s", device, "exec-out", "uiautomator", "dump", "/dev/tty"])
          .stdout ?? "";
      if (/resource-id="tab-search"/.test(dump)) {
        console.log(
          `  app home up (${((Date.now() - started) / 1000).toFixed(0)}s)`,
        );
        return { ok: true };
      }
      // An "isn't responding" dialog covers the app until answered; Wait lets the process recover.
      const wait = anrWaitTap(dump);
      if (wait) {
        console.log(`  ! dismissed "${wait.title}" with Wait`);
        run(adb, ["-s", device, "shell", "input", "tap", wait.x, wait.y]);
      }
      await sleep(2000);
    }
    return {
      ok: false,
      detail:
        "the app's home screen never appeared within " +
        `${HOME_TIMEOUT_MS / 1000}s of loading the bundle. Check the Metro output for a ` +
        "bundling error, and that the installed build is the current dev client " +
        "(re-run `pnpm --filter @leapsake/mobile android` if a native module changed).\n" +
        `on screen: ${uiautomatorLabels(dump).join(" · ") || "(nothing readable)"}`,
    };
  },
};

/** Where to tap Wait on an Android "isn't responding" dialog in a `uiautomator dump`, or null. */
export function anrWaitTap(dump) {
  const node = dump.match(
    /<node\b[^>]*resource-id="android:id\/aerr_wait"[^>]*>/,
  )?.[0];
  const bounds = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!bounds) return null;
  const [x1, y1, x2, y2] = bounds.slice(1).map(Number);
  const title =
    dump.match(
      /text="([^"]*)"[^>]*resource-id="android:id\/alertTitle"/,
    )?.[1] ?? "isn't responding";
  return {
    x: String(Math.round((x1 + x2) / 2)),
    y: String(Math.round((y1 + y2) / 2)),
    title,
  };
}

/** The text, descriptions and ids in a `uiautomator dump`, for a failure that must say what it saw. */
export function uiautomatorLabels(dump, limit = 40) {
  const seen = new Set();
  for (const [, key, value] of dump.matchAll(
    /\b(text|content-desc|resource-id)="([^"]+)"/g,
  )) {
    seen.add(key === "resource-id" ? `#${value}` : value);
  }
  return [...seen].slice(0, limit);
}

// --- ios driver ------------------------------------------------------------------

// iOS has the same floating dev-menu button as Android and it bites the same way — an
// overlay that turns a `tapOn` underneath it into "the dev menu opened instead". It cost
// the retired `staged-gift-occasions.yaml` its whole run: the button's stored position sat over the add
// screen's holiday row, so `stage-christmas`'s `tapOn: below: "Add a holiday"` hit the
// button and the flow died three cases in. Hiding it turned the same unmodified flow green
// on all five cases.
//
// The key is read through UserDefaults (`expo-dev-menu`'s DevMenuPreferences.swift), so
// `simctl spawn defaults write` sets it — while the app is stopped, since a running process
// would write its own copy back over ours. Best-effort, like the Android side: a failure
// costs flakiness, not correctness.
//
// The build ALSO carries this key in Info.plist (`ios.infoPlist` in app.json), which is the
// stronger half: it survives a reinstall and covers running a flow directly, which bypasses
// this script entirely. This step stays because Info.plist only supplies a *registered
// default* — an explicit UserDefaults value, which any dev who has ever toggled the button
// by hand now has, silently outranks it.
/** The model CI measures on; `boot` warns when it runs on anything else. */
const IOS_SIMULATOR =
  process.env.LEAPSAKE_IOS_SIMULATOR?.trim() || "iPhone 17 Pro";

/**
 * Reduce Motion and a frozen status bar, the iOS half of what `stopAnimations` does.
 *
 * Reduce Motion replaces the slide transitions a tap can land in the middle of; the status
 * bar override stops a changing clock, carrier and battery from walking through every
 * `on screen:` line (and any assertion that reads the whole screen). Best-effort, like the
 * dev-menu settle: a simulator that refuses is flakier, not wrong.
 */
function settleSimulator(device) {
  const reduced = run("xcrun", [
    "simctl",
    "spawn",
    device,
    "defaults",
    "write",
    "com.apple.Accessibility",
    "ReduceMotionEnabled",
    "-bool",
    "true",
  ]);
  if (reduced.status !== 0) {
    console.warn(
      "  ! could not turn Reduce Motion on — taps may land on a moving screen",
    );
  }
  run("xcrun", [
    "simctl",
    "status_bar",
    device,
    "override",
    "--time",
    "9:41",
    "--batteryState",
    "charged",
    "--batteryLevel",
    "100",
    "--cellularBars",
    "4",
    "--wifiBars",
    "3",
  ]);
}

const IOS_FAB_KEY = "EXDevMenuShowFloatingActionButton";
// The dev menu opens itself at launch on a simulator that has never run it, onboarding sheet
// and all, and covers whatever the flow was about to drive (hosted runners, 2026-09-19).
const IOS_DEV_MENU_KEYS = [
  [IOS_FAB_KEY, "false"],
  ["EXDevMenuShowsAtLaunch", "false"],
  ["EXDevMenuIsOnboardingFinished", "true"],
];

function settleDevMenuIos(device) {
  run("xcrun", ["simctl", "terminate", device, APP_ID]);
  const failed = IOS_DEV_MENU_KEYS.filter(
    ([key, value]) =>
      run("xcrun", [
        "simctl",
        "spawn",
        device,
        "defaults",
        "write",
        APP_ID,
        key,
        "-bool",
        value,
      ]).status !== 0,
  );
  if (failed.length > 0) {
    console.warn(
      `  ! could not settle the dev menu (${failed.map(([key]) => key).join(", ")}) — it\n` +
        "    may open over the app or swallow taps. Set them by hand in the dev menu.",
    );
  }
}

/**
 * The app's **data** container on a simulator — where its stores, doors and roster live.
 *
 * Two callers want the same directory for opposite reasons: `wipe` deletes what is under
 * it, and `appDataRoot` reads it. Sharing one command is what keeps those two honest about
 * each other — the directory a run erases is the directory its custody checks then read.
 *
 * ⚠️ The `data` argument is load-bearing. Without it `get_app_container` returns the
 * *bundle*, which is the installed app, not its state.
 */
function iosContainer(device) {
  const container = run("xcrun", [
    "simctl",
    "get_app_container",
    device,
    APP_ID,
    "data",
  ]);
  if (container.status !== 0) {
    return {
      ok: false,
      detail:
        `could not locate ${APP_ID}'s data container on the simulator:\n  ` +
        (container.stderr || "no output").trim(),
    };
  }
  return { ok: true, path: container.stdout.trim() };
}

const iosDriver = {
  key: "ios",
  label: "iOS",

  detect(provision) {
    // `xcrun simctl` gates the whole iOS path (Xcode command-line tools). Absent on
    // non-macOS hosts and Macs without Xcode → the iOS tier is blocked here, not failed.
    if (run("xcrun", ["simctl", "help"]).status !== 0) {
      return {
        status: BLOCKED,
        detail:
          "`xcrun simctl` not found — iOS simulators need Xcode + its command-line tools " +
          "(macOS only). Install Xcode, then `xcode-select --install`.",
      };
    }
    // A booted simulator must exist. `simctl list devices booted` prints one line per
    // booted sim: "    <name> (<UDID>) (Booted)".
    const booted = run("xcrun", ["simctl", "list", "devices", "booted"]).stdout;
    const candidates = booted
      .split("\n")
      .map((line) => line.match(/^\s+(.+?) \(([0-9A-Fa-f-]{36})\) \(Booted\)/))
      .filter(Boolean)
      .map(([, name, udid]) => ({ id: udid, label: name.trim() }));
    if (candidates.length === 0) {
      return {
        status: BLOCKED,
        detail:
          "no booted iOS simulator. Boot one, e.g.:\n" +
          "    xcrun simctl list devices available\n" +
          "    xcrun simctl boot <udid>   # then: open -a Simulator\n" +
          "  or build+install+launch the dev client in one go:\n" +
          "    pnpm --filter @leapsake/mobile ios",
      };
    }
    const chosen = resolveOneDevice({
      candidates,
      shutdownExtras: (id) => run("xcrun", ["simctl", "shutdown", id]),
      provision,
      hint: `pnpm test:e2e --device="${candidates[0].label}"`,
    });
    if (chosen.status) return chosen;
    return { device: chosen.device };
  },

  // Installed iff the app has a data container on the sim.
  installed(ctx) {
    return (
      run("xcrun", ["simctl", "get_app_container", ctx.device, APP_ID])
        .status === 0
    );
  },

  installHint:
    `the dev-client build (${APP_ID}) is not installed on the simulator. Build + install ` +
    "it with:\n    pnpm --filter @leapsake/mobile ios",

  // --provision: boot the first available iPhone simulator. An iPhone specifically —
  // the flows are phone-shaped, and `simctl list` will happily offer an iPad or a Watch.
  async boot() {
    const available = run("xcrun", [
      "simctl",
      "list",
      "devices",
      "available",
    ]).stdout;
    const candidates = available
      .split("\n")
      .map((line) =>
        line.match(/^\s+(iPhone[^(]*)\(([0-9A-Fa-f-]{36})\) \(Shutdown\)/),
      )
      .filter(Boolean);
    // The pinned model, or whatever iPhone exists — a runner image swaps its default
    // iPhone from under us, and a different screen is a different set of what is on it.
    const match =
      candidates.find(([, name]) => name.trim() === IOS_SIMULATOR) ??
      candidates[0];
    if (!match) {
      return {
        ok: false,
        detail:
          "no available iPhone simulator — add a runtime in Xcode → Settings → " +
          "Components, then re-run.",
      };
    }
    const [, name, udid] = match;
    if (name.trim() !== IOS_SIMULATOR) {
      console.warn(
        `  ! no ${IOS_SIMULATOR} simulator here — running on ${name.trim()}, which is ` +
          "not what CI measures",
      );
    }

    console.log(`  booting the iOS simulator (${name.trim()})…`);
    if (run("xcrun", ["simctl", "boot", udid]).status !== 0) {
      return { ok: false, detail: `could not boot the simulator ${udid}` };
    }
    // Bring the Simulator UI up: Maestro drives the window, and a headless-booted device
    // has no window to drive.
    run("open", ["-a", "Simulator"]);
    // `bootstatus -b` blocks until the device is all the way up, so no poll is needed.
    if (run("xcrun", ["simctl", "bootstatus", udid, "-b"]).status !== 0) {
      return {
        ok: false,
        detail: `the simulator ${udid} never finished booting`,
      };
    }
    console.log(`  simulator up (${name.trim()})`);
    settleSimulator(udid);
    return { ok: true };
  },

  install: (ctx) => installDevClient("ios", ctx.device),

  // The newest crash report naming our bundle id, if the app died in the last ten minutes.
  crashes() {
    const dir = join(homedir(), "Library", "Logs", "DiagnosticReports");
    if (!existsSync(dir)) return "";
    const recent = readdirSync(dir)
      .filter((name) => name.endsWith(".ips"))
      .map((name) => join(dir, name))
      .filter((path) => Date.now() - statSync(path).mtimeMs < 10 * 60_000)
      .filter((path) => readFileSync(path, "utf8").includes(APP_ID))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (!recent) return "";
    const text = readFileSync(recent, "utf8");
    const reason = text.match(/"(termination|exception)"[^\n]*/g) ?? [];
    return [recent, ...reason.slice(0, 3)].join("\n");
  },

  /**
   * The same wipe as Android's `pm clear`, assembled by hand — because iOS has no
   * per-app data reset, and every blunt instrument that *looks* like one takes too much.
   *
   * `simctl uninstall` and Maestro's `clearState` both delete the whole data container,
   * and `Library/Preferences/com.leapsake.app.plist` is in it. That plist holds the
   * dev-menu settings `settleDevMenuIos` writes and `expo.devlauncher.recentlyopenedapps`
   * — the URL a *cold* launch reconnects to on its own, which is what
   * `subflows/factory-reset.yaml` relies on when it relaunches mid-flow. (`prepare` no
   * longer depends on it: it deep-links to localhost explicitly. But the deep link is
   * also what keeps that memory pointing at localhost, and throwing it away would put a
   * dev-launcher screen in the middle of a flow with nothing to drive it past.)
   *
   * So this deletes the two things that actually hold app state and nothing else:
   *
   *   - **`Documents/SQLite/`** — every store, its doors, and the account roster. Verified
   *     against a real container: `leapsake-roster.db` and `stores/<accountId>/{leapsake,
   *     doors}.db` are all of it.
   *   - **the simulator keychain** — where expo-secure-store keeps this device's id, the
   *     database key and the rest of `KEYSTORE_SECRET_IDS`. `simctl keychain reset` is
   *     device-wide, which on a test simulator costs nothing and is the only handle
   *     offered. Leaving it out would be worse than not wiping at all: a store-less device
   *     that still holds a database key is a state a first run cannot otherwise reach, and
   *     it is the one Flow 1's "Unlock your data" assertion is about.
   *
   * The app must not be running — a live process would write its state back out — hence
   * the terminate, the same one `settleDevMenuIos` does for the same reason.
   */
  wipe(ctx) {
    run("xcrun", ["simctl", "terminate", ctx.device, APP_ID]);
    const container = iosContainer(ctx.device);
    if (!container.ok) return container;
    rmSync(join(container.path, "Documents", "SQLite"), {
      recursive: true,
      force: true,
    });
    const keychain = run("xcrun", ["simctl", "keychain", ctx.device, "reset"]);
    if (keychain.status !== 0) {
      return {
        ok: false,
        detail:
          "`xcrun simctl keychain reset` failed, so this run would start with the last " +
          "run's keys still in the keychain:\n  " +
          (keychain.stderr || "no output").trim(),
      };
    }
    return { ok: true };
  },

  /**
   * Where the app keeps every store, its doors and the account roster — what the
   * out-of-band custody assertions read (`runCustody`, and `lib/custody-assertions.mjs`).
   *
   * **Android has no counterpart on purpose.** Its `wipe` is `pm clear`, which gives back
   * no path at all, so there is nothing to read from there today; the absence of this
   * method *is* how that platform declines the check, stated once, here, rather than
   * re-tested at the call site.
   */
  appDataRoot(ctx) {
    const container = iosContainer(ctx.device);
    return container.ok
      ? { ok: true, path: join(container.path, "Documents", "SQLite") }
      : container;
  },

  /**
   * Refuse to run the catalog while iOS AutoFill would eat the passwords it types.
   *
   * With **Settings → AutoFill & Passwords** on, iOS covers every
   * `textContentType="newPassword"` field with its "Automatic Strong Password" view and
   * swallows the keystrokes. Flow 4 then submits a short password and reddens on the
   * password *length* — a red that names the form and not the cause, 22 minutes into a
   * suite. This turns that into a ten-second failure carrying the real reason.
   *
   * **The toggle is machine-local and it comes back.** A `simctl erase` resets it
   * (2026-09-17, which cost a `pnpm release beta`), and so did installing the iOS 26.5
   * runtime (2026-09-08). It is in no preference plist, so the Settings UI is the only
   * reader — hence a Maestro flow rather than a `defaults read`.
   *
   * Under `--provision` the flow turns it off rather than only reporting it, the same
   * bargain the rest of provisioning makes: the harness owns the device, so a precondition
   * it can satisfy itself is not a verdict.
   */
  preflight(ctx, provision) {
    const check = run(maestro, [
      "--udid",
      ctx.device,
      "test",
      "-e",
      `FIX=${provision ? "true" : "false"}`,
      IOS_AUTOFILL_FLOW,
    ]);
    if (check.status === 0) return { ok: true };
    if (provision) {
      const said = `${check.stdout ?? ""}${check.stderr ?? ""}`
        .trim()
        .split("\n");
      return {
        ok: false,
        detail:
          "could not turn off Settings → AutoFill & Passwords on this simulator. Maestro said:\n" +
          said.slice(-12).join("\n") +
          `\non screen: ${onScreen(ctx.device)}`,
      };
    }
    return {
      ok: false,
      detail:
        "Settings → AutoFill & Passwords is on for this simulator, so iOS would swallow " +
        "the passwords Flow 4 types and redden on the password length instead. Turn it " +
        "off in the simulator: Settings → General → AutoFill & Passwords. Or re-run with " +
        "--provision, which turns it off for you.",
    };
  },

  stop: (ctx) => run("xcrun", ["simctl", "terminate", ctx.device, APP_ID]),

  shutdown: (ctx) => run("xcrun", ["simctl", "shutdown", ctx.device]),

  /**
   * Load the JS bundle the same way Android does — by deep link — and then wait for home.
   *
   * **This used to reconnect through the dev-launcher's "Continue", and that was the most
   * machine-dependent thing in the harness.** "Continue" reopens the *last dev server this
   * simulator loaded*, which expo-dev-launcher records as an absolute URL —
   * `http://192.168.1.16:8081`, the Mac's LAN address at the time. Come back on a new DHCP
   * lease and that address answers nothing: the dev client falls back to showing the
   * launcher, no "Continue" is on screen at all, and `prepare` spends its whole budget
   * before failing with "the app's home screen never appeared". Nothing in that failure
   * points at the machine's IP having changed, and it recurs every time the network does.
   * Caught 2026-08-31 with `.16` and `.42` remembered and the host on `.9`.
   *
   * `DEV_CLIENT_LINK` names `localhost`, which a simulator resolves to the host, so this
   * is the same address on every machine and every network — the property that made the
   * Android path stable. **The old blocker is gone**: an `xcrun simctl openurl` deep link
   * was rejected here on 2026-07-18 (a SpringBoard "Open in Leapsake?" confirm, and the
   * launcher ignoring the `?url=` behind it); re-verified 2026-08-31 on the same
   * simulator, it now launches the app straight onto home with no confirm.
   *
   * The Maestro helper still runs after it — it clears whatever overlay a dev client can
   * still raise and waits for the Search tab, so its exit 0 is the "home reached" signal.
   * What it no longer does is `launchApp`, which force-stops first and would throw away
   * the load this link just performed.
   */
  async prepare(ctx) {
    const ready = await maestroReady(ctx.device);
    if (!ready.ok) return ready;
    // Also covers a simulator someone else booted, where `boot` never ran.
    settleSimulator(ctx.device);
    settleDevMenuIos(ctx.device);
    console.log("  loading JS bundle into the dev client…");
    run("xcrun", ["simctl", "openurl", ctx.device, DEV_CLIENT_LINK]);
    const prep = run(maestro, ["--udid", ctx.device, "test", IOS_PREPARE_FLOW]);
    if (prep.status === 0) return { ok: true };
    return {
      ok: false,
      detail:
        `the app's home screen never appeared after opening ${DEV_CLIENT_LINK}. Check the ` +
        "Metro output for a bundling error, and that the installed build is the current " +
        "dev client:\n    pnpm --filter @leapsake/mobile ios\n" +
        `on screen: ${onScreen(ctx.device)}`,
    };
  },
};

const DRIVERS = { android: androidDriver, ios: iosDriver };

// --- run one platform ------------------------------------------------------------

/**
 * A flow's **out-of-band half**: read the app's own bytes and say whether they match what
 * it just claimed on screen.
 *
 * Why any of this exists: every Maestro assertion reads the accessibility tree, so a build
 * that rendered "your data is encrypted" and encrypted nothing would pass the entire suite
 * green. A flow opts in by carrying a `custody` function
 * (`scripts/test-e2e.mjs`); the checks themselves live in `lib/custody-assertions.mjs`,
 * away from the plumbing and where they can be tested without a device.
 *
 * **A platform that cannot answer says so.** Without an `appDataRoot` this prints and
 * returns green — never a silent skip (principle #6: not reachable here is a thing to
 * report), and never a red, because Android's inability to hand over a container path is
 * not a defect in the build under test.
 *
 * @returns `undefined` when the bytes agree, else the report to fail the platform with.
 */
function runCustody(driver, ctx, flow) {
  if (!flow.custody) return undefined;
  if (!driver.appDataRoot) {
    console.log(
      `  ⚠ out-of-band custody: not asserted on ${driver.label} — no app data-container path`,
    );
    return undefined;
  }
  const root = driver.appDataRoot(ctx);
  if (!root.ok) return root.detail;

  const failure = flow.custody(root.path);
  if (failure) console.log("  ✖ out-of-band custody: FAILED");
  else
    console.log(
      `  ✓ out-of-band custody: asserted on disk — ${KEY_STORE_NOTE}`,
    );
  return failure;
}

/**
 * Drive a single platform end to end, returning { key, label, status, detail }.
 *
 * Steps 1–4 are the environment; step 5 is the suite's own flows. A suite is an ordered
 * arc — `test:e2e`'s catalog flows share app state, so the first red one ends the
 * platform rather than letting the rest fail as noise against a store that never got the
 * rows they assume.
 */
async function runPlatform(driver, provision, suite) {
  // `ctx` rides along so the caller can shut the device down between platforms — see
  // `runSuite`'s loop and the contention note there.
  const wrap = (status, detail) => ({
    key: driver.key,
    label: driver.label,
    status,
    detail,
    ctx: ctx?.device === undefined ? undefined : ctx,
  });

  // 1. toolchain present + a device booted (else blocked — not reachable here).
  let ctx = driver.detect(provision);
  if (ctx.status === BLOCKED) {
    if (!provision) return wrap(BLOCKED, ctx.detail);
    // Under --provision an un-booted device is a thing to fix, not a verdict. A missing
    // *toolchain* still is one, and stays BLOCKED: `boot()` reports "no emulator binary"
    // and "no AVD defined" the same way, because neither is something this can install.
    console.log(
      `\n→ ${suite.key} — ${driver.label}: preparing the environment`,
    );
    const booted = await driver.boot();
    if (!booted.ok) return wrap(BLOCKED, booted.detail);
    ctx = driver.detect(provision);
    if (ctx.status === BLOCKED) {
      // Booted, and still not visible — that is a broken environment, not an absent one.
      return wrap(
        FAIL,
        `booted, but no device was detected afterwards:\n${ctx.detail}`,
      );
    }
  }

  // Ambiguity, or a `--device=` that matches nothing: a fault to report, not a verdict to
  // guess at. (BLOCKED is handled above; anything else with a status is terminal.)
  if (ctx.status) return wrap(ctx.status, ctx.detail);

  console.log(`\n→ ${suite.key} — ${driver.label} ${suite.what} (Maestro)`);
  console.log(`  device: ${ctx.device}`);

  // 2. device-level preconditions no flow can see for itself.
  //
  // Before the install, because that can spend a native build on a device the catalog was
  // never going to pass on.
  const pre = driver.preflight(ctx, provision);
  if (!pre.ok) return wrap(FAIL, pre.detail);

  // 3. dev-client installed (booted but not installed = broken env → fail).
  if (!driver.installed(ctx)) {
    if (!provision) return wrap(FAIL, driver.installHint);
    if (!driver.install(ctx)) {
      return wrap(
        FAIL,
        `expo run:${driver.key} failed — the build output above says why`,
      );
    }
    if (!driver.installed(ctx)) {
      return wrap(
        FAIL,
        `expo run:${driver.key} reported success but ${APP_ID} is still not installed`,
      );
    }
  }

  // 4. Metro serving (host-side, shared across platforms).
  if (provision) {
    const metro = await ensureMetro();
    if (!metro.ok) return wrap(FAIL, metro.detail);
  } else if (!(await metroReachable())) {
    return wrap(
      FAIL,
      `Metro dev server is not reachable at ${METRO_URL}. Start it with:\n` +
        "    pnpm --filter @leapsake/mobile dev",
    );
  }

  // 5. wipe the app back to a genuine first run, from outside the app.
  //
  // **This is what makes a run's verdict independent of the run before it.** The catalog
  // is an ordered arc whose flows share state, and it ends on Flow 4 — an account, an
  // encrypted store, keys in the keychain. Without this the next run starts there, takes
  // the other branch through `subflows/factory-reset.yaml`, and asserts a "first run"
  // against whatever survived; if a run dies with the app wedged, the in-app reset cannot
  // even be driven. Wiping from the outside costs a second and removes the whole class.
  //
  // It runs *before* `prepare` for two reasons: Android's `pm clear` takes the dev-menu
  // prefs with it and `prepare` is what writes them back, and both platforms need the app
  // stopped, which each wipe does for itself.
  //
  // The flows' own `factory-reset` subflow stays where it is. It is not redundant: it is
  // the only thing that exercises the in-app erase, and Flow 1 is where a build that
  // stopped erasing would have to show up.
  const wiped = driver.wipe(ctx);
  if (!wiped.ok) return wrap(FAIL, wiped.detail);

  // 6. load the bundle + wait for the app home (platform-specific prepare).
  let prep = await driver.prepare(ctx);
  if (!prep.ok && provision) {
    // The gap `installed()` cannot see: iOS reconnects through the dev-launcher's
    // *remembered* dev server, which is set by launching the dev client — not by
    // installing it. A build that is present but has never been launched against this
    // Metro therefore passes step 2 and then times out here. `expo run:` both installs
    // and launches, so running it once is the repair; incremental, so it is cheap when
    // the native side is already built. Once only — a second failure is a real one.
    console.log("  prepare failed — relaunching the dev client against Metro…");
    if (!driver.install(ctx)) {
      return wrap(FAIL, `expo run:${driver.key} failed:\n${prep.detail}`);
    }
    prep = await driver.prepare(ctx);
  }
  if (!prep.ok) return wrap(FAIL, prep.detail);

  // 7. run the suite's flows in order; the first red one is the verdict.
  //
  // **Stop the app on the way out, however this ended.** A flow that goes red leaves the
  // app running and mid-whatever-it-was-doing, and the next platform is driven on the same
  // host: an Android device left burning a core on the account conversion it was cut off
  // during is a tax on the iOS run that follows, and shows up there as unrelated
  // flakiness — a Maestro `testmanagerd` snapshot timeout, in the run that prompted this.
  // Nothing downstream wants the app left running, and the next run wipes it anyway.
  try {
    for (const flow of suite.flows) {
      console.log(
        `\n  ▸ ${flow.label}  [${flow.file.replace(MAESTRO_DIR, "…")}]\n`,
      );
      const started = Date.now();
      const status = runMaestroFlow(ctx.device, flow.file);
      console.log(
        `  ${status === 0 ? "✓" : "✗"} ${flow.label} ${seconds(started)}`,
      );
      if (status !== 0) {
        const crashed = driver.crashes?.(ctx) ?? "";
        return wrap(
          FAIL,
          `flow RED: ${flow.label} (${flow.file})\n` +
            `on screen: ${onScreen(ctx.device)}` +
            (crashed ? `\nthe app crashed:\n${crashed}` : ""),
        );
      }
      const custody = runCustody(driver, ctx, flow);
      if (custody) {
        return wrap(FAIL, `custody RED after ${flow.label}:\n${custody}`);
      }
    }
    return wrap(PASS);
  } finally {
    driver.stop(ctx);
  }
}

// --- CLI + aggregation -----------------------------------------------------------

/**
 * The whole CLI for a mobile tier: parse the flags, check Maestro, run the selected
 * platforms, print the summary, and exit with the aggregated code.
 *
 * A suite is `{ key, title, what, flows }` — `key` names the pnpm script in messages,
 * `what` completes "<platform> <what> (Maestro)", and `flows` is the ordered arc.
 */
export async function runSuite(suite) {
  const args = process.argv.slice(2);
  const platArg = args.find((a) => a.startsWith("--platform="));
  const requested = platArg ? platArg.slice("--platform=".length).trim() : null;
  // `--device=<serial|udid|name>` pins which booted device to drive, overriding
  // LEAPSAKE_E2E_DEVICE. Both drivers read it through `resolveOneDevice`, and it only
  // matters when more than one device is booted — see the "which device" section.
  const deviceArg = args.find((a) => a.startsWith("--device="));
  if (deviceArg) devicePin = deviceArg.slice("--device=".length).trim() || null;
  if (requested && !DRIVERS[requested]) {
    console.error(
      `\n✖ ${suite.key} — unknown --platform="${requested}". Use ios or android.\n`,
    );
    process.exit(2);
  }

  // Maestro drives every platform; if it's missing nothing can run → blocked (exit 3).
  if (!maestroPresent()) {
    console.error(
      `\n⏳ ${suite.key} — Maestro not found (BLOCKED). Install it with:\n` +
        '    curl -Ls "https://get.maestro.mobile.dev" | bash\n' +
        "  then restart your shell (or ensure ~/.maestro/bin is on PATH).\n",
    );
    process.exit(3);
  }

  // No flag = attempt both platforms and let each self-classify, so an un-booted simulator
  // shows as BLOCKED rather than being silently skipped (principle #6).
  const selected = requested
    ? [DRIVERS[requested]]
    : [androidDriver, iosDriver];

  // --provision: prepare whatever is missing rather than reporting it. Off by default —
  // see the provisioning section. `pnpm release` passes it; the inner loop does not.
  const provision = args.includes("--provision");

  // Name the cost when we cannot remove it: two device VMs on one Mac make the suite's
  // heaviest waits several times slower (see the loop below for the measurement), and
  // without `--provision` these are the developer's own devices to shut down, not ours.
  if (!provision && selected.length > 1) {
    console.log(
      `\n  note: ${suite.key} drives both platforms, and an emulator and a simulator booted\n` +
        "  together compete for the same cores — enough to turn a slow step red. For the most\n" +
        "  reliable result, run them one at a time with only that platform's device booted:\n" +
        `      pnpm ${suite.key} --platform=android\n` +
        `      pnpm ${suite.key} --platform=ios`,
    );
  }

  // A Metro we started is ours to clean up however this run ends, including Ctrl-C.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopMetroIfStarted();
      process.exit(130);
    });
  }

  // **One device up at a time, when we are the ones who put it there.**
  //
  // The platforms already run in sequence; what did not, until this, was the *hardware*.
  // An Android emulator and an iOS simulator booted together on one Mac are two VMs on the
  // same cores and the same RAM, and the suite's heaviest step is exactly the one that
  // cannot absorb it: Flow 4's account conversion, a 19MiB *memory-hard* Argon2id pass on
  // unJITted Hermes (see `EMULATOR_SIZE` for what host pressure does to it).
  //
  // It is not the whole story — the emulator's own memory mattered more, and is fixed
  // there — but it is a real cost, and it compounds: on 2026-08-31 an Android phase that
  // had been cut off mid-conversion left the app burning a core, and the *iOS* phase after
  // it then died on a Maestro `testmanagerd` snapshot timeout that had nothing to do with
  // iOS. `driver.stop` in `runPlatform` closes that half; this closes the other.
  //
  // So under `--provision` — the unattended path, where the harness booted these devices
  // itself — each platform's device is shut down as soon as its flows are done. **Every
  // platform, including the last**, which is the part that matters across runs: leaving
  // the final device booted is what puts a simulator alongside the *next* run's emulator,
  // and a run that has to reason about what the run before it left booted is the thing
  // this whole pass is trying to remove. Provisioning is now boot → run → shut down.
  //
  // It reverses this file's old "devices are left booted" rule on purpose: that rule
  // traded the next run's boot time against nothing, and a boot is a minute.
  //
  // Without `--provision` the devices are the developer's own, so they are left alone and
  // the cost is named instead (see the warning above).
  const results = [];
  for (const driver of selected) {
    const result = await runPlatform(driver, provision, suite);
    results.push(result);
    if (provision && result.ctx !== undefined) {
      console.log(`\n  shutting the ${driver.label} device down`);
      await driver.shutdown(result.ctx);
    }
  }
  stopMetroIfStarted();

  // Summary — one line per platform, with the guidance for anything not green.
  const icon = { [PASS]: "✅", [FAIL]: "❌", [BLOCKED]: "⏳" };
  const word = { [PASS]: "PASS", [FAIL]: "FAIL", [BLOCKED]: "BLOCKED" };
  console.log(`\n${"─".repeat(48)}`);
  console.log(suite.title);
  console.log("─".repeat(48));
  for (const r of results) {
    console.log(`${icon[r.status]}  ${word[r.status].padEnd(8)} ${r.label}`);
    if (r.detail) {
      for (const line of r.detail.split("\n")) console.log(`      ${line}`);
    }
  }
  console.log("─".repeat(48));

  // Aggregate: any fail → 1; else any pass → 0; else all blocked → 3.
  if (results.some((r) => r.status === FAIL)) process.exit(1);
  if (results.some((r) => r.status === PASS)) process.exit(0);
  process.exit(3);
}
