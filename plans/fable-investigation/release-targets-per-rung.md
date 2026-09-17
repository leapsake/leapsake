# The test gate runs the platforms in the release, not every platform

**Decision (owner, 2026-09-16):** `pnpm release <rung>` with no `--only` ships to exactly the
platforms that are ready at that rung, and the test gate exercises exactly those platforms'
device tiers. `--only` stays as an override for the exceptional case and should never be needed
in the normal flow.

The shipping half of that is done. What is left is the gate.

## What the Android pipeline already settled

This doc originally proposed a per-rung `status`/`note` on each target, so Android could be
`ready` overall but withheld at `rc` and `final`. `plans/android-pipeline.md` reached the same
end by a better route and shipped it, so **that half is cancelled**:

- `scripts/release/targets/android.mjs` is `status: "ready"`, and its `rc` tier is the closed
  track with a loud `manual` notice rather than a refusal — so an iOS `rc` is never blocked by
  an Android rung that cannot exist yet.
- `final` carries the `productionAccess` check in `requires`, which refuses at preflight with
  the reason. That is the "refuse before the release starts, not mid-way" rule this doc wanted,
  expressed as a check instead of a status.

A target-level `status` plus per-rung `requires` turns out to say everything the per-rung status
would have. Do not re-introduce it.

## What is left: the gate follows the selected targets

`scripts/release/index.mjs` runs `pnpm test:all --strict --provision` with **no platform
filter**, and `scripts/test-all.mjs`'s device tiers (`native-android`, `native-ios`, `e2e`)
hard-code their platform, with `e2e` driving both in one run. There is no way to say "iOS only"
short of naming tier keys with `--only`.

`CONTRIBUTING.md` → _The E2E release gate_ already states the rule: "a platform's gate travels
with that platform's release". The code does not honour it.

### Steps, each a commit

1. `--platforms=<list>` on `test-all.mjs`; a `platform` field on the device tiers
   (`native-android` → `android`, `native-ios` → `ios`, `e2e` → both), forwarded as
   `--platform=<x>` to `test-e2e.mjs` and `test-native.mjs`, which already accept it. With no
   `--platforms`, `pnpm test:all` keeps today's behaviour and runs everything reachable, so a
   developer still gets the whole trophy. Test the filtering.
2. `index.mjs` passes the ready targets' platforms. Update `CONTRIBUTING.md` → _The E2E release
   gate_ to say the gate is now enforced, not described.

Under `--strict` an un-bootable emulator is still a failure, but only when Android is in the
release. That is the whole point: nothing is waived, and nothing is run for a platform that is
not shipping.

## Why this is no longer urgent

iOS and Android are both ready at every rung today, so running both platforms' device tiers is
currently the correct thing to do — the filter would change nothing. It becomes load-bearing
when a platform goes blocked again, or when macOS arrives: the desktop target follows the same
shape, its device tier being the desktop E2E harness (`ci-and-test-tiers.md` → _Desktop_), keyed
`mac`, running when `mac` is a ready target. Windows and Linux stay blocked on a host, as
CONTRIBUTING already says.

## Out of scope

The Play upload, the rung-to-track naming collision, and the closed-test group are all
`plans/android-pipeline.md`.
