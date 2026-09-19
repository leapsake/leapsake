// The release phases, each runnable on its own: plan, build, publish, record, abandon.
// Targets are passed in, so the tests drive these with stubs.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

import { runChecks } from "./checks.mjs";
import { createTag, tagSha } from "./git.mjs";
import { recordShipment, shipmentsFor } from "./receipts.mjs";
import { coreOf } from "./version.mjs";

const BUILD_EPOCH_MS = Date.UTC(2026, 0, 1);

/** Minutes since 2026-01-01 UTC, the same clock `apps/mobile/app.config.ts` reads. */
export function buildNumberNow(now = Date.now()) {
  return Math.floor((now - BUILD_EPOCH_MS) / 60_000);
}

/**
 * Each target's cell at this stage: `ready`, `blocked` (policy, with a note) or `failed`
 * (a ready cell whose checks do not hold). Only `failed` fails a release.
 */
export async function evaluateCells(targets, ctx, { checks = true } = {}) {
  const cells = [];
  for (const target of targets) {
    const tier = target.tiers[ctx.stage];
    const cell = { target, tier, marker: Boolean(tier?.marker), failures: [] };
    if (target.status !== "ready") {
      cells.push({ ...cell, status: "blocked", note: target.note });
      continue;
    }
    if (!tier) {
      const note = `${target.id} has no ${ctx.stage} rung`;
      cells.push({ ...cell, status: "blocked", note });
      continue;
    }
    if (tier.status === "blocked") {
      cells.push({ ...cell, status: "blocked", note: tier.note });
      continue;
    }
    const failures = checks
      ? await runChecks(cellChecks(target, tier), ctx)
      : [];
    cells.push({
      ...cell,
      status: failures.length ? "failed" : "ready",
      failures,
    });
  }
  return cells;
}

/** A marker rung needs only its own requirements; a building one needs the target's too. */
function cellChecks(target, tier) {
  return tier.marker
    ? (tier.requires ?? [])
    : [...(target.preflight ?? []), ...(tier.requires ?? [])];
}

/** What a workflow reads to build its matrices. */
export function planJson({ tag, version, stage, buildNumber }, cells) {
  return {
    tag,
    version,
    stage,
    core: coreOf(version),
    buildNumber,
    targets: cells.map(({ target, status, note, marker, failures }) => ({
      id: target.id,
      platform: target.platform,
      status,
      note: note ?? null,
      marker,
      host: target.host,
      failures: failures.map(({ name, reason }) => `${name}: ${reason}`),
    })),
  };
}

const manifestPath = (out, id) => join(out, `${id}.json`);
const receiptPath = (dir, id) => join(dir, `${id}.receipt.json`);

/**
 * Build one target into `<out>/<id>/` and describe it in `<out>/<id>.json`. Spends nothing.
 * The build number comes from the caller, pinned for Expo through `LEAPSAKE_BUILD_NUMBER`.
 */
export async function buildInto(target, ctx, { buildNumber, out, commit }) {
  process.env.LEAPSAKE_BUILD_NUMBER = String(buildNumber);
  const built = await target.build(ctx);
  if (String(built.buildNumber) !== String(buildNumber)) {
    throw new Error(
      `${target.id} built number ${built.buildNumber}, not the ${buildNumber} this release planned`,
    );
  }

  const dir = join(out, target.id);
  mkdirSync(dir, { recursive: true });
  const files = {};
  for (const [name, path] of Object.entries(built.files ?? {})) {
    const copy = join(dir, basename(path));
    copyFileSync(path, copy);
    files[name] = join(target.id, basename(path));
  }

  const manifest = {
    tag: ctx.tag,
    version: ctx.version,
    stage: ctx.stage,
    target: target.id,
    buildNumber: built.buildNumber,
    bundleId: built.bundleId,
    files,
    commit,
    builtAt: new Date().toISOString(),
  };
  writeFileSync(
    manifestPath(out, target.id),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/** The build manifests in `dir`, as `{ id, manifest }`. */
export function builtIn(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".receipt.json"))
    .map((name) => {
      const manifest = JSON.parse(readFileSync(join(dir, name), "utf8"));
      return { id: manifest.target, manifest };
    });
}

/** The artifact a target's `publish()` receives: the manifest, with its files made absolute. */
function artifactFrom(dir, manifest) {
  const files = Object.fromEntries(
    Object.entries(manifest.files).map(([name, path]) => [
      name,
      resolve(dir, path),
    ]),
  );
  return {
    buildNumber: manifest.buildNumber,
    bundleId: manifest.bundleId,
    files,
  };
}

