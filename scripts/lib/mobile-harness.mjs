// The mobile test harness: environment prep for Maestro on a booted device.
// See `apps/mobile/maestro/README.md` → _What the harness does_.
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
// Tells the dev client to load Metro at `localhost`, which never goes stale the
// way the launcher's remembered LAN address does.
const DEV_CLIENT_LINK = `${SCHEME}://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MAESTRO_DIR = join(ROOT, "apps", "mobile", "maestro");
const IOS_PREPARE_FLOW = join(MAESTRO_DIR, "ios-prepare.yaml"); // iOS bundle-load helper
const NO_CONSOLE_ERROR_FLOW = join(
  MAESTRO_DIR,
  "subflows",
  "no-console-error.yaml",
);
const IOS_AUTOFILL_FLOW = join(MAESTRO_DIR, "ios-autofill.yaml"); // iOS AutoFill preflight

// The emulator's size, overriding its AVD. Lower it only against a measurement;
// see the README's _Budget the waits for the emulator_.
const EMULATOR_SIZE = ["-cores", "6", "-memory", "8192"];

/** Linux with no display: boot without a window, on software GL. */
const EMULATOR_HEADLESS =
  process.platform === "linux" && !process.env.DISPLAY
    ? ["-no-window", "-no-audio", "-gpu", "swiftshader_indirect"]
    : [];

const HOME_TIMEOUT_MS = 180_000; // budget for the first Metro bundle build → app home
const BOOT_TIMEOUT_MS = 300_000; // budget for a cold emulator/simulator boot
const METRO_TIMEOUT_MS = 120_000; // budget for `expo start` → packager-status:running
const SHUTDOWN_TIMEOUT_MS = 60_000; // budget for an emulator to leave `adb devices`
const INSTALL_TIMEOUT_MS = 60 * 60_000; // budget for a cold `expo run:<platform>` build

// Per-platform outcomes, aggregated into the exit code at the end.
export const PASS = "pass"; // device booted, flows green
export const FAIL = "fail"; // device booted, but a flow went RED or env broken → exit 1
export const BLOCKED = "blocked"; // not reachable here (no device / no toolchain) → exit 3

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seconds = (since) => `${((Date.now() - since) / 1000).toFixed(0)}s`;

/** Turns Android's window animations off, so a tap never lands on a moving
 *  screen; best-effort. */
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

// Which device: exactly one, pinned by `--device` or the environment, else
// refused rather than guessed; under --provision the extras shut down.

/** The device pin, if any, set by {@link runSuite} before detection. */
let devicePin = process.env.LEAPSAKE_E2E_DEVICE?.trim() || null;

/** Reduces the booted `[{ id, label }]` to one `{ device }`, the pin matching
 *  either field, or a `{ status, detail }` saying why not. */
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

  // Unattended, keep the first and shut the rest down rather than stop to ask.
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

// Shared: maestro and Metro

// `~/.maestro/bin` first, as only login shells get it on PATH.
function resolveMaestro() {
  const p = join(homedir(), ".maestro", "bin", "maestro");
  if (existsSync(p)) return p;
  return "maestro";
}
const maestro = resolveMaestro();

const maestroPresent = () => run(maestro, ["--version"]).status === 0;

// Whether Metro serves the dev client, probed once a run: one host Metro serves
// every platform.
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

/** The text and ids in a Maestro hierarchy, for a failure to report. */
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

/** Waits until Maestro can open a session on `device`, so the first flow does
 *  not take the blame for Maestro's own setup. */
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

// Provisioning: under --provision the harness runs what it would otherwise
// name, and stops only what it started. See the maestro README.

/** The Metro we spawned, if any; never one that was already serving. */
let metroStarted = null;

/** Starts Metro unless it is serving, then polls `/status`, since `expo start`
 *  returns long before the packager answers. */
async function ensureMetro() {
  // A memoized `false` may be stale: `expo run` starts a dev server of its own.
  if (metroCache !== true) metroCache = undefined;
  if (await metroReachable()) return { ok: true };

  console.log("  starting Metro (expo start --dev-client)…");
  // Detached, so its group can be signalled: Expo's workers outlive it.
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

/** Kills a Metro this script started, never one that was already serving. */
function stopMetroIfStarted() {
  if (!metroStarted) return;
  const { pid } = metroStarted;
  metroStarted = null;
  // A negative pid signals the whole process group.
  try {
    process.kill(-pid, "SIGTERM");
    console.log("\n  stopped the Metro this run started");
  } catch {
    // Already gone, which is what we wanted.
  }
}

/** Builds and installs the dev client on one named device, streaming output;
 *  the release prebuilds `ios/` afresh afterwards. */
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
      // Or `expo run` starts its own Metro and never exits.
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

// Android driver

// `adb` from ANDROID_HOME or ANDROID_SDK_ROOT, else PATH.
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

/** What `expo run:android --device` calls a serial: an emulator's AVD, or a
 *  phone's model; the serial itself if unmapped. */
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

/** `emulator` from the SDK, else PATH, as `adb` resolves. */
function resolveEmulator() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const p = join(sdk, "emulator", "emulator");
    if (existsSync(p)) return p;
  }
  return "emulator";
}

// The three dev-menu prefs a fresh install gets wrong, written with the app
// stopped; see the maestro README on the floating menu button.
const DEV_MENU_PREFS = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <boolean name="isOnboardingFinished" value="true" />
    <boolean name="showsAtLaunch" value="false" />
    <boolean name="showFab" value="false" />
</map>
`;
const DEV_MENU_PREFS_PATH =
  "shared_prefs/expo.modules.devmenu.sharedpreferences.xml";

