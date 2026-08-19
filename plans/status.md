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

## Mobile gates *(all re-run 2026-08-18)*

- ✅ **Android bundle id.** `android/`/`ios/` are *gitignored*, not committed — a stale local
  prebuild held `net.leapsake.mobile`. `expo prebuild -p android --clean` fixed it, and
  `global-nav.yaml` now passes on **both** platforms from one byte-identical file.
- ✅ **`staged-gift-occasions.yaml` — green on both platforms**, five cases each. Two causes,
  both now fixed: the dev client's floating menu button is an overlay that turns a tap under it
  into "the dev menu opened" (off in the iOS build via `ios.infoPlist`, and set by
  `pnpm test:native` on both); and `SelectField` is a wheel on iOS but a list dialog on
  Android, so the occasion subflow now branches. See `apps/mobile/maestro/README.md`.
- ✅ **`driver-selftest.yaml` — PASS 43/43 on both.** It was red because it was **finding a real
  bug**: expo-sqlite caches connections by name, so `storeState`'s keyless probe returned the
  caller's own keyed connection and reported an encrypted store as `plaintext` — which made the
  merge flow's at-rest guard refuse **every real merge on mobile**, not just the test. Fixed with
  `useNewConnection`; see `apps/mobile/db/convert-store.ts`.

**All three mobile gates are now green on both platforms.** `pnpm test:native` passes end to end.
**Decide before 06:** [`v0-1.md`](./v0-1.md) → *Open decisions* 1 and 2 — how much of the E2E
catalog really gates v0.1.
