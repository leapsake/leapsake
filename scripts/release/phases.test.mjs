import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  abandonTag,
  buildInto,
  buildNumberNow,
  builtIn,
  evaluateCells,
  planJson,
  publishAll,
  receiptsIn,
  recordReceipts,
} from "./phases.mjs";
import { recordShipment, shipmentsFor } from "./receipts.mjs";

const scratch = (name) => mkdtempSync(join(tmpdir(), `phases-${name}-`));
const ctx = (over = {}) => ({
  tag: "v0.1.0-beta.10",
  version: "0.1.0-beta.10",
  stage: "beta",
  storeVersion: "0.1.0",
  ...over,
});
const passing = { name: "passes", check: () => undefined };
const failing = { name: "fails", check: () => "it is missing" };

/** A target whose build writes a real file and whose publish records what it was given. */
function stub(id, over = {}) {
  const calls = { build: [], publish: [], release: [] };
  const target = {
    id,
    label: `${id} label`,
    platform: id,
    host: "linux",
    status: "ready",
    preflight: [passing],
    tiers: { beta: { name: `${id} beta`, requires: [] } },
    async build(context) {
      calls.build.push(context);
      const path = join(scratch(`${id}-build`), `${id}.bin`);
      writeFileSync(path, `${id} artifact`);
      return {
        files: { bin: path },
        buildNumber: Number(process.env.LEAPSAKE_BUILD_NUMBER),
        bundleId: `com.example.${id}`,
      };
    },
    async publish(context) {
      calls.publish.push(context);
    },
    async release(context) {
      calls.release.push(context);
      return { commit: "c0ffee", buildNumber: "7" };
    },
    ...over,
  };
  return { target, calls };
}

const original = process.env.LEAPSAKE_BUILD_NUMBER;
afterEach(() => {
  if (original === undefined) delete process.env.LEAPSAKE_BUILD_NUMBER;
  else process.env.LEAPSAKE_BUILD_NUMBER = original;
});

describe("buildNumberNow", () => {
  it("counts minutes since 2026-01-01 UTC", () => {
    expect(buildNumberNow(Date.UTC(2026, 0, 1, 1, 30))).toBe(90);
  });
});

describe("evaluateCells", () => {
  it("reports a blocked cell with its note and runs none of its checks", async () => {
    const { target } = stub("android", {
      preflight: [failing],
      tiers: { beta: { name: "b", status: "blocked", note: "no access yet" } },
    });
    const [cell] = await evaluateCells([target], ctx());
    expect(cell).toMatchObject({ status: "blocked", note: "no access yet" });
    expect(cell.failures).toEqual([]);
  });

  it("treats a blocked target as blocked at every stage", async () => {
    const { target } = stub("mac", { status: "blocked", note: "deferred" });
    const [cell] = await evaluateCells([target], ctx());
    expect(cell).toMatchObject({ status: "blocked", note: "deferred" });
  });

  it("fails a ready cell whose requirements do not hold", async () => {
    const { target } = stub("ios", {
      tiers: { beta: { name: "b", requires: [failing] } },
    });
    const [cell] = await evaluateCells([target], ctx());
    expect(cell.status).toBe("failed");
    expect(cell.failures).toEqual([{ name: "fails", reason: "it is missing" }]);
  });

  it("checks only a marker rung's own requirements", async () => {
    const { target } = stub("ios", {
      preflight: [failing],
      tiers: { final: { name: "f", marker: true, requires: [passing] } },
    });
    const [cell] = await evaluateCells([target], ctx({ stage: "final" }));
    expect(cell).toMatchObject({ status: "ready", marker: true });
  });

  it("skips the checks when asked, for a host that cannot run them", async () => {
    const { target } = stub("ios", { preflight: [failing] });
    const [cell] = await evaluateCells([target], ctx(), { checks: false });
    expect(cell.status).toBe("ready");
  });
});

