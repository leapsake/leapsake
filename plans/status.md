# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**04 (mobile EAS pipeline)** — [`v0-1_04_mobile-pipeline.md`](./v0-1_04_mobile-pipeline.md).
Nothing built; no `eas.json`. Blocked on two owner decisions in its own doc — the real `version`
string and the `buildNumber`/`versionCode` strategy, both permanent after the first upload. The
mechanism exists (`scripts/set-version.mjs`); only the choice is missing.

✅ **Both developer accounts exist** *(owner, 2026-08-19)*, and App Store Connect holds a Leapsake
record — form only, no build. Apple no longer gates 05B or 07B. ⚠️ **04 is now the whole critical
path**: Play's 14 days start only once a build is uploaded, and the **12-tester list is empty**.

**Contact methods reach people** — built 2026-08-19. Tappable rows on mobile, a fourth `social`
kind over an open platform list (`@leapsake/contact-links`), `reachableOn` on phones. Left: the
URL templates are convention, not verified — **confirm on real hardware with the apps installed**
(no simulator can), which needs a native rebuild for `LSApplicationQueriesSchemes`; fold it into
04's first build. `expo-contacts` socialProfiles stay unmapped for now.

Mobile gates are green on both platforms as of 2026-08-18 — `pnpm test:native` passes end to
end.

**Decide before 06:** [`v0-1.md`](./v0-1.md) → *Open decisions* 1 and 2 — how much of the E2E
catalog really gates v0.1.
