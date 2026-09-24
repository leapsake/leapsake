import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  parseSearchList,
  profileUuid,
  signingFilesProblem,
  stageSigningIdentity,
} from "./ios-signing.mjs";

const UUID = "0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0";
const PROFILE_PLIST = `<plist><dict><key>Name</key><string>Leapsake App Store</string>
<key>UUID</key>
<string>${UUID}</string></dict></plist>`;
const LOGIN = "/Users/george/Library/Keychains/login.keychain-db";

/** A stand-in for `security` that remembers the search list it is told to set. */
function fakeSecurity({ failOn } = {}) {
  let searchList = [LOGIN];
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === failOn) throw new Error(`${failOn} failed`);
    if (args[0] === "list-keychains" && args.includes("-s")) {
      searchList = args.slice(args.indexOf("-s") + 1);
    }
    if (args[0] === "list-keychains") {
      return searchList.map((path) => `    "${path}"`).join("\n");
    }
    if (args[0] === "cms") return PROFILE_PLIST;
    return "";
  };
  return { run, calls, searchList: () => searchList };
}

describe("stageSigningIdentity", () => {
  let dir;
  let env;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leapsake-signing-"));
    for (const name of ["dist.p12", "password", "dist.mobileprovision"]) {
      writeFileSync(join(dir, name), name === "password" ? "hunter2\n" : "x");
    }
    env = {
      IOS_DIST_CERT_P12_PATH: join(dir, "dist.p12"),
      IOS_DIST_CERT_PASSWORD_PATH: join(dir, "password"),
      IOS_PROVISIONING_PROFILE_PATH: join(dir, "dist.mobileprovision"),
    };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const stage = (security) =>
    stageSigningIdentity({ env, run: security.run, home: dir, tempDir: dir });

  it("does nothing when no runner signing files are set", () => {
    const security = fakeSecurity();
    stageSigningIdentity({ env: {}, run: security.run })();
    expect(security.calls).toEqual([]);
  });

  it("puts the throwaway keychain first in the search list, then restores it", () => {
    const security = fakeSecurity();

    const teardown = stage(security);
    const [staged, ...rest] = security.searchList();
    expect(staged).toMatch(/leapsake-signing-\d+\.keychain-db$/);
    expect(rest).toEqual([LOGIN]);

    teardown();
    expect(security.searchList()).toEqual([LOGIN]);
    expect(security.calls.at(-1)).toEqual(["delete-keychain", staged]);
  });

  it("imports the .p12 with the password from its file, for codesign", () => {
    const security = fakeSecurity();
    stage(security)();

    const imported = security.calls.find((args) => args[0] === "import");
    expect(imported.slice(0, 2)).toEqual([
      "import",
      env.IOS_DIST_CERT_P12_PATH,
    ]);
    expect(imported[imported.indexOf("-P") + 1]).toBe("hunter2");
    expect(imported).toContain("/usr/bin/codesign");
  });

  it("installs the profile under its UUID where Xcode looks, and removes it after", () => {
    const security = fakeSecurity();
    const installed = [
      join(dir, "Library/Developer/Xcode/UserData/Provisioning Profiles"),
      join(dir, "Library/MobileDevice/Provisioning Profiles"),
    ].map((folder) => join(folder, `${UUID}.mobileprovision`));

    const teardown = stage(security);
    expect(installed.every((path) => existsSync(path))).toBe(true);

    teardown();
    expect(installed.some((path) => existsSync(path))).toBe(false);
  });

  it("tears down what it made when a step fails, and rethrows", () => {
    const security = fakeSecurity({ failOn: "import" });

    expect(() => stage(security)).toThrow("import failed");
    expect(security.searchList()).toEqual([LOGIN]);
    expect(security.calls.at(-1)[0]).toBe("delete-keychain");
  });

  it("refuses a half-configured runner before touching the keychain", () => {
    const security = fakeSecurity();
    delete env.IOS_PROVISIONING_PROFILE_PATH;

    expect(() => stage(security)).toThrow(/go together/);
    expect(security.calls).toEqual([]);
  });
});

describe("signingFilesProblem", () => {
  it("names a path that points at nothing", () => {
    expect(
      signingFilesProblem({
        IOS_DIST_CERT_P12_PATH: "/nowhere/dist.p12",
        IOS_DIST_CERT_PASSWORD_PATH: "/nowhere/password",
        IOS_PROVISIONING_PROFILE_PATH: "/nowhere/dist.mobileprovision",
      }),
    ).toBe("IOS_DIST_CERT_P12_PATH names no file");
  });
});

describe("the parsers", () => {
  it("reads the quoted paths security prints", () => {
    expect(
      parseSearchList(
        `    "${LOGIN}"\n    "/Library/Keychains/System.keychain"\n`,
      ),
    ).toEqual([LOGIN, "/Library/Keychains/System.keychain"]);
  });

  it("reads a profile's UUID, and refuses a plist without one", () => {
    expect(profileUuid(PROFILE_PLIST)).toBe(UUID);
    expect(() => profileUuid("<plist/>")).toThrow(/no UUID/);
  });
});
