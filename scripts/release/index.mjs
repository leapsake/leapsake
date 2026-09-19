// The release command: a dispatcher over the phases in `phases.mjs`.
//
// A release is a tag. Manifests carry only the core, set by `scripts/set-version.mjs`; the
// tag carries the channel and counter (`v0.1.0-beta.10`). alpha, beta and rc count up
// independently per core, and a final closes it. Every command takes the tag it acts on.
//
//   pnpm release plan --tag=<tag> [--json] [--no-checks]
//   pnpm release gate --platforms=<ios,android> [--tag=<tag>] [--no-provision]
//   pnpm release build --tag=<tag> --only=<target> --build-number=<n> --out=<dir>
//   pnpm release publish --tag=<tag> --from=<dir> [--only=<targets>] [--receipts-out=<dir>]
//   pnpm release record --tag=<tag> --from=<dir> [--push]
//   pnpm release abandon --tag=<tag>
//   pnpm release ship --tag=<tag> [--dry-run] [--no-provision]
//   pnpm release --help
//
// Also: `--first-release` when the repo has no release tags yet, and `--commit=<sha>` to name
// the live commit by hand for a marker rung. Credentials come from `.env` or the environment,
// which wins. Exit code: 2 for a usage error, 1 for a refused or failed step, 0 otherwise.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runChecks } from "./checks.mjs";
import { currentBranch, isClean, isShallow, listTags, tagSha } from "./git.mjs";
import {
  abandonTag,
  buildInto,
  buildNumberNow,
  evaluateCells,
  planJson,
  publishAll,
  receiptsIn,
  recordReceipts,
} from "./phases.mjs";
import { BUILD_CHECKS, FROM_TAG_CHECKS, MARKER_CHECKS } from "./preflight.mjs";
import { NOTES_REF } from "./receipts.mjs";
import { TARGETS, targetById } from "./targets/index.mjs";
import { coreOf, parseTag, stageOf, STAGES } from "./version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMANDS = [
  "plan",
  "gate",
  "build",
  "publish",
  "record",
  "abandon",
  "ship",
];
const VALUE_FLAGS = new Set([
  "tag",
  "only",
  "commit",
  "build-number",
  "out",
  "from",
  "receipts-out",
  "platforms",
]);

function parseArgs(argv) {
  const positional = [];
  const flags = new Set();
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals !== -1) {
      values[arg.slice(2, equals)] = arg.slice(equals + 1);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (VALUE_FLAGS.has(name) && next && !next.startsWith("--")) {
      values[name] = next;
      i++;
    } else {
      flags.add(name);
    }
  }
  return { positional, flags, values };
}

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(2);
};

function printHelp() {
  const usage = readFileSync(fileURLToPath(import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.startsWith("//   pnpm release"))
    .map((line) => line.slice(5));
  console.log(usage.join("\n"));
  console.log(
    "\nThe channel is chosen; the counter is computed. Only a final closes a core.\n",
  );
  for (const target of TARGETS) {
    const status =
      target.status === "ready" ? "✅ ready" : `⏳ blocked — ${target.note}`;
    console.log(`${target.id} · ${target.label}  [${status}]`);
    for (const stage of STAGES) {
      const tier = target.tiers[stage];
      if (!tier) continue;
      const detail =
        tier.status === "blocked"
          ? `  ⏳ ${tier.note}`
          : tier.requires?.length
            ? `  (needs ${tier.requires.map((check) => check.name).join(", ")})`
            : "";
      console.log(`    ${stage.padEnd(6)} ${tier.name}${detail}`);
    }
    console.log("");
  }
}

/** Load `.env` when there is one; variables already in the environment win. */
function loadEnvFile() {
  try {
    process.loadEnvFile(join(ROOT, ".env"));
  } catch {
    // No .env is the normal case on a runner.
  }
}

/** Everything a phase needs to know about the tag it acts on. */
function releaseContext({ values, flags }) {
  const tag = values.tag;
  if (!tag) fail("which tag? pass --tag=vX.Y.Z-<channel>.N");
  const version = parseTag(tag);
  if (!version) {
    fail(`"${tag}" is not a release tag (expected vX.Y.Z or vX.Y.Z-channel.N)`);
  }
  const stage = stageOf(version);
  if (stage === null) {
    fail(`"${tag}" is not on a channel (expected ${STAGES.join(", ")})`);
  }

  process.env.LEAPSAKE_RELEASE = version;
  return {
    root: ROOT,
    tag,
    version,
    stage,
    storeVersion: coreOf(version),
    manifestVersion: JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ).version,
    tags: listTags(ROOT).filter((each) => each !== tag),
    branch: currentBranch(ROOT),
    clean: isClean(ROOT),
    shallow: isShallow(ROOT),
    firstRelease: flags.has("first-release"),
    commit: values.commit,
  };
}

