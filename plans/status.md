# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**04 (Android release target)** — [`v0-1_04_mobile-pipeline.md`](./v0-1_04_mobile-pipeline.md).
✅ The iOS half is **done**: `pnpm release alpha` ships to TestFlight with no Xcode session, and
`0.1.0-alpha.3` went out that way. Left: fill in the `android` target — AAB, Play App Signing
upload key, service-account upload, rungs mapped to tracks.

⚠️ **Play is the whole critical path, and its shape is an open question.** The 12-tester wall
binds *personal* accounts; the owner is leaning toward forming a legal entity before stable
v0.1, which replaces it with a D-U-N-S wait. Until that is settled, **build the Android target
but do not upload** — the first upload claims the package name for whichever account made it.
[`v0-1.md`](./v0-1.md) → *Open decisions* 4.

**10 (external TestFlight)** — [`v0-1_10_external-testflight.md`](./v0-1_10_external-testflight.md).
`pnpm release beta` to external testers, unattended. **Independent of 04** — iOS only, so it does
not wait on Play, and either may be picked up first. Gated on **06**: `beta` runs the suite
`--strict` and the `e2e` tier is not built. **Settle [`v0-1.md`](./v0-1.md) → *Open decisions* 1
before starting** — smaller again if the first beta is iOS-only, since it then sets the mobile
bar for one platform rather than two.

**Contact methods reach people** — built 2026-08-19. Left: the URL templates are convention,
not verified — **confirm on real hardware with the apps installed** (no simulator can). ✅
Unblocked: TestFlight builds are on a real iPhone. `expo-contacts` socialProfiles stay unmapped.
