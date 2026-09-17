// The release orchestrator — the executable half of the release policy.
//
// A release is a **tag**, and this decides what a tag means: which version it names, what
// must hold before it exists, and which platforms it ships to. The rules are here rather
// than in a document because a rule a script enforces cannot go stale against the script,
// and a rule a document states can. What is left in CONTRIBUTING.md is the handful of judgments
// no program can make.
//
// ## The model
//
//   vX.Y.Z-alpha.N  <  vX.Y.Z-beta.N  <  vX.Y.Z-rc.N  <  vX.Y.Z
//
// **A human chooses the rung; the number is computed** (`version.mjs`). Starting a new
// train is the single exception — one decision per train, passed as `--base=`, and best
// given as `patch`/`minor`/`major` so even that number is computed rather than typed. A tag is
// cut when a build is wanted, not on every merge: each one spends a store upload.
//
// **A tag covers the whole repo; the platforms it reaches are per-invocation.** Every
// manifest in `apps/` and `packages/` carries one version so that iOS `1.2.3` and macOS
// `1.2.3` are known to work together, but `v0.1.0-rc.1` may perfectly well ship to
// TestFlight while desktop stays unpackaged. That is why `--only` is a flag and not part
// of the tag.
//
// ## Two entry points, one path
//
//   pnpm release beta --only=ios          cut the tag here, then ship it
//   pnpm release --from-tag=v0.1.0-beta.1 ship a tag that already exists
//
// The second is what a runner calls on a tag push, and it is the *same code* — CI is one
// caller among others, never the owner of the process (CONTRIBUTING.md → Testing, principle 6:
// no hosted CI is assumed). Anything a workflow file could do that this cannot is a bug
// in this file.
//
// ## The gate
//
// The suite is run with `--provision`, so the device tiers boot their own simulator,
// install their own dev client and start their own Metro. A release has to be one command
// on a machine that has nothing prepared — that is the whole point of it being runnable by
// a CI runner. `--no-provision` opts out when the environment is already up and the extra
// probing is just latency.
//
// Every rung runs `pnpm test:all`. Beta and above run it `--strict`, where a tier that is
// blocked — not built yet, or needing a device that is not booted — fails the release.
// Alpha does not: it goes to internal TestFlight, which is named App Store Connect users
// and no one else. See `isStrict` below.
//
// Credentials come from `.env` (see `.env.example`), or from the environment, which wins.
//
// ## What it will not do
//
// It never pushes. A store version string is permanent and monotonic, a Play production
// rollout reaches strangers as soon as it goes live, and a notarized artifact is public the
// moment its feed sees it — so the irreversible step stays a person's, and the command to
// take it is printed at the end.
//
// Usage:
//   node scripts/release/index.mjs <alpha|beta|rc|final> [--base=patch|minor|major|X.Y.Z]
//   node scripts/release/index.mjs --from-tag=<tag>
//   node scripts/release/index.mjs ... --only=ios,android   default: every ready target
//   node scripts/release/index.mjs ... --dry-run            preflight and plan, no changes
//   node scripts/release/index.mjs ... --no-provision       assume the devices are ready
//   node scripts/release/index.mjs ... --first-release      this repo has no release tags yet
//   node scripts/release/index.mjs final --commit=<sha>     name the live commit by hand
//   node scripts/release/index.mjs --help                   the stage/target matrix
//
// Exit code: 2 for a usage error, 1 for a refused or failed release, 0 when every selected
// target shipped.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runChecks } from "./checks.mjs";
import {
  commitAll,
  createTag,
  currentBranch,
  headSha,
  isClean,
  isShallow,
  listTags,
} from "./git.mjs";
import { FROM_TAG_CHECKS, LOCAL_CHECKS, MARKER_CHECKS } from "./preflight.mjs";
import { NOTES_REF, recordShipment } from "./receipts.mjs";
import { TARGETS, targetById } from "./targets/index.mjs";
import {
  coreOf,
  formatTag,
  nextVersion,
  parseTag,
  stageOf,
  STAGES,
} from "./version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VALUE_FLAGS = new Set(["from-tag", "base", "only", "commit"]);

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