function selectIds(only) {
  if (!only) return undefined;
  const ids = only
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const unknown = ids.filter((id) => !targetById(id));
  if (unknown.length > 0) {
    fail(
      `unknown target(s): ${unknown.join(", ")} — known: ${TARGETS.map((t) => t.id).join(", ")}`,
    );
  }
  return ids;
}

function reportFailures(heading, failures, write = console.error) {
  write(`\n✗ ${heading}`);
  for (const { name, reason } of failures) write(`  ${name}: ${reason}`);
}

const plannedBuildNumber = () =>
  Number(process.env.LEAPSAKE_BUILD_NUMBER?.trim() || buildNumberNow());

/** A marker rung's tag does not exist yet: it is created later, on the released commit. */
const repoChecksFor = (cells) =>
  cells.some((cell) => cell.status === "ready" && cell.marker)
    ? MARKER_CHECKS
    : FROM_TAG_CHECKS;

function printCells(ctx, cells, buildNumber, write) {
  write(`\nRelease ${ctx.tag}`);
  write(`  channel      ${ctx.stage}`);
  write(`  version      ${ctx.version}  (stores see ${ctx.storeVersion})`);
  write(`  build        ${buildNumber}`);
  write("\nTargets");
  for (const { target, tier, status, note, failures } of cells) {
    const mark = { ready: "✅", blocked: "⏳", failed: "✗" }[status];
    const detail = status === "blocked" ? ` — ${note}` : ` → ${tier.name}`;
    write(`  ${mark} ${target.id.padEnd(8)}${detail}`);
    for (const { name, reason } of failures) write(`       ${name}: ${reason}`);
    if (status === "blocked") continue;
    for (const line of tier.manual ?? []) write(`       ⚠ ${line}`);
  }
}

/** Evaluate the tag and every cell, and print them; `plan` and `ship` both start here. */
async function planRelease(opts, { write = console.log } = {}) {
  const ctx = releaseContext(opts);
  const checks = !opts.flags.has("no-checks");
  const cells = await evaluateCells(TARGETS, ctx, { checks });
  const repoFailures = checks ? await runChecks(repoChecksFor(cells), ctx) : [];
  const buildNumber = plannedBuildNumber();
  printCells(ctx, cells, buildNumber, write);
  if (repoFailures.length > 0) {
    reportFailures(
      `${ctx.tag} is not releasable from here:`,
      repoFailures,
      write,
    );
  }
  const ok =
    repoFailures.length === 0 &&
    !cells.some((cell) => cell.status === "failed");
  return { ctx, cells, buildNumber, ok };
}

async function plan(opts) {
  const json = opts.flags.has("json");
  const { ctx, cells, buildNumber, ok } = await planRelease(opts, {
    write: json ? console.error : console.log,
  });
  if (json) {
    console.log(
      JSON.stringify(planJson({ ...ctx, buildNumber }, cells), null, 2),
    );
  }
  return ok ? 0 : 1;
}

/** The suite for these platforms' device tiers plus every other tier, always `--strict`. */
function runGate(platforms, { provision }) {
  const suite = [
    "--strict",
    ...(provision ? ["--provision"] : []),
    `--platforms=${platforms.join(",")}`,
  ];
  console.log(`\n→ pnpm test:all ${suite.join(" ")}`);
  const run = spawnSync("pnpm", ["run", "test:all", "--", ...suite], {
    cwd: ROOT,
    stdio: "inherit",
  });
  return run.status === 0 ? 0 : 1;
}

const platformsOf = (cells) => [
  ...new Set(cells.map((cell) => cell.target.platform)),
];

