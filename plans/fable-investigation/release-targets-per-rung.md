# Release targets declare readiness per rung, and the gate follows the targets

**Decision (owner, 2026-09-16):** `pnpm release <rung>` with no `--only` must ship to exactly
the platforms that are ready _at that rung_, and the test gate must exercise exactly those
platforms' device tiers. `--only` stays as an override for the exceptional case and should never
be needed in the normal flow.

## What the owner wants, concretely

| Command              | Today (2026-09-16) | Once Android's closed test starts | After Android earns production access |
| -------------------- | ------------------ | --------------------------------- | ------------------------------------- |
| `pnpm release alpha` | iOS, Android       | iOS, Android                      | iOS, Android                          |
| `pnpm release beta`  | iOS, Android       | iOS, Android                      | iOS, Android                          |
| `pnpm release rc`    | iOS only           | iOS only                          | iOS, Android                          |
| `pnpm release final` | iOS only           | iOS only                          | iOS, Android                          |

Versions stay in sync across platforms: a tag covers the whole repo, and the platforms it
reaches are per-invocation (that rule already exists in `scripts/release/index.mjs`). So iOS can
go GA on `v0.1.0` while Android is mid closed test, and Android's first GA is whatever tag is
current when Play allows it. There may be no Android `0.1.0` GA. Nothing about that needs new
bookkeeping: `refs/notes/releases` already records which platform shipped which tag.

## What exists today

- `scripts/release/targets/*.mjs`: each target has one `status: "ready" | "blocked"` for all
  rungs, plus `tiers.<rung>` with `requires` (checks) and `manual` (strings). Android is
  `blocked` at every rung because its upload is not scripted
  (`plans/android-pipeline.md`).
- `scripts/release/index.mjs`: selects targets by `--only` or "every ready target", runs
  `pnpm test:all --strict --provision` with **no platform filter**, then builds and publishes
  the selected targets.
- `scripts/test-all.mjs`: the device tiers (`native-android`, `native-ios`, `e2e`) each
  hard-code their platform, and `e2e` drives both platforms in one run. There is no way to
  say "iOS only" short of `--only=<tier keys>`.
- `CONTRIBUTING.md` → _The E2E release gate_ already states the rule this doc implements: "a
  platform's gate travels with that platform's release". The code does not honour it.

## The change

### 1. Readiness moves onto the rung

Each `tiers.<rung>` entry gains an optional `status` and `note`, defaulting to the target's own.
A target that is `ready` overall but withheld at one rung says so where the rung is defined:

```js
rc: {
  name: "closed testing track (ship-ready)",
  status: "blocked",
  note: "production access needs the 12-tester/14-day closed test — plans/android-pipeline.md",
  requires: [],
},
final: { name: "production track", status: "blocked", note: "same clock as rc" },
```

`index.mjs` resolves a target's readiness as `target.tiers[stage].status ?? target.status`
everywhere it currently reads `target.status`. Blocked-at-this-rung targets are reported ⏳ with
their note, exactly as blocked targets are today. `--help` and `--dry-run` print the matrix
from the same data, so the table above is generated, never hand-maintained.

`android-pipeline.md` already decided that `final` must refuse on Android until the clock
finishes and that the refusal must come from preflight, not mid-release. This is how.

### 2. The gate follows the selected targets

`index.mjs` passes the ready targets' platforms to the suite:

```
pnpm test:all --strict --provision --platforms=ios,android
```

`test-all.mjs` filters `device: true` tiers by a `platform` field (`native-android` →
`android`, `native-ios` → `ios`, `e2e` → both) and forwards `--platform=<x>` to `test-e2e.mjs`
for each selected platform, which already accepts it. With no `--platforms`, `pnpm test:all`
keeps today's behaviour and runs everything reachable, so a developer still gets the whole
trophy.

Under `--strict` an un-bootable emulator is still a failure, but only when Android is in the
release. That is the whole point: nothing is waived, and nothing is run for a platform that is
not shipping.

### 3. macOS, when it comes

The desktop target follows the same shape: its device tier is the desktop E2E harness
(`ci-and-test-tiers.md` → _Desktop_), keyed `mac`, and it runs when `mac` is a ready target at
that rung. Windows and Linux stay blocked on a host, as CONTRIBUTING already says.

## Steps, each a commit

1. Per-rung `status`/`note` on targets; `index.mjs` reads it; `--dry-run`/`--help` show it.
   Test in `scripts/release/*.test.mjs` beside the existing version and receipts tests.
2. `--platforms` on `test-all.mjs`, `platform` on the device tiers, forwarded to
   `test-e2e.mjs` and `test-native.mjs`. Test the filtering.
3. `index.mjs` passes the selected platforms. Update `CONTRIBUTING.md` → _The E2E release
   gate_ to say the gate is now enforced, not described.
4. Flip Android to `ready` with `rc` and `final` blocked at the rung, once `play.mjs` exists
   (`plans/android-pipeline.md` owns that half; this doc does not).

## Out of scope

The Play upload itself, the rung-to-track naming collision, and the closed-test group are all
`plans/android-pipeline.md`. This doc is only the readiness model and the gate plumbing.