/** The matrix, built by asking the registry — never a table maintained alongside it. */
function printHelp() {
  console.log(
    "Usage: pnpm release <alpha|beta|rc|final> [--base=patch|minor|major|X.Y.Z] [--only=…] [--dry-run]",
  );
  console.log("       pnpm release --from-tag=<tag> [--only=…] [--dry-run]\n");
  console.log(
    "The stage is chosen; the number is computed. Nothing is pushed.\n",
  );
  for (const target of TARGETS) {
    const status =
      target.status === "ready" ? "✅ ready" : `⏳ blocked — ${target.note}`;
    console.log(`${target.id} · ${target.label}  [${status}]`);
    for (const stage of STAGES) {
      const tier = target.tiers[stage];
      if (!tier) continue;
      const requires = tier.requires?.length
        ? `  (needs ${tier.requires.map((check) => check.name).join(", ")})`
        : "";
      console.log(`    ${stage.padEnd(6)} ${tier.name}${requires}`);
    }
    console.log("");
  }
}

/** Decide the version, the stage, and the tag — from a rung, or from an existing tag. */
function resolveRelease({ positional, values }, { manifestVersion, tags }) {
  const fromTag = values["from-tag"];
  if (fromTag) {
    if (positional.length > 0) {
      fail(`--from-tag names the stage already; drop "${positional[0]}"`);
    }
    // The tag carries the whole version, so a base here has nothing to decide — and would
    // read as if it did.
    if (values.base !== undefined) {
      fail(`--from-tag names the version already; drop --base=${values.base}`);
    }
    const version = parseTag(fromTag);
    if (!version) {
      fail(
        `"${fromTag}" is not a release tag (expected vX.Y.Z or vX.Y.Z-stage.N)`,
      );
    }
    const stage = stageOf(version);
    if (stage === null) {
      fail(
        `"${fromTag}" is not on the ladder (expected ${STAGES.join(", ")}) — the ladder is what decides where a build is allowed to go`,
      );
    }
    return { mode: "from-tag", version, stage, tag: fromTag };
  }

  const [stage, ...extra] = positional;
  if (!stage)
    fail(`which stage? one of ${STAGES.join(", ")} — or --from-tag=<tag>`);
  if (!STAGES.includes(stage)) {
    fail(`unknown stage "${stage}" (expected ${STAGES.join(", ")})`);
  }
  if (extra.length > 0) fail(`unexpected argument "${extra[0]}"`);

  const version = nextVersion({
    current: manifestVersion,
    stage,
    base: values.base,
    tags,
  });
  return { mode: "local", version, stage, tag: formatTag(version) };
}

function selectTargets(only) {
  if (!only) return TARGETS;
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
  const blocked = ids.map(targetById).filter((t) => t.status !== "ready");
  if (blocked.length > 0) {
    // Asking for a blocked target by name is a different mistake from not knowing it is
    // blocked, and gets a different answer: a hard stop rather than a ⏳ row.
    for (const target of blocked) {
      console.error(`✗ ${target.id} cannot ship yet — ${target.note}`);
    }
    process.exit(2);
  }
  return ids.map(targetById);
}

