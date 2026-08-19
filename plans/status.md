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
- ✅ **`staged-gift-occasions.yaml` — green on iOS**, five cases. Cause was the one guessed
  here: the dev client's floating menu button is an overlay, so a tap under it opens the dev
  menu instead. `pnpm test:native` now hides it on both platforms. **Still red on Android** for
  a real, unrelated reason: `SelectField` is a wheel on iOS but a native list dialog on Android,
  so `tapOn: "Done"` has nothing to hit. See `apps/mobile/maestro/README.md`.
- ❌ **`driver-selftest.yaml` — FAIL 40/42, and *not* iOS-specific**: identical on Android. One
  failing case is `leaves the live store, its roster entry and the keychain intact when the
  login fails`; the second is unidentified. Predates all of the above, and belongs to 06.

**Decide before 06:** [`v0-1.md`](./v0-1.md) → *Open decisions* 1 and 2 — how much of the E2E
catalog really gates v0.1. That call makes the two items above blockers or fast-follows.
