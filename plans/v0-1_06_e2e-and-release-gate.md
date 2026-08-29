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

**The v0.1 gate is iOS + Android.** *(It read "iOS + Android + macOS" until desktop left v0.1
on 2026-08-26.)* Windows and Linux are *deliberately deferred* — blocked on a host, not waived;
shipping a subset is an explicit, supported outcome. **How much of the catalog is required at
which rung** is the amendment below, and remains **open decision 1** until it is signed off.

⚠️ **Amended 2026-08-27 — drafted, pending owner sign-off** ([`v0-1.md`](./v0-1.md) →
*Open decisions* 1). **The rule's unit is *platform × rung*, not platform.** The catalog is
still required in full before Leapsake is a product anyone can buy into; what changes is that
the earliest rung a stranger installs does not have to carry the whole of it on day one.

| Rung | Who installs it | What must be green |
|---|---|---|
| `alpha` | internal TestFlight — named App Store Connect users, ≤100 | the suite **without** `--strict`; the `e2e` tier may not exist yet *(already true — §B)* |
| `beta` | external TestFlight — the first strangers | Flows **1, 2, 3, 4, 5**, **on-screen assertions only**, on iOS **and** Android. The `e2e` tier is `ready` and **passes** under `--strict` |
| `rc` | external TestFlight, ship-ready | the above **plus** Flows **7b, 7c** and **every out-of-band custody assertion** |
| `final` | the App Store — the public | `rc`'s bar, unchanged. Flows 6/7a are *open decision* 2 and ship with sync, not with v0.1 |

**What the grading does not touch, and must not:** `--strict` stays strict at every rung above
`alpha`, and a `blocked` tier stays a failure. [`10`](./v0-1_10_external-testflight.md) warns
against exempting `beta` from the gate; this changes what the gate **contains**, not whether it
runs. A subset that is merely *skipped* would be the thing 10 forbids.

**Why the line falls there.** `beta` proves the app does not lose data in normal use; `rc` proves
it can give the data back when the OS loses the key. The deferred set is exactly the set that is
expensive for a reason unrelated to risk — the out-of-band assertions need a mobile inspection
surface that does not exist, and 6/7a need two instances — with one deliberate exception: **the
recovery doors (7b/7c) are cheap and still deferred**, and that is the trade the owner is signing
off on. The residual risk and its mitigation are stated in [`v0-1.md`](./v0-1.md) → *Open
decisions* 1.

**Vendor-neutrality is two layers, kept apart.** The **authoring layer** — the flow catalog and
its harness specs (Maestro flows, Playwright/Electron specs) — is open-source, portable, drives
the app through OS/UI, and is what we own and keep. The **execution layer** — *where* a harness
runs: local, self-hosted VM/NUC, or (if ever) a farm — is a swappable backend. The rule that
keeps them apart: **never bake a farm's proprietary API into a spec.** A spec that runs locally
must run on a self-hosted host with only config changes.

## D — Building the beta bar

Five flows, on-screen only. Most of the authoring is composition, not net-new YAML.

- ✅ **The beta bar is built and the tier is `ready`** *(2026-08-28)*. `test:e2e` was
  `test-all --only=e2e` while the tier's own script was `test:e2e`, so flipping the tier to
  `ready` would have made it spawn itself forever — safe only because `blocked`
  short-circuits before the spawn. It is now **`scripts/test-e2e.mjs`**, a sibling of
  `test-native.mjs`, over a shared **`scripts/lib/mobile-harness.mjs`**. **Flows 1-5 are
  written and green on the iOS simulator**, and the arc is **re-runnable**: Flow 4 leaves an
  account behind, and the reset subflow drives the reset under both of its names
  (*Factory reset* while Unauthenticated, *Forget account* once an account exists).
  ✅ **And green on Android too** *(2026-08-28)*. "Byte-identical across platforms" survived
  the first real run, but only after the *environment* around them was fixed: three harness
  bugs on the provisioning path (Expo names an emulator by its AVD, not its adb serial;
  `shared_prefs/` does not exist to write the dev-menu settle into until the app has run
  once; a stale install of the repo's own former package name made every deep link raise an
  "Open with" chooser) and one real selector fix — **Gboard's suggestion strip offers the
  word you just typed, below the filter box**, so `below:` did not separate the option row
  from it. `PickerField`'s options now carry ids. And one **budget**: Flow 4's wait on the
  account conversion was set for the iOS simulator and is not enough for an emulator's
  Argon2id — byte-identical flows still need timeouts sized for the slowest device the
  suite runs on. All five are written down where they bite:
  [`../apps/mobile/maestro/README.md`](../apps/mobile/maestro/README.md) and
  `scripts/lib/mobile-harness.mjs`.
- **Both mobile platforms, one authoring pass.** `--strict` runs the whole suite regardless of
  which target ships ([`10`](./v0-1_10_external-testflight.md)), so an iOS-only beta still needs
  Android green — but the cost is not doubled: Maestro flows are byte-identical across the two
  ([`../apps/mobile/maestro/README.md`](../apps/mobile/maestro/README.md)).
- **Reuse what `maestro/subflows/` already holds** — `add-person`, `add-pet`, `stage-birthday`,
  `save-record`, `dismiss-keyboard`. Flows 2 and 3 are largely arrangement of these.
- **Flow 4 needs no new app surface.** Maestro's `copyTextFrom` captures the one-time phrase;
  nothing has to be revealed twice to make it testable.
- **Three anchors, not five.** `home-empty`, `home-ready`, `recovery-phrase`. `recovery-gate`
  waits for 7b/7c at `rc`; `sync-status` waits for sync entirely.
- **Encode the escalation as a check, not as prose.** `scripts/release/targets/ios.mjs` carries
  the `rc` bar as a `manual:` line today ("the crucial-flow catalog green on a real device").
  Make it a `requires:` check that every catalog flow has a registered Maestro flow, so `rc`
  refuses to build with the beta subset still standing in for the whole. A rule a program can
  check does not belong in a sentence ([`README.md`](./README.md) → *the five kinds of knowledge*).

## Deferred out of this increment

**Two-instance E2E (Flows 6, 7a).** [`testing/crucial-flows.md`](./testing/crucial-flows.md)
gates these for v0.1 as written. On desktop they are tractable — separate `--user-data-dir`s plus
a local `@leapsake/server`. Whether they are in the v0.1 gate or a fast-follow is **open decision
2**, and follows from decision 1. If deferred, they go to [`v0-2.md`](./v0-2.md).
