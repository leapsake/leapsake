// `cut final --if-approved` is what a schedule runs every hour, unattended, and the tag it
// makes starts a public release. So it is driven here as the real CLI, against a scratch
// repository and an App Store Connect whose answers a preloaded `fetch` stub decides.
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { recordShipment } from "./receipts.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "index.mjs");

const STUB = `
const state = process.env.STUB_STATE;
const reply = (body) => new Response(JSON.stringify(body), { status: 200 });
globalThis.fetch = async (url, init) => {
  const key = \`\${init?.method ?? "GET"} \${new URL(url).pathname}\`;
  if (key === "GET /v1/apps") return reply({ data: [{ id: "APP1" }] });
  if (key === "GET /v1/apps/APP1/appStoreVersions") {
    return reply({ data: state === "NONE" ? [] : [{ id: "VER1", attributes: { appStoreState: state } }] });
  }
  if (key === "GET /v1/appStoreVersions/VER1/build") {
    return reply({ data: { id: "BUILD1", attributes: { version: "387695" } } });
  }
  throw new Error(\`unstubbed call: \${key}\`);
};
`;

/** A repo at core 0.1.0 whose rc.2 shipped build 387695 to iOS, one commit behind HEAD. */
function repo({ receipt = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cut-final-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  mkdirSync(join(root, "apps", "mobile"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{ "version": "0.1.0" }\n');
  writeFileSync(
    join(root, "apps", "mobile", "app.json"),
    JSON.stringify({ expo: { ios: { bundleIdentifier: "com.leapsake.app" } } }),
  );
  git("init", "-q", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "T");
  git("add", ".");
  git("commit", "-q", "-m", "one");
  const shipped = git("rev-parse", "HEAD");
  git("tag", "-a", "v0.1.0-rc.2", "-m", "rc.2");
  if (receipt) {
    recordShipment(root, shipped, {
      tag: "v0.1.0-rc.2",
      target: "ios",
      buildNumber: "387695",
    });
  }
  git("commit", "-q", "--allow-empty", "-m", "two");

  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const keyPath = join(root, "AuthKey_TEST.p8");
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  const stub = join(root, "stub.mjs");
  writeFileSync(stub, STUB);
  return { root, git, shipped, keyPath, stub };
}

function cutFinal({ root, keyPath, stub }, state, ...flags) {
  const run = spawnSync(
    process.execPath,
    ["--import", stub, CLI, "cut", "final", ...flags],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CI: "true",
        LEAPSAKE_RELEASE_ROOT: root,
        STUB_STATE: state,
        APPLE_APP_STORE_CONNECT_KEY_ID: "K",
        APPLE_APP_STORE_CONNECT_ISSUER_ID: "I",
        APPLE_APP_STORE_CONNECT_KEY_PATH: keyPath,
      },
    },
  );
  return { status: run.status, output: run.stdout + run.stderr };
}

const finalTag = (git) => git("tag", "--list", "v0.1.0");

describe("cut final --if-approved", () => {
  for (const state of ["WAITING_FOR_REVIEW", "IN_REVIEW", "NONE"]) {
    it(`exits 0 and tags nothing while the version is ${state}`, () => {
      const scratch = repo();
      const { status, output } = cutFinal(scratch, state, "--if-approved");
      expect(output).toMatch(/Not cutting v0\.1\.0/);
      expect(status).toBe(0);
      expect(finalTag(scratch.git)).toBe("");
    });
  }

  it("tags the commit Apple approved once the version is pending release", () => {
    const scratch = repo();
    const { status } = cutFinal(
      scratch,
      "PENDING_DEVELOPER_RELEASE",
      "--if-approved",
    );
    expect(status).toBe(0);
    expect(scratch.git("rev-list", "-n", "1", "v0.1.0")).toBe(scratch.shipped);
  });

  it("exits 0 without asking the store once the final tag exists", () => {
    const scratch = repo();
    scratch.git("tag", "-a", "v0.1.0", "-m", "final", scratch.shipped);
    const { status, output } = cutFinal(scratch, "UNSTUBBED", "--if-approved");
    expect(output).toMatch(/already tagged/);
    expect(status).toBe(0);
  });

  it("still fails when an approved build has no receipt to name its commit", () => {
    const scratch = repo({ receipt: false });
    const { status } = cutFinal(
      scratch,
      "PENDING_DEVELOPER_RELEASE",
      "--if-approved",
    );
    expect(status).toBe(1);
    expect(finalTag(scratch.git)).toBe("");
  });

  it("leaves a plain cut final refusing a version still in review", () => {
    const scratch = repo();
    const { status, output } = cutFinal(scratch, "IN_REVIEW");
    expect(output).toMatch(/IN_REVIEW/);
    expect(status).toBe(1);
    expect(finalTag(scratch.git)).toBe("");
  });
});