async function gate(opts) {
  const provision = !opts.flags.has("no-provision");
  if (opts.values.platforms) {
    const platforms = opts.values.platforms.split(",").map((p) => p.trim());
    return runGate(platforms.filter(Boolean), { provision });
  }
  if (!opts.values.tag)
    fail("which platforms? pass --platforms=<list> or --tag=<tag>");
  const ctx = releaseContext(opts);
  const cells = await evaluateCells(TARGETS, ctx, { checks: false });
  const building = cells.filter(
    (cell) => cell.status === "ready" && !cell.marker,
  );
  if (building.length === 0) {
    console.log(`${ctx.tag} builds nothing, so there is nothing to gate`);
    return 0;
  }
  return runGate(platformsOf(building), { provision });
}

async function build(opts) {
  const ctx = releaseContext(opts);
  const ids = selectIds(opts.values.only);
  if (ids?.length !== 1)
    fail("build takes exactly one target: --only=<target>");
  const buildNumber = opts.values["build-number"];
  if (!/^\d+$/.test(buildNumber ?? "")) {
    fail("--build-number=<n> is required; take it from `plan`");
  }
  if (!opts.values.out) fail("--out=<dir> is required");
  const out = resolve(opts.values.out);

  const target = targetById(ids[0]);
  const [cell] = await evaluateCells([target], ctx);
  if (cell.status === "blocked") {
    console.error(`✗ ${target.id} cannot ship ${ctx.stage} — ${cell.note}`);
    return 1;
  }
  if (cell.marker) {
    fail(`${target.id}'s ${ctx.stage} rung is a marker — it builds nothing`);
  }
  const failures = [...(await runChecks(BUILD_CHECKS, ctx)), ...cell.failures];
  if (failures.length > 0) {
    reportFailures(`${target.id} cannot build ${ctx.tag}:`, failures);
    return 1;
  }

  console.log(`\n→ ${target.label}`);
  const manifest = await buildInto(target, ctx, {
    buildNumber: Number(buildNumber),
    out,
    commit: tagSha(ROOT, ctx.tag),
  });
  console.log(`\n✅ built ${target.id} ${manifest.buildNumber} into ${out}`);
  return 0;
}

function printSummary(tag, results) {
  const width = Math.max(...results.map((r) => r.target.label.length), 8);
  console.log(`\n${"─".repeat(width + 22)}`);
  console.log(`Release ${tag} — summary`);
  console.log("─".repeat(width + 22));
  for (const { target, ok, ms, reason } of results) {
    console.log(
      `${ok ? "✅" : "❌"}  ${(ok ? "SHIPPED" : "FAILED").padEnd(8)} ${target.label.padEnd(width)}  ${(ms / 1000).toFixed(1)}s`,
    );
    if (reason) console.log(`    ${reason}`);
  }
  console.log("─".repeat(width + 22));
}

async function publishPhase(ctx, cells, { from, receiptsOut, only }) {
  const results = await publishAll(cells, ctx, { from, receiptsOut, only });
  if (results.length === 0) {
    console.error(
      `✗ nothing to publish for ${ctx.tag}${from ? ` in ${from}` : ""}`,
    );
    return 1;
  }
  printSummary(ctx.tag, results);
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) return 0;
  console.error(
    `\n❌ ${failed.length} target(s) failed. Re-run them with the same artifact and build number:\n` +
      `   pnpm release publish --tag=${ctx.tag}${from ? ` --from=${from}` : ""} --only=${failed.map((r) => r.target.id).join(",")}`,
  );
  return 1;
}

async function publish(opts) {
  const ctx = releaseContext(opts);
  const from = opts.values.from && resolve(opts.values.from);
  const receiptsOut = opts.values["receipts-out"] ?? from;
  if (!receiptsOut) fail("--from=<dir> is required");
  const cells = await evaluateCells(TARGETS, ctx, { checks: false });
  return publishPhase(ctx, cells, {
    from,
    receiptsOut: resolve(receiptsOut),
    only: selectIds(opts.values.only),
  });
}

const git = (args) =>
  spawnSync("git", args, { cwd: ROOT, stdio: "inherit" }).status === 0;

