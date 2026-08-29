// The check primitive every preflight is built from, and the handful of generic checks
// more than one target needs.
//
// A check is `{ name, check(ctx) }` where `check` returns `undefined` when the condition
// holds, or a **string saying what is missing and how to supply it**. That string is the
// documentation: it is read at the moment it matters, by whoever is trying to ship, which
// is the one place a rule cannot be stale or unread. Nothing about a release precondition
// should live only in prose somewhere else.
import { existsSync, statSync } from "node:fs";

/** An environment variable that must be present and non-empty. */
export const envSet = (name, why) => ({
  name,
  check: () =>
    process.env[name]?.trim() ? undefined : `${name} is not set — ${why}`,
});

/**
 * An environment variable naming a file that must exist. Credentials are passed by path
 * rather than read from a fixed location on purpose: the same code has to run against a
 * developer's keychain-adjacent files and against a runner's secrets, and neither may be
 * committed. See `.gitignore` for the credential shapes already excluded.
 */
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

/**
 * Run a list of checks against a context, returning one `{ name, reason }` per failure.
 *
 * **`check` may be async**, and the result is awaited. Almost every check here is offline
 * and synchronous on purpose — a preflight that needs the network is a preflight that
 * fails when the network does — but one is not: `targets/ios.mjs` makes a single live App
 * Store Connect call to catch a wrongly-scoped API key *before* a twenty-minute archive
 * rather than after the upload it cannot follow. Awaiting here is what makes that
 * possible; without it a promise would be truthy and every async check would "fail" with
 * its own object as the reason.
 *
 * Sequential rather than parallel: checks are ordered cheapest-first so the common failure
 * is reported without paying for the expensive ones, and the output reads in the order the
 * list is written.
 */
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