/**
 * Publish every ready cell: a marker cell through `release()`, any other from its build
 * manifest in `from`. One target failing does not stop the others. Writes one receipt
 * file per success into `receiptsOut`.
 */
export async function publishAll(
  cells,
  ctx,
  { from, receiptsOut, only, log = console.log },
) {
  const built = new Map(
    builtIn(from).map(({ id, manifest }) => [id, manifest]),
  );
  mkdirSync(receiptsOut, { recursive: true });
  const results = [];

  for (const { target, status, marker } of cells) {
    if (status !== "ready") continue;
    if (only && !only.includes(target.id)) continue;
    const manifest = built.get(target.id);
    if (!marker && !manifest) {
      if (only)
        results.push(failed(target, `no build of ${target.id} in ${from}`));
      continue;
    }
    if (manifest && manifest.tag !== ctx.tag) {
      results.push(
        failed(
          target,
          `${from} holds a build of ${manifest.tag}, not ${ctx.tag}`,
        ),
      );
      continue;
    }

    log(`\n→ ${target.label}`);
    const started = Date.now();
    try {
      let receipt;
      if (marker) {
        const { commit, buildNumber } = await target.release(ctx);
        receipt = { buildNumber, commit };
      } else {
        await target.publish({
          ...ctx,
          artifact: artifactFrom(from, manifest),
        });
        receipt = {
          buildNumber: manifest.buildNumber,
          bundleId: manifest.bundleId,
          commit: manifest.commit,
        };
      }
      writeFileSync(
        receiptPath(receiptsOut, target.id),
        `${JSON.stringify({ tag: ctx.tag, version: ctx.version, stage: ctx.stage, target: target.id, ...receipt, at: new Date().toISOString() }, null, 2)}\n`,
      );
      results.push({ target, ok: true, ms: Date.now() - started });
    } catch (error) {
      results.push({
        ...failed(target, error.message),
        ms: Date.now() - started,
      });
    }
  }
  return results;
}

const failed = (target, reason) => ({ target, ok: false, reason, ms: 0 });

/** The receipt files in `dir`. */
export function receiptsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".receipt.json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
}

/**
 * Append each receipt to `refs/notes/releases` on the commit it shipped from. A marker
 * release's tag is created here, on the commit its receipts agree on, if it does not exist.
 */
export function recordReceipts(root, tag, receipts) {
  const own = receipts.filter((each) => each.tag === tag);
  if (own.length !== receipts.length) {
    throw new Error(`the receipts include ones for another tag than ${tag}`);
  }
  if (own.length === 0) return { recorded: [], lost: [] };

  if (tagSha(root, tag) === null) {
    const commits = new Set(own.map((each) => each.commit));
    if (commits.size !== 1) {
      throw new Error(
        `the receipts name ${commits.size} commits (${[...commits].map((c) => c?.slice(0, 12)).join(", ")}) — ${tag} cannot name them all`,
      );
    }
    const [commit] = commits;
    createTag(root, tag, `${own[0].version} (released)`, commit);
  }

  const tagged = tagSha(root, tag);
  const recorded = [];
  const lost = [];
  for (const receipt of own) {
    const commit = receipt.commit ?? tagged;
    const ok = recordShipment(root, commit, receipt);
    (ok ? recorded : lost).push({ ...receipt, commit });
  }
  return { recorded, lost };
}

/** Delete a tag nothing shipped from, locally and at `remote` when it is there. */
export function abandonTag(root, tag, { remote = "origin" } = {}) {
  const commit = tagSha(root, tag);
  if (commit === null) throw new Error(`${tag} does not exist here`);
  const shipped = shipmentsFor(root, commit).filter((each) => each.tag === tag);
  if (shipped.length > 0) {
    throw new Error(
      `${tag} shipped to ${shipped.map((each) => each.target).join(", ")} — a spent build number cannot be taken back, so the tag stays. Re-run the failed publish instead`,
    );
  }

  const git = (args) =>
    spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const atRemote = git(["ls-remote", "--tags", remote, `refs/tags/${tag}`]);
  const pushed = atRemote.status === 0 && atRemote.stdout.trim() !== "";
  if (pushed) {
    const deleted = git(["push", remote, "--delete", `refs/tags/${tag}`]);
    if (deleted.status !== 0) {
      throw new Error(
        `could not delete ${tag} at ${remote}: ${deleted.stderr.trim()}`,
      );
    }
  }
  git(["tag", "-d", tag]);
  return { remote: pushed };
}