// Best-effort: a failure costs flakiness, not correctness, so it only warns.
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

/** Every installed package claiming `leapsake://`; more than one raises a
 *  chooser no flow can get past. */
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

  // A terminal { status, detail }, or { device } to proceed.
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
    // Exactly one, named by AVD or model as a developer knows them.
    const chosen = resolveOneDevice({
      // Emulators first, so --provision never keeps a plugged-in phone.
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

  // Boots the first AVD and waits for `sys.boot_completed`: adb answers long
  // before the framework is up.
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
    // An AVD name has no whitespace, unlike the odd INFO banner.
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

    // `-wipe-data`, so every provisioned run starts as a CI runner's does.
    console.log(`  wiping and booting the Android emulator (${avd})…`);
    const child = spawn(
      emulator,
      ["-avd", avd, "-wipe-data", ...EMULATOR_SIZE, ...EMULATOR_HEADLESS],
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

  // `pm clear` erases every store, door and secret, and the dev-menu prefs,
  // which `prepare` writes back.
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

  // The AutoFill preflight is iOS-only.
  preflight: () => ({ ok: true }),

  // The head of our tombstone, which says what died; the tail doesn't.
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
    const lines = out.split("\n").filter((line) =>
      // Frames carry a logcat prefix, so match anywhere in the line.
      /signal \d|Abort message|FATAL EXCEPTION|ANR in|Cmdline|#\d\d pc /.test(
        line,
      ),
    );
    return lines.slice(0, 18).join("\n");
  },

  stop: (ctx) =>
    run(ctx.adb, ["-s", ctx.device, "shell", "am", "force-stop", APP_ID]),

  isVirtual: (ctx) => ctx.device.startsWith("emulator-"),

  /** Waits for `emu kill` to finish, so the next tier boots its own. */
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

  // Loads the bundle over adb and waits for home; `{ ok, detail }`.
  async prepare(ctx) {
    const { adb, device } = ctx;
    // Exactly one app may answer `leapsake://`.
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
    // Warn on an undersized emulator someone else booted; it may still pass.
    const cores = Number(
      run(adb, ["-s", device, "shell", "nproc"]).stdout?.trim(),
    );
    // `> 0` too: no `nproc` answers "", which is 0.
    if (Number.isFinite(cores) && cores > 0 && cores < 4) {
      console.warn(
        `  ! this emulator has ${cores} CPU core${cores === 1 ? "" : "s"} — a dev client ` +
          "needs more, and the\n    flows will time out on waits that are not really slow. " +
          "Re-boot it with:\n" +
          `      emulator -avd <name> ${EMULATOR_SIZE.join(" ")}\n` +
          "    or raise the AVD's cores in Android Studio → Device Manager → Edit.",
      );
    }
    // So the emulator reaches the host's Metro at localhost:8081.
    run(adb, [
      "-s",
      device,
      "reverse",
      `tcp:${METRO_PORT}`,
      `tcp:${METRO_PORT}`,
    ]);
    // Also covers a device someone else booted.
    stopAnimations(adb, device);
    // Force-stops the app, so it comes before the launching deep link.
    settleDevMenu(adb, device);
    // A cold launch opens the launcher; the deep link loads the app.
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
    // Home is the Search tab's `testID`, which the launcher lacks, as in
    // `ios-prepare.yaml`; an id survives a label change.
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
      // Tap Wait on an "isn't responding" dialog, so the app can recover.
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

/** What an iOS `.ips` report says died: signal, abort, top frames. */
export function ipsSummary(text, depth = 12) {
  const newline = text.indexOf("\n");
  let body;
  try {
    body = JSON.parse(text.slice(newline + 1));
  } catch {
    return text.match(/"(termination|exception)"[^\n]*/g)?.slice(0, 3) ?? [];
  }
  const images = body.usedImages ?? [];
  const frames = (list = []) =>
    list
      .slice(0, depth)
      .map(
        (frame, index) =>
          `  #${index} ${images[frame.imageIndex]?.name ?? "?"} ` +
          `${frame.symbol ?? `+${frame.imageOffset ?? "?"}`}`,
      );
  const crashed =
    body.threads?.[body.faultingThread] ??
    body.threads?.find((thread) => thread.triggered);
  const exception = body.exception ?? {};
  const lines = [
    `${exception.type ?? "?"} ${exception.signal ?? ""}`.trim(),
    ...Object.entries(body.asi ?? {}).flatMap(([image, messages]) =>
      messages.map((message) => `${image}: ${message}`),
    ),
  ];
  if (body.lastExceptionBacktrace?.length) {
    lines.push("exception backtrace:", ...frames(body.lastExceptionBacktrace));
  }
  if (crashed) {
    const name =
      crashed.name ?? crashed.queue ?? `thread ${body.faultingThread}`;
    lines.push(`crashed thread (${name}):`, ...frames(crashed.frames));
  }
  return lines;
}

/** Where Wait is on an "isn't responding" dialog in a dump, or null. */
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

/** The text and ids in a `uiautomator dump`, for a failure to report. */
export function uiautomatorLabels(dump, limit = 40) {
  const seen = new Set();
  for (const [, key, value] of dump.matchAll(
    /\b(text|content-desc|resource-id)="([^"]+)"/g,
  )) {
    seen.add(key === "resource-id" ? `#${value}` : value);
  }
  return [...seen].slice(0, limit);
}

