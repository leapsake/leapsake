# v0.1 · 06 — Crucial-flow E2E

> **Delete this doc when the work lands.** The tiers and the testing principles are permanent
> and live in [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *Testing*; the flow catalog is
> [`testing/crucial-flows.md`](./testing/crucial-flows.md).

**Value:** the first automated proof a real user can complete the crucial journeys.

✅ **Sections B, C and D have all landed.** The gate is built and runs on every release; the
grading policy is settled *(owner, 2026-08-28)*; the `beta` bar is written and green on both
mobile platforms. **What is left of this doc is one thing: the `rc` bar** — Flows 7b/7c, the
out-of-band custody assertions, and turning `rc`'s catalog requirement into a check rather than
a sentence. See §D.

⚠️ **This is a mobile increment, and v0.1 is now iOS alone.** Desktop deferred past v0.1
*(owner, 2026-08-26)*, so section A — a Playwright/Electron harness against a packaged `.app` —
left with it and waits on [`desktop-packaging.md`](./desktop-packaging.md) → A. Android followed
*(owner, 2026-09-06)*, for account reasons rather than engineering ones
([`v0-1.md`](./v0-1.md) → *The account sequence*). **Its flows stay in the suite regardless** —
see §C.

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

**The v0.1 gate is iOS.** *(It read "iOS + Android + macOS" until desktop left v0.1 on
2026-08-26, and "iOS + Android" until Android did on 2026-09-06.)* Windows and Linux are
*deliberately deferred* — blocked on a host, not waived; shipping a subset is an explicit,
supported outcome.

⚠️ **Android's flows stay in the suite, and `--strict` keeps running them.** The rule above says
a platform must be green before *its own* first release, so Android's obligation travels with
the Android release rather than lapsing — but the flows are already written, already green, and
Maestro flows are byte-identical across the two platforms, so keeping them costs nothing and
catches a regression on the platform that ships. **Nothing here removes a test.** What changes
is only which platform's greenness is load-bearing for *this* release.

**How much of the catalog is required at which rung** is the amendment below, ✅ **settled**
*(owner, 2026-08-28)*.

✅ **Amended 2026-08-27, settled 2026-08-28** *(owner — [`v0-1.md`](./v0-1.md) → *Open
decisions* 1)*. **The rule's unit is *platform × rung*, not platform.** The catalog is
still required in full before Leapsake is a product anyone can buy into; what changes is that
the earliest rung a stranger installs does not have to carry the whole of it on day one.

| Rung | Who installs it | What its worst failure costs them | What must be green |
|---|---|---|---|
| `alpha` | internal TestFlight — named App Store Connect users, ≤100 | nothing; they are us | the suite **without** `--strict`; the `e2e` tier may not exist yet *(already true — §B)* |
| `beta` | external TestFlight — the first strangers | an evening of typing, and only if they ignored the notes | Flows **1, 2, 3, 4, 5**, **on-screen assertions only**, on iOS **and** Android. The `e2e` tier is `ready` and **passes** under `--strict` |
| `rc` | external TestFlight, ship-ready | records they have started to rely on | the above **plus** Flows **7b, 7c** and **every out-of-band custody assertion** |
| `final` | the App Store — the public | the thing the product exists to hold | `rc`'s bar, unchanged. Flows 6/7a are *open decision* 2 and ship with sync, not with v0.1 |

**What the grading does not touch, and must not:** `--strict` stays strict at every rung above
`alpha`, and a `blocked` tier stays a failure. [`10`](./v0-1_10_external-testflight.md) warns
against exempting `beta` from the gate; this changes what the gate **contains**, not whether it
runs. A subset that is merely *skipped* would be the thing 10 forbids.

**What the rungs ratchet on is data loss, not defect count** *(owner, 2026-08-28)*. Alpha and
beta are allowed to be buggy — the aim is high, but a bug at those rungs costs a tester an
annoyance and costs us a report, which is the entire point of putting a build in front of
people. What may not survive into a **stable v0.1** is anything that can lose someone's data,
and at **v1.0** it is unacceptable outright. So the table above is a one-way ratchet, and it
is deliberately steepest exactly where the catalog is about *getting data back* — 7b, 7c and
the custody assertions land at `rc`, the last rung before anyone keeps real records here.

That axis is what makes the trade legible rather than merely convenient: **the question at
each rung is not "how good is this build" but "what does its worst failure cost the person
holding it".** A beta tester who loses a toy dataset typed twenty minutes ago has lost twenty
minutes. That sentence is only true while the tester has been *told* it is a beta and not a
vault — which is why
[`../release-notes/what-to-test.txt`](../release-notes/what-to-test.txt) saying so is a
**preflight requirement** rather than a nicety, and why `rc` is where it stops being enough.

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
  which target ships ([`10`](./v0-1_10_external-testflight.md)), so an iOS-only release still
  needs Android green — but the cost is not doubled: Maestro flows are byte-identical across the
  two ([`../apps/mobile/maestro/README.md`](../apps/mobile/maestro/README.md)). **This is why
  Android leaving v0.1 changed nothing here**: the flows were already written, and writing the
  `rc` ones for both platforms is still one pass.
- **Reuse what `maestro/subflows/` already holds** — `add-person`, `add-pet`, `stage-birthday`,
  `save-record`, `dismiss-keyboard`. Flows 2 and 3 are largely arrangement of these.
- ⚠️ **Flow 4 needs no new app surface *at `beta`*, and this line used to overclaim.** It said
  Maestro's `copyTextFrom` captures the one-time phrase. It does not: Flow 4 **as built does not
  capture the phrase at all** — it asserts the grid has a 24th word and no 25th, which is the
  whole of what the `beta` bar asks — and the reveal renders the words as 24 separately-numbered
  `Text` nodes, so capturing them means 24 stitched `copyTextFrom` calls or a new surface
  exposing the phrase as one string. **Price that into 7b at `rc`, not into Flow 4**
  *(corrected 2026-08-28 against the built flows; see [`v0-1.md`](./v0-1.md) → Open decisions 1
  and [`testing/crucial-flows.md`](./testing/crucial-flows.md) → the matrix)*. 7c escapes it
  entirely — the password door is answered with the password Flow 4 already typed.
- **Three anchors, not five.** `home-empty`, `home-ready`, `recovery-phrase`. `recovery-gate`
  waits for 7b/7c at `rc`; `sync-status` waits for sync entirely.
- **Encode the escalation as a check, not as prose.** `scripts/release/targets/ios.mjs` carries
  the `rc` bar as a `manual:` line today ("the crucial-flow catalog green on a real device").
  Make it a `requires:` check that every catalog flow has a registered Maestro flow, so `rc`
  refuses to build with the beta subset still standing in for the whole. A rule a program can
  check does not belong in a sentence ([`README.md`](./README.md) → *the five kinds of knowledge*).

## The two defects this gate found — both fixed *(2026-08-31)*

Both surfaced on the first real `pnpm release beta`, were recorded here as waived under the
data-loss bar *(owner, 2026-08-31 00:31)*, and were **both fixed the same evening** (20:16, the
same commit that made the suite start from a wiped app). The waiver never had to be spent. They
are kept here rather than deleted because the second one was a real product bug that a user
could reach, and because the first is a standing property of any E2E arc that ends with state.

### 1. The arc was not re-runnable, so a green run depended on its starting state — **fixed**

The arc ends on Flow 4 with an account and keys, so the next run began there and took the
Forget-account branch of the reset instead of the Factory-reset one, failing in Flow 1. That is
the whole of the iOS/Android flip-flop on 2026-08-30: the two devices were in different starting
states, not behaving differently, and reading it as a platform difference costs an hour.

**The fix is that the harness now wipes the app before every run**, from outside the app —
`pm clear` on Android; on iOS a delete of `Documents/SQLite` plus `simctl keychain reset`,
assembled by hand because `simctl uninstall`/`clearState` would take `Library/Preferences` with
them. `scripts/lib/mobile-harness.mjs` carries both and the reasoning. Verified by three
consecutive green Android runs and two on iOS, each starting from whatever the previous run
left behind. `subflows/factory-reset.yaml` stays as coverage of the erase a *user* performs,
which is a different thing from the harness's teardown.

**The durable lesson, which outlives the fix:** a green catalog run means what it appears to
mean only from a known starting state, and an arc that ends by creating an account does not
have one unless something makes it. That property belongs to the harness, not to a flow.

### 2. Forget account could leave the app on a blank screen — **fixed**

Android dev client, measured 2026-08-31 00:20: after Forget account completed and the app
relaunched, Home never rendered — a spinner for 34s until Maestro timed out. Underneath it, two
best-effort reconciles failed with `Access to closed resource`.

Those were the symptom. The cause was that **both reconciles in `CoreProvider` outlive the core
they were handed**, so the reset closed the driver underneath them; they reached the screen only
because dev builds overlay `console.error` in LogBox. **This was not test-only** — Forget account
is a real control in `app/data.tsx`, so a user could land here.

Fixed by `isLiveCore` in [`../apps/mobile/lib/core-context.tsx`](../apps/mobile/lib/core-context.tsx):
each reconcile checks the core it was handed is still the current one before continuing, and a
teardown mid-flight is treated as "not a failure" rather than logged as one.

## Deferred out of this increment

**Two-instance E2E (Flows 6, 7a).** [`testing/crucial-flows.md`](./testing/crucial-flows.md)
gates these for v0.1 as written. On desktop they are tractable — separate `--user-data-dir`s plus
a local `@leapsake/server`. Whether they are in the v0.1 gate or a fast-follow is **open decision
2**, and follows from decision 1. If deferred, they go to [`v0-2.md`](./v0-2.md).
