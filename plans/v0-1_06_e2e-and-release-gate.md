# v0.1 · 06 — Desktop E2E harness + the release gate

> **Delete this doc when the work lands.** The strategy behind it — the tiers, the vendor-
> neutrality principle, the flow catalog — is permanent and lives in [`testing/`](./testing/).
> Only the *build* of the harness is here.

**Value:** the first automated proof a real user can complete the crucial journeys, and a gate
that makes the trophy binding rather than advisory.

**Prerequisite: [05A](./v0-1_05_desktop-packaging-and-signing.md).** The harness targets the
**packaged artifact**, not `out/` — that is why packaging comes first, and why no harness rework
is needed later.

⚠️ **Open decision 1 in [`v0-1.md`](./v0-1.md) sizes this increment and is unresolved.**
[`testing/strategy.md` §3](./testing/strategy.md#3-native-platform-e2e-the-release-gate-policy)
requires the full catalog green on iOS + Android + macOS; taken literally that is plausibly
larger than all of distribution combined. **Settle it before starting**, not by build order.

## A — The harness

- Commit to **Playwright** (`_electron.launch()`), per
  [`testing/strategy.md`](./testing/strategy.md#vendor-neutrality-two-layers-kept-apart).
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

## B — The release gate

A release script that runs `pnpm test:all --strict` and **refuses to package, notarize, or
publish** on any red *or blocked* tier. A thin caller of existing scripts — no logic lives in the
gate, which is what keeps testing principle #6 (vendor neutrality) intact.

**Acceptance:** the release command aborts on an induced test failure **and** on a blocked tier;
succeeds only on a full green.

## Deferred out of this increment

**Two-instance E2E (Flows 6, 7a).** [`testing/crucial-flows.md`](./testing/crucial-flows.md)
gates these for v0.1 as written. On desktop they are tractable — separate `--user-data-dir`s plus
a local `@leapsake/server`. Whether they are in the v0.1 gate or a fast-follow is **open decision
2**, and follows from decision 1. If deferred, they go to [`v0-2.md`](./v0-2.md).
