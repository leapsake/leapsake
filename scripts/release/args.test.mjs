// Every invocation the header, CONTRIBUTING.md and the workflows use, as the handlers see it.
import { describe, expect, it } from "vitest";

import { parseReleaseArgs } from "./args.mjs";

const parse = (line) => {
  const { positional, flags, values } = parseReleaseArgs(line.split(" "));
  return { positional, flags: [...flags].sort(), values };
};

describe("parseReleaseArgs", () => {
  it.each([
    [
      "cut beta --push --dry-run --no-checks --outputs=/gh/output",
      {
        positional: ["cut", "beta"],
        flags: ["dry-run", "no-checks", "push"],
        values: { outputs: "/gh/output" },
      },
    ],
    [
      "cut final --if-approved --no-checks --push --outputs=/gh/output",
      {
        positional: ["cut", "final"],
        flags: ["if-approved", "no-checks", "push"],
        values: { outputs: "/gh/output" },
      },
    ],
    [
      "plan --tag=v0.1.0-rc.2 --json --no-checks --outputs=/gh/output",
      {
        positional: ["plan"],
        flags: ["json", "no-checks"],
        values: { tag: "v0.1.0-rc.2", outputs: "/gh/output" },
      },
    ],
    [
      "gate --platforms=ios,android --tag=v0.1.0-rc.2 --no-provision",
      {
        positional: ["gate"],
        flags: ["no-provision"],
        values: { platforms: "ios,android", tag: "v0.1.0-rc.2" },
      },
    ],
    [
      "build --tag=v0.1.0-rc.2 --only=ios --build-number=387695 --out=/tmp/out",
      {
        positional: ["build"],
        flags: [],
        values: {
          tag: "v0.1.0-rc.2",
          only: "ios",
          "build-number": "387695",
          out: "/tmp/out",
        },
      },
    ],
    [
      "publish --tag=v0.1.0-rc.2 --from=/tmp/out --only=ios --receipts-out=/tmp/receipts",
      {
        positional: ["publish"],
        flags: [],
        values: {
          tag: "v0.1.0-rc.2",
          from: "/tmp/out",
          only: "ios",
          "receipts-out": "/tmp/receipts",
        },
      },
    ],
    [
      "publish --tag=v0.1.0-rc.2 --from=/tmp/out --here",
      {
        positional: ["publish"],
        flags: ["here"],
        values: { tag: "v0.1.0-rc.2", from: "/tmp/out" },
      },
    ],
    [
      "record --tag=v0.1.0-rc.2 --from=/tmp/receipts --push",
      {
        positional: ["record"],
        flags: ["push"],
        values: { tag: "v0.1.0-rc.2", from: "/tmp/receipts" },
      },
    ],
    [
      "abandon --tag=v0.1.0-rc.2",
      { positional: ["abandon"], flags: [], values: { tag: "v0.1.0-rc.2" } },
    ],
    [
      "ship --tag=v0.1.0 --here --dry-run --no-provision --first-release --commit=abc123",
      {
        positional: ["ship"],
        flags: ["dry-run", "first-release", "here", "no-provision"],
        values: { tag: "v0.1.0", commit: "abc123" },
      },
    ],
    [
      "materialize --into=/tmp/secrets --env-out=.env",
      {
        positional: ["materialize"],
        flags: [],
        values: { into: "/tmp/secrets", "env-out": ".env" },
      },
    ],
    ["--help", { positional: [], flags: ["help"], values: {} }],
  ])("%s", (line, expected) => {
    expect(parse(line)).toEqual(expected);
  });

  it("takes a value after a space as well as after =", () => {
    expect(parse("build --tag v0.1.0-rc.2 --only ios --out /tmp/out")).toEqual(
      parse("build --tag=v0.1.0-rc.2 --only=ios --out=/tmp/out"),
    );
  });

  it("keeps extra positionals for the command to judge", () => {
    expect(parse("cut beta extra").positional).toEqual([
      "cut",
      "beta",
      "extra",
    ]);
  });

  it("rejects a flag it does not know", () => {
    expect(() => parse("cut beta --dryrun")).toThrow(/dryrun/);
  });
});
