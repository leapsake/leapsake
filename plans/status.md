# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The account invitation — Onboarding Increment 2, both clients** *(2026-08-08)*. Home now
  carries the create/sign-in **fork**: *sign in* stands from day 1, *create your account* arrives
  once there is data worth protecting, and the sign-in nudge finally retires for a local-only
  account instead of pointing at a flow that could not satisfy it. **Unverified on a simulator**
  (unit + integration tiers only), like Increment 1. Design:
  [`@leapsake/reminders`](../packages/reminders/README.md).
- **The account merge, all four increments, both clients** *(2026-08-08)*. A local-only account
  is no longer a one-way street in either direction: it can **merge** into a synced one, or
  **publish itself** to a relay, and a taken username forks to merge-or-rename rather than
  dead-ending. **Verified against a real relay on desktop** *(2026-08-08)* — an in-process
  relay now drives the merge's real 401/404 failure paths, the post-merge duplicate review, and
  bind's real 409 fork; both sabotage-checked. **Mobile and both UIs are still stub-only.**
  Design: [`encryption/model.md`](./encryption/model.md) §7.2.2.
- **Onboarding Increment 1 — reminder snooze + honest dismiss actions** *(2026-07-31 → 08-01)*.
  Every acceptance clause holds on desktop, on one device and across two. **Mobile is unverified**
  — its row logic has a unit tier, but nothing has been observed on a simulator, which belongs to
  the blocked E2E tier ([`v0-1_06`](./v0-1_06_e2e-and-release-gate.md)).

## Next

1. **[`v0-1_03_store-identity-and-restore.md`](./v0-1_03_store-identity-and-restore.md)** — real
   version + bundle IDs and a proven backup answer. The last thing between here and 04, which
   starts the 14-day Play clock. Then 04 → 07 in [`v0-1.md`](./v0-1.md)'s order.

**Startable today, in parallel with any of the above:**

- **Hand-verify merge + binding through the UI, and on mobile** — the automated live-relay tier
  covers desktop's flow functions, not the Settings dialogs that fork on a 409, and not mobile
  (whose `expo-sqlite` merge is stuck in the blocked native tier).
- **Developer account enrollment** — weeks of latency, zero effort, blocks 05 and 07.
- **[`v0-1_web-spike.md`](./v0-1_web-spike.md)** — independent of the chain; best done before 04,
  since two of its findings are relay changes.

## Open, waiting on the owner

**How much of the E2E catalog gates v0.1** — it plausibly sizes larger than all of distribution
combined, and it needs a decision rather than a quiet reinterpretation. That plus **whether v0.1
ships without merge-by-recovery-phrase** and three smaller questions:
[`v0-1.md`](./v0-1.md) → *Open decisions*.

**Shipped, feature-complete, no doc left:** V1 desktop, V1.5 local CRM, V2 mobile, the UI/
view-model extraction, gifts, contact import, holidays. Read `git log` and the package READMEs.