function recordPhase(tag, dir, { push }) {
  const receipts = receiptsIn(dir);
  if (receipts.length === 0) {
    console.error(`✗ no receipts in ${dir}`);
    return 1;
  }
  const notes = `refs/notes/${NOTES_REF}`;
  if (push && !git(["fetch", "origin", `${notes}:${notes}`])) {
    console.error(`⚠ could not fetch ${notes}; recording on the local notes`);
  }
  const { recorded, lost } = recordReceipts(ROOT, tag, receipts);
  for (const each of recorded) {
    console.log(
      `  recorded ${each.target} build ${each.buildNumber} on ${each.commit.slice(0, 12)}`,
    );
  }
  for (const each of lost) {
    console.error(
      `  ⚠ could not record ${each.target} — add it by hand:\n` +
        `     git notes --ref=${NOTES_REF} append -m '${JSON.stringify(each)}' ${each.commit}`,
    );
  }
  if (push) return git(["push", "origin", tag, notes]) && !lost.length ? 0 : 1;
  console.log(
    `\nNothing has been pushed — when you are ready:\n   git push origin ${tag} ${notes}`,
  );
  return lost.length === 0 ? 0 : 1;
}

function record(opts) {
  const { tag } = releaseContext(opts);
  if (!opts.values.from) fail("--from=<dir> is required");
  return recordPhase(tag, resolve(opts.values.from), {
    push: opts.flags.has("push"),
  });
}

function abandon(opts) {
  const { tag } = releaseContext(opts);
  const { remote } = abandonTag(ROOT, tag);
  console.log(
    `✅ deleted ${tag}${remote ? " here and at origin" : " here; origin never had it"}. ` +
      "No receipt names it, so no store has seen a build of it.",
  );
  return 0;
}

const idsOf = (cells) => cells.map((cell) => cell.target.id).join(", ");

async function ship(opts) {
  const { ctx, cells, buildNumber, ok } = await planRelease(opts);
  const provision = !opts.flags.has("no-provision");
  const ready = cells.filter((cell) => cell.status === "ready");
  const toBuild = ready.filter((cell) => !cell.marker);

  if (opts.flags.has("dry-run")) {
    console.log("\nWould, in order:");
    let step = 1;
    if (toBuild.length > 0) {
      const suite = `--strict${provision ? " --provision" : ""}`;
      const platforms = platformsOf(toBuild).join(",");
      console.log(
        `  ${step++}. run pnpm test:all ${suite} --platforms=${platforms}`,
      );
      console.log(
        `  ${step++}. build ${idsOf(toBuild)} as build ${buildNumber}`,
      );
    }
    console.log(`  ${step++}. publish ${idsOf(ready) || "nothing"}`);
    console.log(`  ${step}. record the receipts; push nothing`);
    console.log("\n(dry run — nothing was changed)");
    return ok ? 0 : 1;
  }
  if (!ok) return 1;
  if (ready.length === 0) {
    console.error("\n✗ nothing to ship: no target is ready at this rung");
    return 1;
  }

  const out = mkdtempSync(join(tmpdir(), `leapsake-${ctx.tag}-`));
  if (toBuild.length > 0) {
    if (runGate(platformsOf(toBuild), { provision }) !== 0) return 1;

    const failures = await runChecks(BUILD_CHECKS, ctx);
    if (failures.length > 0) {
      reportFailures(`${ctx.tag} cannot be built from here:`, failures);
      return 1;
    }
    const commit = tagSha(ROOT, ctx.tag);
    for (const { target } of toBuild) {
      console.log(`\n→ building ${target.label}`);
      try {
        await buildInto(target, ctx, { buildNumber, out, commit });
      } catch (error) {
        console.error(
          `\n✗ ${target.id}: ${error.message}\n  Nothing was uploaded.`,
        );
        return 1;
      }
    }
  }

  const published = await publishPhase(ctx, cells, {
    from: out,
    receiptsOut: out,
  });
  const recorded =
    receiptsIn(out).length > 0 ? recordPhase(ctx.tag, out, { push: false }) : 0;
  return published || recorded;
}

const HANDLERS = { plan, gate, build, publish, record, abandon, ship };

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [command, ...extra] = opts.positional;
  if (opts.flags.has("help")) {
    printHelp();
    return 0;
  }
  if (!command) {
    printHelp();
    return 2;
  }
  if (!COMMANDS.includes(command)) {
    fail(`unknown command "${command}" (expected ${COMMANDS.join(", ")})`);
  }
  if (extra.length > 0) fail(`unexpected argument "${extra[0]}"`);
  loadEnvFile();
  return HANDLERS[command](opts);
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  },
);
