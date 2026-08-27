# v0.1 · 06 — Crucial-flow E2E

> **Delete this doc when the work lands.** The tiers and the testing principles are permanent
> and live in [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *Testing*; the flow catalog is
> [`testing/crucial-flows.md`](./testing/crucial-flows.md).

**Value:** the first automated proof a real user can complete the crucial journeys.

✅ **Section B landed 2026-08-26**, in a different shape than planned — see below. What is left
of this doc is the harness and the policy question.

⚠️ **This is now a mobile increment.** Desktop is deferred past v0.1
*(owner, 2026-08-26)*, so section A — a Playwright/Electron harness against a packaged `.app` —
leaves v0.1 with it and waits on [`desktop-packaging.md`](./desktop-packaging.md) → A. The
v0.1 gate is **Maestro on iOS and Android**, and open decision 1 in [`v0-1.md`](./v0-1.md)
is correspondingly smaller than when it was written. **Settle it before starting**, not by
build order.

## A — The desktop harness *(no longer v0.1)*

- Commit to **Playwright** (`_electron.launch()`), per section C's vendor-neutrality rule.
- Implement catalog Flows **1–5, 7b, 7c** ([`testing/crucial-flows.md`](./testing/crucial-flows.md))
  — the single-instance set. Flows 1–4 are one arc (Flow 4 converts the store Flows 1–3 filled).
- Add the minimal `data-testid` anchor set **as flows need them**, not upfront.
- Per-flow profile isolation via `--user-data-dir`. Simulate keystore loss for 7b/7c by
  **deleting `keystore.json`** from the test profile — no `dev-clear-dbkey` route needed on
  desktop, and therefore no test-only surface in production main.
- Flip the `e2e` tier in `scripts/test-all.mjs` from `blocked` to `ready`.

**Hazards to design around:**

- **ABI flip** — `test:node` needs the Node ABI, `test:e2e` the Electron ABI. Tier ordering in the
  orchestrator must be deliberate and the rebuild idempotent; interrupting
  `ensure-sqlite-abi.mjs` deletes the binary outright.
- **Time-dependent Home** — the reminders and holidays engines mint `system` reminders by date.
  Assert on specific expected text, never on emptiness or counts.

**Acceptance:** `pnpm test:all` shows `e2e` PASS on macOS; a deliberately-broken build goes red.

## B — The release gate ✅ *(landed 2026-08-26)*

It is **not a separate script**. `scripts/release/` runs `pnpm test:all --strict` as one of its
preflights and refuses to build, sign or upload on any red *or blocked* tier — a thin caller of
existing scripts, so testing principle #6 stays intact. Proven the hard way on the first
`0.1.0-alpha.2` attempt: a red iOS tier aborted the release and restored all 21 manifests,
leaving no tag behind.

**One amendment to what was planned here:** `alpha` runs the suite *without* `--strict`. The
gate's own policy (section C) is about the first release **on a platform** — the rungs where
someone who is not the author installs the build. An internal TestFlight build goes to named
App Store Connect users, capped at 100; holding it to the full gate would have meant no build
at all until this doc's section A exists.

## C — The release-gate policy this increment is measured against

The driver contract proves the *driver*; the integration layer proves the *shared logic*. Neither
proves **a real user on a real device can complete the crucial journeys**. That is this tier, and
it carries a rule the lower tiers do not:

> **Before the first release of Leapsake on a given platform, the crucial-flow catalog must run
> *automated and green* on the closest approximation of that platform** — iOS Simulator, Android
> emulator, macOS/Windows/Linux native.

A **simulator/emulator/VM is itself the accepted approximation** — the gate does not require real
hardware or a device cloud. "Closest approximation" means the closest *automatable* runtime: the
production app binary on that OS image, virtualized. This is why the vendor-neutrality story
holds — a real-device farm never becomes a hard dependency.

| Platform | Closest approximation | Reachable from this Mac? |
|---|---|---|
| macOS desktop | the macOS app on macOS | ✅ the dev MacBook — fully local |
| Android | Android emulator | ✅ verified working locally |
| iOS | iOS Simulator (Xcode) | ✅ local |
| Windows desktop | the Windows app on Windows | ❌ needs a Windows host (VM / NUC / self-hosted runner) |
| Linux desktop | the Linux app on Linux + xvfb | ❌ needs a Linux container/VM |

**As written, the v0.1 gate is iOS + Android + macOS.** Windows and Linux are *deliberately
deferred* — blocked on a host, not waived; shipping a subset is an explicit, supported outcome.
Whether the full catalog on all three really gates v0.1 is **open decision 1** above.

**Vendor-neutrality is two layers, kept apart.** The **authoring layer** — the flow catalog and
its harness specs (Maestro flows, Playwright/Electron specs) — is open-source, portable, drives
the app through OS/UI, and is what we own and keep. The **execution layer** — *where* a harness
runs: local, self-hosted VM/NUC, or (if ever) a farm — is a swappable backend. The rule that
keeps them apart: **never bake a farm's proprietary API into a spec.** A spec that runs locally
must run on a self-hosted host with only config changes.

## Deferred out of this increment

**Two-instance E2E (Flows 6, 7a).** [`testing/crucial-flows.md`](./testing/crucial-flows.md)
gates these for v0.1 as written. On desktop they are tractable — separate `--user-data-dir`s plus
a local `@leapsake/server`. Whether they are in the v0.1 gate or a fast-follow is **open decision
2**, and follows from decision 1. If deferred, they go to [`v0-2.md`](./v0-2.md).
