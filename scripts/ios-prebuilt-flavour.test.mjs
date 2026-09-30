import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nonDebugPrebuilts } from "./ios-prebuilt-flavour.mjs";

const binary = (name) =>
  `${name}.xcframework/ios-arm64_x86_64-simulator/${name}.framework/${name}`;

let pods;
let staging;

beforeEach(() => {
  pods = mkdtempSync(join(tmpdir(), "pods-"));
  staging = mkdtempSync(join(tmpdir(), "staging-"));
});

afterEach(() => {
  rmSync(pods, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
});

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** Packs `files` (path → content) into `Pods/<tarball>`. */
function tarball(tarballPath, files) {
  const dir = mkdtempSync(join(staging, "t-"));
  for (const [path, content] of Object.entries(files))
    write(dir, path, content);
  mkdirSync(dirname(join(pods, tarballPath)), { recursive: true });
  execFileSync("tar", [
    "-czf",
    join(pods, tarballPath),
    "-C",
    dir,
    ...Object.keys(files),
  ]);
}

/** An Expo-style pod: tarballs in `Pods/<Pod>/artifacts/`, unpacked beside them. */
function expoPod(name, installed) {
  tarball(`${name}/artifacts/${name}-debug.tar.gz`, {
    [binary(name)]: `${name} debug`,
  });
  tarball(`${name}/artifacts/${name}-release.tar.gz`, {
    [binary(name)]: `${name} release`,
  });
  write(pods, `${name}/${binary(name)}`, `${name} ${installed}`);
}

describe("nonDebugPrebuilts", () => {
  it("passes pods whose installed binary is the Debug build", () => {
    expoPod("ExpoFont", "debug");
    expoPod("ExpoModulesCore", "debug");
    expect(nonDebugPrebuilts(pods)).toEqual([]);
  });

  it("names each pod left on its Release build", () => {
    expoPod("ExpoFont", "debug");
    expoPod("ExpoModulesCore", "release");
    expect(nonDebugPrebuilts(pods)).toEqual(["ExpoModulesCore"]);
  });

  it("finds a binary unpacked under another prefix and pod name", () => {
    tarball("ReactNativeCore-artifacts/reactnative-core-1.0.0-debug.tar.gz", {
      [`third-party/${binary("React")}`]: "React debug",
    });
    write(
      pods,
      `React-Core-prebuilt/framework/${binary("React")}`,
      "React release",
    );
    expect(nonDebugPrebuilts(pods)).toEqual(["reactnative-core-1.0.0"]);
  });

  it("skips a tarball with no simulator binary, or none installed", () => {
    tarball("Headers-artifacts/headers-debug.tar.gz", {
      "include/a.h": "debug",
    });
    tarball("Absent/artifacts/Absent-debug.tar.gz", {
      [binary("Absent")]: "debug",
    });
    expect(nonDebugPrebuilts(pods)).toEqual([]);
  });
});
