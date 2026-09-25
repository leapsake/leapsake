// The testing-trophy orchestrator — the single harness that runs every automated tier
// this machine can reach and prints one combined verdict.
//
// It owns the *tier registry* (below): each layer of the trophy maps to a `pnpm test:*`
// script (the scripts stay the source of truth for *how* a tier runs; this file decides
// *which* tiers run and *reports* the result). Tiers marked `blocked` are gates that
// aren't built yet (currently just E2E — the mobile native tiers are built and `ready`) —
// they are surfaced as ⏳ BLOCKED, never silently skipped, so principle #6 ("everything
// reachable, or explicitly blocked — not waived") stays visible. See CONTRIBUTING.md →
// Testing for the principles this registry answers to.
//
// Two kinds of BLOCKED, both ⏳: *statically* blocked (a tier not built yet, e.g. e2e) and
// *runtime* blocked (a built tier whose environment isn't reachable here — e.g. the iOS
// native tier when no simulator is booted). The mobile native tiers run per platform
// (`pnpm test:native --platform=<x>`) and report the latter via **exit code 3**; this file
// maps a ready tier's child exit code 0 → PASS, 3 → BLOCKED (not a failure), anything else
// → FAIL. So `pnpm test:all` shows each platform's reachable-or-blocked status explicitly
// instead of hiding an un-booted platform inside one aggregate row.
//
// Usage:
//   node scripts/test-all.mjs                 all ready tiers + report blocked ones (⏳)
//   node scripts/test-all.mjs --fast          static + node only (skip native/e2e rows)
//   node scripts/test-all.mjs --only=lint,node   just those tiers (by key)
//   node scripts/test-all.mjs --strict        a BLOCKED tier fails the run (release-gate mode)
//   node scripts/test-all.mjs --provision     device tiers prepare their own environment
//   node scripts/test-all.mjs --platforms=ios device tiers for those platforms only
//
// Exit code: non-zero if any *ready* tier failed, if `--only` names a blocked tier, or if
// `--strict` and any blocked tier was in scope. Blocked tiers otherwise don't fail the run.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// layer = the trophy layer this proves; key = CLI selector; script = the pnpm script to run.
// device = true marks the emulator/simulator/native-host tiers (mobile native + E2E):
// they need a booted device beyond the Node process, so `--fast` (the inner loop, `pnpm
// test`) skips them regardless of ready/blocked. `pnpm test:all` still runs them. This is
// what keeps `pnpm test` fast now that `native` is built (`ready`) rather than `blocked`.
export const TIERS = [
  {
    key: "format",
    layer: "static",
    label: "format",
    script: "test:format",
    status: "ready",
  },
  {
    key: "lint",
    layer: "static",
    label: "lint",
    script: "test:lint",
    status: "ready",
  },
  {
    key: "typecheck",
    layer: "static",
    label: "typecheck",
    script: "test:types",
    status: "ready",
  },
  {
    // Cheap, but it guards something the other static tiers can't see: a version bump
    // that missed a manifest is invisible until an artifact ships with the wrong number
    // on it, and store versions are permanent and monotonic (CONTRIBUTING.md ->
    // Versioning and releases).
    key: "versions",
    layer: "static",
    label: "version agreement (one version across every manifest)",
    script: "test:versions",
    status: "ready",
  },
  {
    // Same shape of guard as `versions`, for the same reason: the app icons are generated
    // from one SVG and committed, so the failure mode is a source edit that never got
    // re-rendered — invisible until a store listing wears the old face. Compares hashes
    // rather than re-rendering, so it needs no rasterizer and stays a static tier.
    key: "icons",
    layer: "static",
    label: "icon agreement (every raster matches its source in assets/icon/)",
    script: "test:icons",
    status: "ready",
  },
  {
    // A third guard of the same family as `versions` and `icons`: what it protects is
    // a *public URL*. A slug in a markdown file's frontmatter publishes it to
    // leapsake.com, so a renamed slug silently moves a page that links already point
    // at — and nothing else in the repo would notice.
    key: "docs",
    layer: "static",
    label: "docs manifest (every published slug is recorded)",
    script: "test:docs",
    status: "ready",
  },
  {
    // The fourth guard of the `versions`/`icons`/`docs` family, and the one with the
    // longest memory: it reads every blob ever committed, because a secret deleted in the
    // next commit is still in the history forever. `network: true` keeps it out of the
    // inner loop — it wants the pinned gitleaks binary, and 4s is too slow for `pnpm test`
    // — but `pnpm test:all` runs it, and `--strict` fails the release if it could not run
    // at all. See scripts/secret-scan.mjs for the two modes; this is the cheap one.
    key: "secrets",
    layer: "static",
    label: "secret scan (no credentials anywhere in git history)",
    script: "test:secrets",
    status: "ready",
    network: true,
  },
  {
    key: "node",
    layer: "unit + integration",
    label: "unit + integration (vitest, real desktop engine)",
    script: "test:node",
    status: "ready",
  },
  {
    key: "coverage",
    layer: "driver-contract forcer",
    label: "driver coverage gate (contract forces 100% of the driver)",
    script: "test:coverage",
    status: "ready",
  },
  {
    // The React-dedupe guard. It belongs here and not in `static` because it needs a real
    // renderer build: the only faithful signal for "one React in the bundle" is the
    // sourcemap's source list, since on-disk resolution legitimately sees two copies that
    // the bundler collapses (apps/desktop/scripts/check-single-react.mjs).
    //
    // It is ordered after the vitest tiers because it is the one static-ish tier that
    // does a real build (~2s) rather than reading files. Note that it does *not* flip the
    // native SQLite binary to the Electron ABI the way `pnpm dev` does — measured, not
    // assumed: electron-vite externalizes `better-sqlite3-multiple-ciphers` and never
    // loads it, so the binary is untouched and the vitest tiers are safe either side.
    key: "bundle",
    layer: "static",
    label: "renderer bundle (exactly one react + one react-dom)",
    script: "test:bundle",
    status: "ready",
  },
  {
    key: "native-android",
    layer: "mobile native",
    label: "mobile driver-contract — Android (Maestro, emulator)",
    script: "test:native",
    args: ["--platform=android"],
    status: "ready",
    device: true,
    platforms: ["android"],
    // Needs a prepared Android environment (booted emulator + installed dev client +
    // running Metro); `pnpm test:native` (scripts/test-native.mjs) exits 3 (→ BLOCKED)
    // if no emulator is booted, and fails with the exact setup command if the dev client
    // or Metro is missing.
  },
  {
    key: "native-ios",
    layer: "mobile native",
    label: "mobile driver-contract — iOS (Maestro, simulator)",
    script: "test:native",
    args: ["--platform=ios"],
    status: "ready",
    device: true,
    platforms: ["ios"],
    // Same shape as Android on a booted iOS simulator; exits 3 (→ BLOCKED) when no sim
    // is booted or Xcode's simctl is absent (e.g. a non-macOS host), so the iOS gate is
    // reported as blocked-here, never silently skipped.
  },
  {
    key: "e2e",
    layer: "E2E",
    label: "crucial-flow catalog (Maestro, iOS + Android)",
    script: "test:e2e",
    status: "ready",
    device: true,
    platforms: ["ios", "android"],
    // The whole `beta` bar, doors included (CONTRIBUTING.md → *The E2E release gate*, its
    // rung table), plus `rc`'s out-of-band custody assertions on Flows 1 and 4. What `rc` still owes is the key-store row, deferred (see
    // `lib/custody-assertions.mjs`); 6/7a ship with sync. Green and re-runnable on both
    // the iOS simulator and the Android emulator. An un-booted device reports BLOCKED via
    // exit 3, which --strict treats as a failure.
    //
    // Note `test:e2e` is `scripts/test-e2e.mjs`, NOT `test-all --only=e2e`: the tier's
    // own script running the orchestrator would loop, exactly as test-native.mjs's
    // header describes for the native tiers.
  },
];

