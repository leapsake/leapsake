# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**04 (mobile release pipeline)** — Play half in
[`v0-1_04_mobile-pipeline.md`](./v0-1_04_mobile-pipeline.md), iOS in
[`ios-release-pipeline.md`](./ios-release-pipeline.md). ✅ Version scheme and build numbers are
decided and encoded; the **first iOS build reached TestFlight 2026-08-25** by hand through Xcode.
⚠️ Nothing is scripted, and **EAS is out** *(owner, 2026-08-24)*: local `xcodebuild`, manual
signing, ASC API key.

⚠️ **Play is now the whole critical path**: its 14 days start only once a build is uploaded,
nothing is uploaded yet, and the **12-tester list is empty**.

**Contact methods reach people** — built 2026-08-19. Tappable rows on mobile, a fourth `social`
kind over an open platform list (`@leapsake/contact-links`), `reachableOn` on phones. Left: the
URL templates are convention, not verified — **confirm on real hardware with the apps installed**
(no simulator can). ✅ Unblocked: the TestFlight build carries the `LSApplicationQueriesSchemes`
rebuild and is on a real iPhone. `expo-contacts` socialProfiles stay unmapped for now.

Mobile gates are green on both platforms as of 2026-08-18 — `pnpm test:native` passes end to end.

**Decide before 06:** [`v0-1.md`](./v0-1.md) → *Open decisions* 1 and 2 — how much of the E2E
catalog really gates v0.1.
