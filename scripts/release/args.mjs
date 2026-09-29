// The release command's argument parser: positionals, boolean flags and string values.
import { parseArgs } from "node:util";

const STRING_OPTIONS = [
  "tag",
  "only",
  "commit",
  "build-number",
  "out",
  "from",
  "receipts-out",
  "platforms",
  "into",
  "env-out",
  "outputs",
];
const BOOLEAN_OPTIONS = [
  "help",
  "first-release",
  "dry-run",
  "here",
  "if-approved",
  "json",
  "no-checks",
  "no-provision",
  "push",
];

const OPTIONS = Object.fromEntries([
  ...STRING_OPTIONS.map((name) => [name, { type: "string" }]),
  ...BOOLEAN_OPTIONS.map((name) => [name, { type: "boolean" }]),
]);

/** Split `argv` into `{ positional, flags, values }`; throws on an undeclared or malformed flag. */
export function parseReleaseArgs(argv) {
  const parsed = parseArgs({
    args: argv,
    options: OPTIONS,
    strict: true,
    allowPositionals: true,
  });
  const flags = new Set(BOOLEAN_OPTIONS.filter((name) => parsed.values[name]));
  const values = Object.fromEntries(
    STRING_OPTIONS.filter((name) => parsed.values[name] !== undefined).map(
      (name) => [name, parsed.values[name]],
    ),
  );
  return { positional: parsed.positionals, flags, values };
}