describe("planJson", () => {
  it("is the shape a workflow builds its matrices from", async () => {
    const cells = await evaluateCells(
      [
        stub("ios", { host: "macos" }).target,
        stub("android", {
          tiers: { beta: { name: "b", status: "blocked", note: "later" } },
        }).target,
      ],
      ctx(),
    );
    expect(planJson({ ...ctx(), buildNumber: 368157 }, cells)).toEqual({
      tag: "v0.1.0-beta.10",
      version: "0.1.0-beta.10",
      stage: "beta",
      core: "0.1.0",
      buildNumber: 368157,
      targets: [
        {
          id: "ios",
          platform: "ios",
          status: "ready",
          note: null,
          marker: false,
          host: "macos",
          failures: [],
        },
        {
          id: "android",
          platform: "android",
          status: "blocked",
          note: "later",
          marker: false,
          host: "linux",
          failures: [],
        },
      ],
    });
  });
});

describe("buildInto", () => {
  it("copies the artifact into <out>/<id>/ and describes it in <out>/<id>.json", async () => {
    const out = scratch("out");
    const { target } = stub("ios");
    await buildInto(target, ctx(), { buildNumber: 42, out, commit: "abc" });

    expect(readFileSync(join(out, "ios", "ios.bin"), "utf8")).toBe(
      "ios artifact",
    );
    expect(
      JSON.parse(readFileSync(join(out, "ios.json"), "utf8")),
    ).toMatchObject({
      tag: "v0.1.0-beta.10",
      target: "ios",
      buildNumber: 42,
      bundleId: "com.example.ios",
      files: { bin: join("ios", "ios.bin") },
      commit: "abc",
    });
  });

  it("refuses a build that did not use the planned number", async () => {
    const { target } = stub("ios", {
      build: async () => ({ files: {}, buildNumber: 41, bundleId: "x" }),
    });
    await expect(
      buildInto(target, ctx(), { buildNumber: 42, out: scratch("out") }),
    ).rejects.toThrow(/built number 41, not the 42/);
  });
});

describe("publishAll", () => {
  async function builtFor(targets) {
    const out = scratch("out");
    for (const target of targets) {
      await buildInto(target, ctx(), { buildNumber: 42, out, commit: "abc" });
    }
    return out;
  }

  it("publishes what build wrote, with the files made absolute", async () => {
    const ios = stub("ios");
    const out = await builtFor([ios.target]);
    const cells = await evaluateCells([ios.target], ctx());
    const results = await publishAll(cells, ctx(), {
      from: out,
      receiptsOut: out,
      log: () => {},
    });

    expect(results.map((r) => r.ok)).toEqual([true]);
    const [{ artifact }] = ios.calls.publish;
    expect(artifact).toEqual({
      buildNumber: 42,
      bundleId: "com.example.ios",
      files: { bin: join(out, "ios", "ios.bin") },
    });
    expect(receiptsIn(out)).toEqual([
      expect.objectContaining({
        target: "ios",
        buildNumber: 42,
        commit: "abc",
      }),
    ]);
  });

  it("keeps publishing the others when one fails", async () => {
    const ios = stub("ios", {
      publish: async () => {
        throw new Error("altool said no");
      },
    });
    const android = stub("android");
    const out = await builtFor([ios.target, android.target]);
    const cells = await evaluateCells([ios.target, android.target], ctx());
    const results = await publishAll(cells, ctx(), {
      from: out,
      receiptsOut: out,
      log: () => {},
    });

    expect(results.map((r) => [r.target.id, r.ok])).toEqual([
      ["ios", false],
      ["android", true],
    ]);
    expect(receiptsIn(out).map((r) => r.target)).toEqual(["android"]);
  });

  it("publishes only what --only names", async () => {
    const ios = stub("ios");
    const android = stub("android");
    const out = await builtFor([ios.target, android.target]);
    const cells = await evaluateCells([ios.target, android.target], ctx());
    await publishAll(cells, ctx(), {
      from: out,
      receiptsOut: out,
      only: ["android"],
      log: () => {},
    });
    expect(ios.calls.publish).toHaveLength(0);
    expect(android.calls.publish).toHaveLength(1);
  });

  it("skips a blocked cell even when a build of it exists", async () => {
    const android = stub("android");
    const out = await builtFor([android.target]);
    const blocked = {
      ...android.target,
      tiers: { beta: { name: "b", status: "blocked", note: "later" } },
    };
    const cells = await evaluateCells([blocked], ctx());
    const results = await publishAll(cells, ctx(), {
      from: out,
      receiptsOut: out,
      log: () => {},
    });
    expect(results).toEqual([]);
  });

  it("refuses a build directory that holds another tag", async () => {
    const ios = stub("ios");
    const out = await builtFor([ios.target]);
    const cells = await evaluateCells([ios.target], ctx());
    const other = ctx({ tag: "v0.1.0-beta.11", version: "0.1.0-beta.11" });
    const [result] = await publishAll(cells, other, {
      from: out,
      receiptsOut: out,
      log: () => {},
    });
    expect(result.reason).toMatch(/holds a build of v0\.1\.0-beta\.10/);
    expect(ios.calls.publish).toHaveLength(0);
  });

  it("releases a marker cell, with the commit it reports in the receipt", async () => {
    const ios = stub("ios", {
      tiers: { final: { name: "f", marker: true, requires: [] } },
    });
    const final = ctx({ tag: "v0.1.0", version: "0.1.0", stage: "final" });
    const out = scratch("receipts");
    const cells = await evaluateCells([ios.target], final);
    await publishAll(cells, final, { receiptsOut: out, log: () => {} });

    expect(ios.calls.release).toHaveLength(1);
    expect(receiptsIn(out)).toEqual([
      expect.objectContaining({ tag: "v0.1.0", commit: "c0ffee" }),
    ]);
    expect(builtIn(out)).toEqual([]);
  });
});

