// The check primitive: `{ name, check(ctx) }`, returning `undefined` or a
// string saying what is missing and how to supply it. See the README.
import { existsSync, statSync } from "node:fs";

/** An environment variable that must be present and non-empty. */
export const envSet = (name, why) => ({
  name,
  check: () =>
    process.env[name]?.trim() ? undefined : `${name} is not set — ${why}`,
});

/** An environment variable naming a file that must exist: credentials come by
 *  path, so a laptop and a runner both work. */
export const fileAt = (name, why, { suffix } = {}) => ({
  name,
  check: () => {
    const path = process.env[name]?.trim();
    if (!path) return `${name} is not set — ${why}`;
    if (!existsSync(path) || !statSync(path).isFile()) {
      return `${name} points at "${path}", which is not a file`;
    }
    if (suffix && !path.endsWith(suffix)) {
      return `${name} should name a ${suffix} file, got "${path}"`;
    }
    return undefined;
  },
});

/** Runs checks in order, cheapest first, awaiting any async one; one
 *  `{ name, reason }` per failure. */
export async function runChecks(checks, ctx) {
  const failures = [];
  for (const { name, check } of checks) {
    let reason;
    try {
      reason = await check(ctx);
    } catch (error) {
      reason = `check threw: ${error.message}`;
    }
    if (reason) failures.push({ name, reason });
  }
  return failures;
}
