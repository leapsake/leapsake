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

**Contact methods reach people** — shipped 2026-08-19, unpushed. Rows are tappable on mobile
(primary action + `⋯` sheet), a fourth `social` kind with an open platform list
(`@leapsake/contact-links`), and phones carry `reachableOn` for WhatsApp/Signal. Left: the URL
templates are convention, not verified — **confirm on real hardware with the apps installed**,
which also needs a native rebuild for `LSApplicationQueriesSchemes`. `expo-contacts`
socialProfiles are still unmapped (a `getAllDetails` change).

## Mobile gates — **all green on both platforms**, 2026-08-18

The three that were red or blocked are fixed; `pnpm test:native` passes end to end. The one
worth knowing about: `driver-selftest` was red because it was **finding a real bug**.
expo-sqlite caches connections by name, so `storeState`'s keyless probe returned the caller's
own keyed connection and read an encrypted store as `plaintext` — which made the merge flow's
at-rest guard refuse **every real merge on mobile**, not just the test
(`apps/mobile/db/convert-store.ts`). The other two were harness-level: a stale Android prebuild
holding the old bundle id, and the dev client's floating menu button swallowing taps
(`apps/mobile/maestro/README.md`).

**Decide before 06:** [`v0-1.md`](./v0-1.md) → *Open decisions* 1 and 2 — how much of the E2E
catalog really gates v0.1.
