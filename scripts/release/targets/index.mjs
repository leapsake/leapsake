// The target registry — the list of things a release can ship to.
//
// This mirrors the tier registry in `scripts/test-all.mjs` on purpose, down to the
// `ready` / `blocked` vocabulary: a target that cannot ship is **reported ⏳, never
// silently omitted**, so "everything reachable, or explicitly blocked — not waived"
// (CONTRIBUTING.md → Testing, principle 6) holds for shipping as well as for testing. A release
// that quietly skipped a platform would be indistinguishable from one that shipped it.
//
// ## The contract
//
//     id         CLI selector, e.g. `--only=ios`
//     label      what the summary calls it
//     status     "ready" | "blocked"
//     note       required when blocked: what is missing, and where the plan lives
//     preflight  checks that must hold for *any* release to this target
//     tiers      per stage: { name, requires: [checks], manual: [strings] }
//     build(ctx) produce the artifact
//     publish(ctx) hand it to the store, feed, or host
//
// `requires` is what the *rung* demands beyond the target's baseline — an external
// TestFlight build needs a real app icon where an internal one does not. `manual` is the
// honest half: prerequisites that live in a console we cannot inspect from here. They are
// printed with the plan rather than pretended to be gates, because a check that cannot
// actually check anything is worse than a line of text that admits it.
//
// ## Stages are per-target, deliberately
//
// There is no central stage table, because `beta` means external TestFlight on iOS, a
// closed track on Play, and would mean a preview deployment on the web. A single table
// holding all of that would be wrong the first time a platform disagreed with it, and
// `--help` builds its matrix by asking the registry instead.
//
// ## Adding one
//
// A new target is a file here plus a line below. Nothing else in the release path knows
// what platforms exist. A non-store target (a web client, `apps/server`) fits the same
// contract with `publish` meaning "deploy" — the interface deliberately says nothing about
// stores, build numbers, or artifacts-as-files. Such a target is also the first place the
// single-version rule will strain, since something that deploys continuously has no reason
// to be pinned to a client's version; that is a decision to make then, not now.
import android from "./android.mjs";
import ios from "./ios.mjs";
import mac from "./mac.mjs";

/** Ordered by how close each is to shipping, which is also the order they are reported. */
export const TARGETS = [ios, android, mac];

export const targetById = (id) => TARGETS.find((target) => target.id === id);