const listArg = (args, name) => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return null;
  return new Set(
    arg
      .slice(name.length + 3)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
};

/** The tiers a run covers. `--platforms` drops device tiers for no listed platform. */
export function selectTiers(tiers, { only, fast, platforms }) {
  let selected = tiers;
  if (only) selected = selected.filter((t) => only.has(t.key));
  // --fast = the inner loop: ready tiers that need nothing beyond this Node process —
  // no device (emulator/simulator/native host) and no network (the secret scan fetches its
  // pinned scanner on first use). `--only` overrides, so either can be forced by key.
  else if (fast)
    selected = selected.filter(
      (t) => t.status === "ready" && !t.device && !t.network,
    );
  if (platforms) {
    selected = selected.filter(
      (t) => !t.platforms || t.platforms.some((p) => platforms.has(p)),
    );
  }
  return selected;
}

/** What a tier's script is passed: its own args, `--provision`, and one `--platform` of several. */
export function argsFor(tier, { provision, platforms }) {
  const covered = (tier.platforms ?? []).filter(
    (p) => !platforms || platforms.has(p),
  );
  const narrowed =
    tier.platforms?.length > 1 && covered.length === 1
      ? [`--platform=${covered[0]}`]
      : [];
  return [
    ...(tier.args ?? []),
    ...narrowed,
    ...(provision && tier.device ? ["--provision"] : []),
  ];
}