function repo() {
  const root = scratch("repo");
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "T");
  git("commit", "-q", "--allow-empty", "-m", "one");
  const first = git("rev-parse", "HEAD");
  git("commit", "-q", "--allow-empty", "-m", "two");
  return { root, git, first, head: git("rev-parse", "HEAD") };
}

describe("recordReceipts", () => {
  it("appends each receipt to the note on the commit it shipped from", () => {
    const { root, git, head } = repo();
    git("tag", "-a", "v0.1.0-beta.10", "-m", "beta");
    recordReceipts(root, "v0.1.0-beta.10", [
      { ...ctx(), target: "ios", buildNumber: 42, commit: head },
      { ...ctx(), target: "android", buildNumber: 42, commit: head },
    ]);
    expect(shipmentsFor(root, head).map((r) => r.target)).toEqual([
      "ios",
      "android",
    ]);
  });

  it("creates a marker's tag on the commit its receipts name", () => {
    const { root, git, first } = repo();
    const final = {
      ...ctx({ tag: "v0.1.0", version: "0.1.0", stage: "final" }),
    };
    recordReceipts(root, "v0.1.0", [
      { ...final, target: "ios", buildNumber: "7", commit: first },
    ]);
    expect(git("rev-list", "-n", "1", "v0.1.0")).toBe(first);
  });

  it("refuses to create a tag when the receipts disagree on the commit", () => {
    const { root, first, head } = repo();
    const final = {
      ...ctx({ tag: "v0.1.0", version: "0.1.0", stage: "final" }),
    };
    expect(() =>
      recordReceipts(root, "v0.1.0", [
        { ...final, target: "ios", commit: first },
        { ...final, target: "android", commit: head },
      ]),
    ).toThrow(/cannot name them all/);
  });
});

describe("abandonTag", () => {
  it("refuses once a receipt names the tag", () => {
    const { root, git, head } = repo();
    git("tag", "-a", "v0.1.0-beta.10", "-m", "beta");
    recordShipment(root, head, {
      tag: "v0.1.0-beta.10",
      target: "ios",
      buildNumber: 42,
    });
    expect(() => abandonTag(root, "v0.1.0-beta.10")).toThrow(
      /shipped to ios — a spent build number cannot be taken back/,
    );
    expect(git("tag", "--list")).toBe("v0.1.0-beta.10");
  });

  it("deletes a tag nothing shipped from", () => {
    const { root, git } = repo();
    git("tag", "-a", "v0.1.0-beta.10", "-m", "beta");
    expect(abandonTag(root, "v0.1.0-beta.10", { remote: "nowhere" })).toEqual({
      remote: false,
    });
    expect(git("tag", "--list")).toBe("");
    expect(existsSync(root)).toBe(true);
  });
});
