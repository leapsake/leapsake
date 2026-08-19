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

⚠️ **The two long clocks have not started** — Apple enrollment, Play enrollment, the 12-tester
list. Zero effort, weeks of latency, gate 05 and 07. The real critical path.

**Contact methods reach people** — built 2026-08-19, unpushed. Tappable rows on mobile, a
fourth `social` kind over an open platform list (`@leapsake/contact-links`), `reachableOn` on
phones. Left: the URL templates are convention, not verified — **confirm on real hardware with
the apps installed** (no simulator can), which also needs a native rebuild for
`LSApplicationQueriesSchemes`. `expo-contacts` socialProfiles stay unmapped for now.

Mobile gates are green on both platforms as of 2026-08-18 — `pnpm test:native` passes end to
end.

**Decide before 06:** [`v0-1.md`](./v0-1.md) → *Open decisions* 1 and 2 — how much of the E2E
catalog really gates v0.1.
