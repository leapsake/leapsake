// The testing-trophy orchestrator: every reachable tier, one verdict. Its flags
// and exit codes are in `CONTRIBUTING.md` → _Testing_.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `layer` is what a tier proves, `key` its selector, `script` its pnpm script;
// `device` tiers need a booted device, so `--fast` skips them.
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
    // A version bump that missed a manifest, invisible until it ships.
    key: "versions",
    layer: "static",
    label: "version agreement (one version across every manifest)",
    script: "test:versions",
    status: "ready",
  },
  {
    // An icon source edit never re-rendered; hashes, so no rasterizer.
    key: "icons",
    layer: "static",
    label: "icon agreement (every raster matches its source in assets/icon/)",
    script: "test:icons",
    status: "ready",
  },
  {
    // A renamed doc slug silently moving a public page.
    key: "docs",
    layer: "static",
    label: "docs manifest (every published slug is recorded)",
    script: "test:docs",
    status: "ready",
  },
  {
    // A secret anywhere in history; `network`, as it fetches its scanner.
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
    // One React, from a real renderer build's sourcemap; it leaves the SQLite
    // ABI alone, so it may run on either side of Vitest.
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
    // Exits 3 with no emulator booted; names the setup command otherwise.
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
    // Exits 3 with no simulator booted or no Xcode.
  },
  {
    key: "e2e",
    layer: "E2E",
    label: "crucial-flow catalog (Maestro, iOS + Android)",
    script: "test:e2e",
    status: "ready",
    device: true,
    platforms: ["ios", "android"],
    // The crucial-flow catalog; its own script, as calling the orchestrator
    // back would loop.
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

/** The tiers a run covers; `--platforms` drops other platforms' devices. */
export function selectTiers(tiers, { only, fast, platforms }) {
  let selected = tiers;
  if (only) selected = selected.filter((t) => only.has(t.key));
  // --fast: tiers needing no device or network; `--only` can force either.
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

/** A tier's arguments: its own, `--provision`, and one `--platform`. */
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

// `pnpm run <script> -- <args>`, so pnpm forwards the args; the shell on
// Windows finds `pnpm.cmd`.
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
  // For device tiers only; `pnpm release` passes it, the inner loop doesn't.
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
      // Asking for an unbuilt tier by name fails; otherwise it is reported.
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
    // Exit 3 is blocked here, not failed, unless `--strict`.
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