// iOS driver

/** The model CI measures on; `boot` warns when it runs on anything else. */
const IOS_SIMULATOR =
  process.env.LEAPSAKE_IOS_SIMULATOR?.trim() || "iPhone 17 Pro";

/** Reduce Motion and a frozen status bar, iOS's `stopAnimations`, so no
 *  transition or clock moves under a flow; best-effort. */
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
// Written with the app stopped: a fresh simulator's dev menu opens itself over
// the app, and an explicit value outranks the build's Info.plist default.
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

/** The app's data container, shared by `wipe` and `appDataRoot` so both mean
 *  one directory. ⚠️ Without `data`, it is the bundle. */
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
    // No `xcrun simctl` means no Xcode tools: blocked, not failed.
    if (run("xcrun", ["simctl", "help"]).status !== 0) {
      return {
        status: BLOCKED,
        detail:
          "`xcrun simctl` not found — iOS simulators need Xcode + its command-line tools " +
          "(macOS only). Install Xcode, then `xcode-select --install`.",
      };
    }
    // One line per booted sim: "    <name> (<UDID>) (Booted)".
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

  // Installed exactly when the app has a data container.
  installed(ctx) {
    return (
      run("xcrun", ["simctl", "get_app_container", ctx.device, APP_ID])
        .status === 0
    );
  },

  installHint:
    `the dev-client build (${APP_ID}) is not installed on the simulator. Build + install ` +
    "it with:\n    pnpm --filter @leapsake/mobile ios",

  // Boots an iPhone, as the flows are phone-shaped.
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
    // The pinned model, else any iPhone: a runner image swaps its default.
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

    // Erased, so every provisioned run starts as a CI runner's does.
    console.log(`  erasing and booting the iOS simulator (${name.trim()})…`);
    if (run("xcrun", ["simctl", "erase", udid]).status !== 0) {
      return { ok: false, detail: `could not erase the simulator ${udid}` };
    }
    if (run("xcrun", ["simctl", "boot", udid]).status !== 0) {
      return { ok: false, detail: `could not boot the simulator ${udid}` };
    }
    // Maestro drives the Simulator window, which a headless boot lacks.
    run("open", ["-a", "Simulator"]);
    // `bootstatus -b` blocks until the device is up.
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

  // The newest crash report for our bundle id from the last ten minutes.
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
    return [recent, ...ipsSummary(readFileSync(recent, "utf8"))].join("\n");
  },

  /** `pm clear` by hand: `Documents/SQLite/` and the keychain, with the app
   *  stopped. See the maestro README on the wipe. */
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

  /** Where the stores, doors and roster live, for the custody checks; Android
   *  has none, which is how it declines them. */
  appDataRoot(ctx) {
    const container = iosContainer(ctx.device);
    return container.ok
      ? { ok: true, path: join(container.path, "Documents", "SQLite") }
      : container;
  },

  /** Refuses the catalog while AutoFill would eat typed passwords, or under
   *  --provision turns it off. See the maestro README. */
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

  isVirtual: () => true,

  /** Loads the bundle by the localhost deep link, then lets `ios-prepare.yaml`
   *  clear overlays and wait for home; see the maestro README. */
  async prepare(ctx) {
    const ready = await maestroReady(ctx.device);
    if (!ready.ok) return ready;
    // Also covers a simulator someone else booted.
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

// Run one platform

/**
 * A flow's out-of-band custody check: `undefined` when the app's bytes agree
 * with its screen, else the failure; a platform with no path says so.
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

/** Drives one platform end to end; the first red flow ends it, as the flows
 *  share state. Returns `{ key, label, status, detail }`. */
async function runPlatform(driver, provision, suite) {
  // `ctx` rides along, so the caller can shut the device down.
  const wrap = (status, detail) => ({
    key: driver.key,
    label: driver.label,
    status,
    detail,
    ctx: ctx?.device === undefined ? undefined : ctx,
  });

  // 1. A toolchain and a booted device, else blocked.
  let ctx = driver.detect(provision);
  // Under --provision a booted virtual device restarts clean.
  if (provision && !ctx.status && !devicePin && driver.isVirtual(ctx)) {
    console.log(`  shutting down ${ctx.device} to start it clean`);
    await driver.shutdown(ctx);
    ctx = driver.detect(provision);
  }
  if (ctx.status === BLOCKED) {
    if (!provision) return wrap(BLOCKED, ctx.detail);
    // A missing device is booted; a missing toolchain stays BLOCKED.
    console.log(
      `\n→ ${suite.key} — ${driver.label}: preparing the environment`,
    );
    const booted = await driver.boot();
    if (!booted.ok) return wrap(BLOCKED, booted.detail);
    ctx = driver.detect(provision);
    if (ctx.status === BLOCKED) {
      // Booted yet not visible: a broken environment, not an absent one.
      return wrap(
        FAIL,
        `booted, but no device was detected afterwards:\n${ctx.detail}`,
      );
    }
  }

  // Ambiguity, or a pin matching nothing: reported, never guessed at.
  if (ctx.status) return wrap(ctx.status, ctx.detail);

  console.log(`\n→ ${suite.key} — ${driver.label} ${suite.what} (Maestro)`);
  console.log(`  device: ${ctx.device}`);

  // 2. Device preconditions, before the install can spend a build on them.
  const pre = driver.preflight(ctx, provision);
  if (!pre.ok) return wrap(FAIL, pre.detail);

  // 3. The dev client, always built under --provision: a stale one fails far
  //    from its cause, and the build is incremental.
  if (provision || !driver.installed(ctx)) {
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

  // 4. Metro serving, shared across platforms.
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

  // 5. Wipe to a first run from outside, before `prepare` rewrites the prefs;
  //    see the maestro README on the wipe.
  const wiped = driver.wipe(ctx);
  if (!wiped.ok) return wrap(FAIL, wiped.detail);

  // 6. Load the bundle and wait for home.
  let prep = await driver.prepare(ctx);
  if (!prep.ok && provision) {
    // A build never launched against this Metro can time out here; one
    // `expo run` relaunch repairs it, and a second failure is real.
    console.log("  prepare failed — relaunching the dev client against Metro…");
    if (!driver.install(ctx)) {
      return wrap(FAIL, `expo run:${driver.key} failed:\n${prep.detail}`);
    }
    prep = await driver.prepare(ctx);
  }
  if (!prep.ok) return wrap(FAIL, prep.detail);

  // 7. The flows in order; the app is stopped however this ends, so it can't
  //    burn a core under the next platform.
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
      // Release builds show no LogBox, so logged errors are asserted.
      if (runMaestroFlow(ctx.device, NO_CONSOLE_ERROR_FLOW) !== 0) {
        return wrap(
          FAIL,
          `console.error during ${flow.label}\non screen: ${onScreen(ctx.device)}`,
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

// CLI and aggregation

/** A mobile tier's whole CLI, for a suite `{ key, title, what, flows }`:
 *  `what` completes "<platform> <what> (Maestro)". */
export async function runSuite(suite) {
  const args = process.argv.slice(2);
  const platArg = args.find((a) => a.startsWith("--platform="));
  const requested = platArg ? platArg.slice("--platform=".length).trim() : null;
  // `--device=<serial|udid|name>` overrides LEAPSAKE_E2E_DEVICE.
  const deviceArg = args.find((a) => a.startsWith("--device="));
  if (deviceArg) devicePin = deviceArg.slice("--device=".length).trim() || null;
  if (requested && !DRIVERS[requested]) {
    console.error(
      `\n✖ ${suite.key} — unknown --platform="${requested}". Use ios or android.\n`,
    );
    process.exit(2);
  }

  // Without Maestro nothing can run: blocked.
  if (!maestroPresent()) {
    console.error(
      `\n⏳ ${suite.key} — Maestro not found (BLOCKED). Install it with:\n` +
        '    curl -Ls "https://get.maestro.mobile.dev" | bash\n' +
        "  then restart your shell (or ensure ~/.maestro/bin is on PATH).\n",
    );
    process.exit(3);
  }

  // No flag tries both, so an un-booted one shows as BLOCKED, not skipped.
  const selected = requested
    ? [DRIVERS[requested]]
    : [androidDriver, iosDriver];

  // `pnpm release` passes it; the inner loop does not.
  const provision = args.includes("--provision");

  // The developer's own devices: name the cost of two booted, don't fix it.
  if (!provision && selected.length > 1) {
    console.log(
      `\n  note: ${suite.key} drives both platforms, and an emulator and a simulator booted\n` +
        "  together compete for the same cores — enough to turn a slow step red. For the most\n" +
        "  reliable result, run them one at a time with only that platform's device booted:\n" +
        `      pnpm ${suite.key} --platform=android\n` +
        `      pnpm ${suite.key} --platform=ios`,
    );
  }

  // A Metro we started is ours to clean up, Ctrl-C included.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopMetroIfStarted();
      process.exit(130);
    });
  }

  // Under --provision each device shuts down when its flows end, the last too;
  // see the maestro README's _Do not leave both devices booted at once_.
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

  // One summary line per platform, with guidance for anything not green.
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

  // Any fail is 1; else any pass is 0; else all blocked is 3.
  if (results.some((r) => r.status === FAIL)) process.exit(1);
  if (results.some((r) => r.status === PASS)) process.exit(0);
  process.exit(3);
}