/** Report a list of `{ name, reason }` failures under a heading. */
function reportFailures(heading, failures) {
  console.error(`\n✗ ${heading}`);
  for (const { name, reason } of failures) {
    console.error(`  ${name}: ${reason}`);
  }
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

const setVersion = (version) =>
  run(process.execPath, ["scripts/set-version.mjs", version]);

/**
 * Load `.env` if there is one, so the credentials a release needs are a file rather than
 * a block of exports retyped each time. `.env.example` is the template; `.gitignore`
 * keeps the real one out of the repo.
 *
 * A variable already present in the environment **wins over the file** (Node's own
 * precedence for `--env-file`), which is the behaviour a runner needs: secrets injected
 * by CI are not quietly overridden by a stray checked-out `.env`.
 */
function loadEnvFile() {
  try {
    process.loadEnvFile(join(ROOT, ".env"));
  } catch {
    // No .env is the normal case on a runner, where the environment carries the secrets.
  }
}

/**
 * Whether a red-or-*blocked* tier stops the release.
 *
 * Every rung runs the same suite; what changes is whether a tier that is merely *not
 * built yet* is fatal. `--strict` is release-gate mode, and the gate's own policy is
 * about the first release of Leapsake **on a platform** — the rungs where people who are
 * not the author install the build. An alpha goes to internal TestFlight: named App Store
 * Connect users, capped at 100. Holding it to the full gate would mean no build at all
 * until the E2E catalog exists, which trades a real alpha for a theoretical one.
 */
const isStrict = (stage) => stage !== "alpha";

/**
 * The `final` rung: make the approved version public, and tag the commit that went live.
 *
 * Nothing is built here. The artifact was built and submitted by an `rc` days earlier, and
 * going live is a state Apple confers rather than something compiled — so this asks each
 * target which commit its released build came from, and marks it.
 *
 * **The tag is cut last, and on a commit this did not choose.** Every other rung tags what
 * it is about to build; this one tags what Apple has already approved, which is why the
 * order is inverted and why the commit comes back from the target rather than being HEAD.
 */
async function markReleased(ctx, selected, dryRun) {
  const { tag, stage, storeVersion, root } = ctx;
  const ready = selected.filter((target) => target.status === "ready");

  const failures = await runChecks(MARKER_CHECKS, ctx);
  if (failures.length > 0) {
    reportFailures(`${tag} cannot be marked from here:`, failures);
    if (!dryRun) return 1;
  }

  // A marker rung still has preconditions, and they are the target's to state — Android's
  // `final` refuses because Play has granted this account no production access. Checked
  // before the marker-shape refusal below so the reason a person can *act* on wins, and
  // checked at all because otherwise a `requires` list is silently ignored at this rung.
  const blockers = new Map();
  for (const target of ready) {
    const tierFailures = await runChecks(
      target.tiers[stage]?.requires ?? [],
      ctx,
    );
    if (tierFailures.length > 0) blockers.set(target.id, tierFailures);
  }
  if (blockers.size > 0) {
    reportFailures(
      `${blockers.size} target(s) cannot release ${stage}:`,
      [...blockers.values()].flat(),
    );
    if (!dryRun) return 1;
  }

  // ⚠️ A ready target whose rung here is *not* a marker cannot be handled: it has no
  // `release()`, because its going-live step is a build rather than a state Apple confers.
  // macOS's update feed is shaped that way. Android's production track is too, and is the
  // reason the check above runs first: "no production access" is the useful message, and
  // this one would otherwise pre-empt it with a note about missing code. Refusing beats
  // skipping: a platform silently not being released is worse than an error that names it.
  const unmarked = ready.filter(
    (target) => !target.tiers[stage]?.marker && !blockers.has(target.id),
  );
  if (unmarked.length > 0) {
    console.error(
      `\n✗ ${unmarked.map((each) => each.id).join(", ")}: the ${stage} rung is not a ` +
        "marker there, so there is nothing to release — give the target a `release()` and " +
        "`marker: true`, or ship that platform's rung separately with --only",
    );
    return 1;
  }

  console.log("\nTargets");
  for (const target of selected) {
    if (target.status !== "ready") {
      console.log(`  ⏳ ${target.id.padEnd(8)} — ${target.note}`);
      continue;
    }
    const stopped = blockers.get(target.id);
    console.log(
      `  ${stopped ? "✗" : "✅"} ${target.id.padEnd(8)} → ${target.tiers[stage].name}`,
    );
    for (const { name, reason } of stopped ?? []) {
      console.log(`       ${name}: ${reason}`);
    }
    for (const note of target.tiers[stage].manual ?? []) {
      console.log(`       ⚠ ${note}`);
    }
  }

  if (dryRun) {
    console.log("\nWould, in order:");
    console.log(
      `  1. confirm ${storeVersion} is approved and waiting, and release it`,
    );
    console.log(
      "  2. resolve the commit its build came from, out of refs/notes/releases",
    );
    console.log(`  3. tag ${tag} on that commit — no build, no suite, no bump`);
    console.log(
      "\n(dry run — nothing was changed, and nothing is ever pushed)",
    );
    return failures.length > 0 || blockers.size > 0 ? 1 : 0;
  }

  // Each target reports the commit behind its own released build. They must agree: one tag
  // cannot honestly name two commits, and a disagreement means the platforms shipped
  // different source — which is a thing to stop and look at, not to average.
  const released = [];
  for (const target of ready) {
    console.log(`\n→ ${target.label}`);
    try {
      released.push({ target, ...(await target.release(ctx)) });
    } catch (error) {
      console.error(`✗ ${target.id}: ${error.message}`);
      return 1;
    }
  }

  const commits = new Set(released.map((each) => each.commit));
  if (commits.size > 1) {
    console.error(
      `\n✗ the released builds do not come from one commit: ${released
        .map((each) => `${each.target.id} ${each.commit.slice(0, 12)}`)
        .join(", ")} — ${tag} cannot name them both`,
    );
    return 1;
  }

  const [commit] = commits;
  createTag(root, tag, `${ctx.version} (released)`, commit);
  console.log(
    `\n✅ ${tag} marks ${commit.slice(0, 12)} — the commit now public.`,
  );
  console.log(
    `   Nothing has been pushed:\n   git push origin ${ctx.branch} ${tag} refs/notes/${NOTES_REF}`,
  );
  return 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.flags.has("help")) {
    printHelp();
    return 0;
  }
  loadEnvFile();

  const dryRun = opts.flags.has("dry-run");
  const provision = !opts.flags.has("no-provision");
  const manifestVersion = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ).version;
  const allTags = listTags(ROOT);

  const { mode, version, stage, tag } = resolveRelease(opts, {
    manifestVersion,
    tags: allTags,
  });

  const ctx = {
    root: ROOT,
    mode,
    stage,
    tag,
    version,
    storeVersion: coreOf(version),
    manifestVersion,
    // The release's own tag is excluded so the monotonic guard compares against history
    // rather than against itself — in `--from-tag` mode the tag already exists.
    tags: allTags.filter((each) => each !== tag),
    branch: currentBranch(ROOT),
    clean: isClean(ROOT),
    // The raw `--base`, for `baseIsSuccessor` to judge. `version` is what it produced;
    // this is what was asked for, and only one of the two can be a typo.
    base: opts.values.base,
    // Both are read by `monotonic`, the one check that reads history rather than the
    // working tree: a tag list that cannot be trusted is refused rather than believed,
    // and the single legitimate empty list is claimed by hand instead of inferred.
    shallow: isShallow(ROOT),
    firstRelease: opts.flags.has("first-release"),
    // The escape hatch for a marker rung whose receipts cannot name the live commit —
    // never the normal path, which is why nothing prompts for it.
    commit: opts.values.commit,
    dryRun,
  };

  const selected = selectTargets(opts.values.only);
  const ready = selected.filter((target) => target.status === "ready");

  console.log(`\nRelease ${tag}`);
  console.log(`  stage        ${stage}`);
  console.log(
    `  version      ${version}${version === ctx.storeVersion ? "" : `  (stores see ${ctx.storeVersion})`}`,
  );
  // Say it out loud when the core moves. A new train is the one thing here a person chose
  // rather than the tags deciding, so it should be visible before the suite runs rather
  // than inferred from the version afterwards.
  if (coreOf(manifestVersion) !== ctx.storeVersion) {
    console.log(
      `  train        new — ${coreOf(manifestVersion)} → ${ctx.storeVersion}`,
    );
  }
  console.log(`  from         ${ctx.branch} @ ${mode}`);

  // A marker rung shares almost nothing with a build: no suite, no manifest bump, no
  // commit, and a tag that lands on a commit from days ago rather than on HEAD. Threading
  // that through the sequence below as four conditionals would make both paths harder to
  // read than keeping them apart.
  if (ready.some((target) => target.tiers[stage]?.marker)) {
    return await markReleased(ctx, selected, dryRun);
  }

  // ── Preflight, repo-wide ────────────────────────────────────────────────────────────
  const repoFailures = await runChecks(
    mode === "local" ? LOCAL_CHECKS : FROM_TAG_CHECKS,
    ctx,
  );
  if (repoFailures.length > 0) {
    reportFailures(`${tag} is not releasable from here:`, repoFailures);
    // A dry run is asking "what is missing?", so it answers all of it rather than
    // stopping at the first layer. It still ends in a refusal.
    if (!dryRun) return 1;
  }

  // ── Preflight, per target ───────────────────────────────────────────────────────────
  // Blocked targets are checked too, and only under --dry-run, where the answer to "what
  // is missing before I can cut a beta?" is the whole point of asking.
  const blockers = new Map();
  for (const target of selected) {
    if (target.status !== "ready" && !dryRun) continue;
    const tier = target.tiers[stage];
    if (!tier) {
      blockers.set(target.id, [
        { name: stage, reason: `${target.id} has no ${stage} rung` },
      ]);
      continue;
    }
    const failures = await runChecks(
      [...(target.preflight ?? []), ...(tier.requires ?? [])],
      ctx,
    );
    if (failures.length > 0) blockers.set(target.id, failures);
  }

  console.log("\nTargets");
  for (const target of selected) {
    const tier = target.tiers[stage];
    const failures = blockers.get(target.id);
    const mark =
      target.status !== "ready" ? "⏳" : failures?.length ? "✗" : "✅";
    const detail =
      target.status !== "ready" ? ` — ${target.note}` : ` → ${tier?.name}`;
    console.log(`  ${mark} ${target.id.padEnd(8)}${detail}`);
    for (const { name, reason } of failures ?? []) {
      console.log(`       ${name}: ${reason}`);
    }
    for (const note of tier?.manual ?? []) {
      console.log(`       ⚠ ${note}`);
    }
  }

  const readyBlockers = ready.filter((target) => blockers.has(target.id));
  if (readyBlockers.length > 0 && !dryRun) {
    reportFailures(
      `${readyBlockers.length} target(s) are not ready to ship ${stage}:`,
      readyBlockers.flatMap((target) => blockers.get(target.id)),
    );
    return 1;
  }

  if (dryRun) {
    console.log("\nWould, in order:");
    console.log(
      `  1. run pnpm test:all${isStrict(stage) ? " --strict" : ""}${
        provision ? " --provision" : ""
      }${isStrict(stage) ? "" : `  (${stage} does not gate on unbuilt tiers)`}`,
    );
    if (provision) {
      console.log(
        "     device tiers will boot a simulator/emulator, install the dev client and",
      );
      console.log(
        "     start Metro as needed — first run on a cold machine takes a while",
      );
    }
    if (mode === "local") {
      console.log(
        `  2. set every manifest to ${version}, commit, and tag ${tag}`,
      );
    }
    console.log(
      `  ${mode === "local" ? "3" : "2"}. build and publish: ${ready.map((t) => t.id).join(", ") || "nothing (no ready targets)"}`,
    );
    console.log(
      "\n(dry run — nothing was changed, and nothing is ever pushed)",
    );
    return repoFailures.length > 0 ? 1 : 0;
  }

  if (ready.length === 0) {
    console.error(
      `\n✗ nothing to ship: no selected target is ready. Run with --dry-run to see what each one is waiting on.`,
    );
    return 1;
  }

  // ── The gate ────────────────────────────────────────────────────────────────────────
  // Bump first so the suite runs against the tree that will be tagged, not the one before
  // it. A red suite restores the manifests, leaving the repo exactly as it was found.
  if (mode === "local") {
    console.log(`\n→ setting every manifest to ${version}`);
    if (setVersion(version).status !== 0) return 1;
  }

  const strict = isStrict(stage);
  const suiteArgs = [
    ...(strict ? ["--strict"] : []),
    ...(provision ? ["--provision"] : []),
  ];
  console.log(
    `\n→ pnpm test:all${suiteArgs.length ? ` ${suiteArgs.join(" ")}` : ""}`,
  );
  if (run("pnpm", ["run", "test:all", "--", ...suiteArgs]).status !== 0) {
    if (mode === "local") {
      console.error(
        `\n✗ the suite is red — restoring the manifests to ${manifestVersion}`,
      );
      if (setVersion(manifestVersion).status !== 0) {
        console.error(
          `✗ could not restore — run: node scripts/set-version.mjs ${manifestVersion}`,
        );
      }
    }
    return 1;
  }

  // ── The tag ─────────────────────────────────────────────────────────────────────────
  if (mode === "local") {
    console.log(`\n→ committing and tagging ${tag}`);
    commitAll(ROOT, `Cut ${version}`);
    createTag(ROOT, tag, `${version} (${stage})`);
  }

  // ── Ship ────────────────────────────────────────────────────────────────────────────
  const results = [];
  for (const target of ready) {
    console.log(`\n→ ${target.label}`);
    const started = Date.now();
    try {
      const artifact = await target.build(ctx);
      await target.publish({ ...ctx, artifact });
      // Record what shipped, against the commit it shipped from. This is the only moment
      // the build number and the commit are both in hand — Apple will later name the
      // build and nothing else, so without this the commit behind a released version is
      // unknowable. `headSha` *is* the tagged commit here: the tag was cut above and
      // nothing between has moved it.
      const recorded = recordShipment(ROOT, headSha(ROOT), {
        tag,
        version,
        stage,
        target: target.id,
        buildNumber: artifact?.buildNumber,
        bundleId: artifact?.bundleId,
      });
      // Never fatal. The artifact is already uploaded; turning that into a failed release
      // over bookkeeping would be the worse outcome — so this says loudly what was lost
      // and how to put it back by hand.
      if (!recorded) {
        console.warn(
          `   ⚠ could not record the receipt for ${target.id} — going live will not be ` +
            `able to find the commit behind build ${artifact?.buildNumber}. Add it with:\n` +
            `     git notes --ref=${NOTES_REF} append -m '{"tag":"${tag}","target":"${target.id}","build":"${artifact?.buildNumber}"}' ${headSha(ROOT)}`,
        );
      }
      results.push({ target, ok: true, ms: Date.now() - started });
    } catch (error) {
      console.error(`✗ ${target.id}: ${error.message}`);
      results.push({ target, ok: false, ms: Date.now() - started });
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────────────
  const width = Math.max(...results.map((r) => r.target.label.length), 8);
  console.log(`\n${"─".repeat(width + 22)}`);
  console.log(`Release ${tag} — summary`);
  console.log("─".repeat(width + 22));
  for (const { target, ok, ms } of results) {
    console.log(
      `${ok ? "✅" : "❌"}  ${(ok ? "SHIPPED" : "FAILED").padEnd(8)} ${target.label.padEnd(width)}  ${(ms / 1000).toFixed(1)}s`,
    );
  }
  console.log("─".repeat(width + 22));

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(
      `\n❌ ${failed.length} target(s) failed. The tag stands — re-run just those:\n` +
        `   pnpm release --from-tag=${tag} --only=${failed.map((r) => r.target.id).join(",")}\n` +
        "   (build numbers come from the clock, so a re-run mints a fresh one under the same version)",
    );
    return 1;
  }

  // `refs/notes/releases` is named in every push hint below because it does not travel with
  // an ordinary push: leave it behind and the receipts exist only on this machine, so a
  // fresh clone — or a runner — cannot tell which commit a released build came from.
  const push = `git push origin ${ctx.branch} ${tag} refs/notes/${NOTES_REF}`;

  if (mode !== "local") {
    console.log(`\n✅ ${tag} shipped.`);
  } else if (stage === "final") {
    // The one rung whose tag outruns the thing it names. Every other rung is finished when
    // the upload is: the artifact reached the audience the rung means. This one has only
    // asked, and Apple answers days later — so the tag is a claim about a commit that is
    // not true yet. An unpushed tag can still be deleted after a rejection; a pushed one
    // is a permanent assertion that this commit is what the public got.
    console.log(
      `\n✅ ${tag} shipped — the build is uploaded, not released. Do not push the tag yet:\n` +
        "   Apple has not approved it, and a rejection wants a different commit than this one.\n" +
        "   Once the version is actually live on the App Store:\n" +
        `   ${push}`,
    );
  } else {
    console.log(
      `\n✅ ${tag} shipped. Nothing has been pushed — when you are ready:\n   ${push}`,
    );
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  },
);