// Each tier runs its own `pnpm run <script>`. `pnpm` is resolved from PATH (shell:true on
// Windows so `pnpm.cmd` is found); every dev running this already has pnpm on PATH. Extra
// args (e.g. `--platform=ios`) are forwarded to the script after `--` so pnpm passes them
// through rather than parsing them as its own flags.
const spawnPnpm = (script, extra = []) =>
  spawnSync(
    "pnpm",
    ["run", script, ...(extra.length ? ["--", ...extra] : [])],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

function main(args) {
  const fast = args.includes("--fast");
  const strict = args.includes("--strict");
  // Forwarded to the `device: true` tiers, which are the only ones with an environment to
  // prepare. See scripts/lib/mobile-harness.mjs → provisioning. `pnpm release` passes this so a
  // release is one command; the inner loop leaves it off and gets the faster failure.
  const provision = args.includes("--provision");
  const only = listArg(args, "only");
  const platforms = listArg(args, "platforms");

  if (only) {
    const known = new Set(TIERS.map((t) => t.key));
    const unknown = [...only].filter((k) => !known.has(k));
    if (unknown.length > 0) {
      console.error(`unknown tier(s): ${unknown.join(", ")}`);
      console.error(`known tiers: ${TIERS.map((t) => t.key).join(", ")}`);
      return 2;
    }
  }
  if (platforms) {
    const known = new Set(TIERS.flatMap((t) => t.platforms ?? []));
    const unknown = [...platforms].filter((p) => !known.has(p));
    if (unknown.length > 0) {
      console.error(`unknown platform(s): ${unknown.join(", ")}`);
      console.error(`known platforms: ${[...known].join(", ")}`);
      return 2;
    }
  }

  const selected = selectTiers(TIERS, { only, fast, platforms });

  const results = [];
  for (const tier of selected) {
    if (tier.status === "blocked") {
      // `--only=<blocked>` means the dev explicitly asked for a tier that isn't built:
      // that's a hard failure. Otherwise a blocked tier is reported, not run.
      const failed = strict || (only && only.has(tier.key));
      console.log(`\n⏳ ${tier.label} — BLOCKED (${tier.note})`);
      results.push({
        tier,
        status: failed ? "blocked-fail" : "blocked",
        ms: 0,
      });
      continue;
    }
    const extra = argsFor(tier, { provision, platforms });
    const argStr = extra.length ? ` ${extra.join(" ")}` : "";
    console.log(`\n→ ${tier.label}  [pnpm ${tier.script}${argStr}]`);
    const start = Date.now();
    const run = spawnPnpm(tier.script, extra);
    const ms = Date.now() - start;
    // A ready tier's child exit code: 0 = pass, 3 = runtime-blocked (environment not
    // reachable here, e.g. no device booted — reported ⏳, not a failure), else fail. Only
    // the mobile native tiers currently emit 3; the others only ever exit 0 or non-zero.
    // `--strict` (release-gate) upgrades a runtime-blocked tier to a failure, mirroring how
    // statically-blocked tiers are treated under --strict.
    if (run.status === 3) {
      results.push({ tier, status: strict ? "blocked-fail" : "blocked", ms });
    } else {
      results.push({ tier, status: run.status === 0 ? "pass" : "fail", ms });
    }
  }

  // Summary
  const icon = { pass: "✅", fail: "❌", blocked: "⏳", "blocked-fail": "❌" };
  const word = {
    pass: "PASS",
    fail: "FAIL",
    blocked: "BLOCKED",
    "blocked-fail": "BLOCKED",
  };
  const nameW = Math.max(...results.map((r) => r.tier.label.length), 8);
  console.log(`\n${"─".repeat(nameW + 22)}`);
  console.log("Testing trophy — summary");
  console.log("─".repeat(nameW + 22));
  for (const r of results) {
    const time = r.ms ? `${(r.ms / 1000).toFixed(1)}s` : "";
    console.log(
      `${icon[r.status]}  ${word[r.status].padEnd(8)} ${r.tier.label.padEnd(nameW)}  ${time}`,
    );
  }
  console.log("─".repeat(nameW + 22));

  const failed = results.filter(
    (r) => r.status === "fail" || r.status === "blocked-fail",
  );
  const blocked = results.filter((r) => r.status === "blocked");
  if (blocked.length > 0) {
    console.log(
      `⏳ ${blocked.length} tier(s) blocked (not built yet, or environment not reachable here) — see CONTRIBUTING.md → Testing. Not counted as failure${strict ? " but --strict is on, so they fail this run" : ""}.`,
    );
  }
  if (failed.length > 0) {
    console.log(`❌ ${failed.length} tier(s) failed.`);
    return 1;
  }
  console.log("✅ all ready tiers passed.");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
