// The targets a release can ship to. A new one is a file here plus a line below.
//
//     id           selector for `--only`
//     label        what the summary calls it
//     platform     what it ships for; `host` is the OS its build needs ("macos" | "linux")
//     status       "ready" | "blocked", with a `note` when blocked: every cell is blocked
//     preflight    checks every building cell needs
//     tiers        per stage: { name, requires, manual, status?, note?, marker? }
//     build(ctx)   → { files: { name: path }, buildNumber, bundleId }; spends nothing
//     publish(ctx) upload `ctx.artifact`, which is that result with the files copied
//     release(ctx) a marker rung's whole work → { commit, buildNumber }
//
// A cell whose tier is `status: "blocked"` is policy: reported ⏳ with its `note`, and
// skipped. A ready cell whose `preflight`/`requires` fail is misconfigured, and fails.
import android from "./android.mjs";
import ios from "./ios.mjs";
import mac from "./mac.mjs";

/** Reported in this order. */
export const TARGETS = [ios, android, mac];

export const targetById = (id) => TARGETS.find((target) => target.id === id);
