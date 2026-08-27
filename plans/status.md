# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**04 (Android release target)** — [`v0-1_04_mobile-pipeline.md`](./v0-1_04_mobile-pipeline.md).
✅ The iOS half is **done**: `pnpm release alpha --only=ios` ships to TestFlight with no Xcode
session, and `0.1.0-alpha.2` went out that way on 2026-08-26. Left: fill in the `android`
target — AAB, Play App Signing upload key, service-account upload, rungs mapped to tracks.

⚠️ **Play is the whole critical path, and its shape is an open question.** The 12-tester wall
binds *personal* accounts; the owner is leaning toward forming a legal entity before stable
v0.1, which replaces it with a D-U-N-S wait. Until that is settled, **build the Android target
but do not upload** — the first upload claims the package name for whichever account made it.
[`v0-1.md`](./v0-1.md) → *Open decisions* 4.

**Desktop is out of v0.1** *(owner, 2026-08-26)* — packaging, signing and auto-update moved to
[`desktop-packaging.md`](./desktop-packaging.md), which no longer gates the release. The app
itself is unchanged and still carries the integration tier.

**Contact methods reach people** — built 2026-08-19. Left: the URL templates are convention,
not verified — **confirm on real hardware with the apps installed** (no simulator can). ✅
Unblocked: TestFlight builds are on a real iPhone. `expo-contacts` socialProfiles stay unmapped.

**Decide before 06:** [`v0-1.md`](./v0-1.md) → *Open decisions* 1 — now smaller, since the
desktop catalog no longer gates v0.1.
