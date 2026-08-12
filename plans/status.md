# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **Restore-from-backup, verified and written down** *(2026-08-11)*. All four cases confirmed on
  a clean machine from copied files — plaintext store, both unlock doors, and the negatives —
  and the answer to *"how do I back up Leapsake?"* now lives with the app it describes:
  [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up and restoring*. The last
  gate before 04 is gone; `v0-1_03` is retired, its store-identity half carried into 04.
- **The account invitation — Onboarding Increment 2, both clients** *(2026-08-08)*. Home now
  carries the create/sign-in **fork**: *sign in* stands from day 1, *create your account* arrives
  once there is data worth protecting, and the sign-in nudge finally retires for a local-only
  account instead of pointing at a flow that could not satisfy it. Design:
  [`@leapsake/reminders`](../packages/reminders/README.md).
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. A local-only
  account is no longer a one-way street in either direction: it can **merge** into a synced one,
  or **publish itself** to a relay, and a taken username forks to merge-or-rename rather than
  dead-ending. Verified against a real relay on desktop, and by hand through the Settings dialogs
  on both clients. Design: [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **[`v0-1_web-spike.md`](./v0-1_web-spike.md) — Increment 1**: scaffold `apps/web-spike` and a
   seeded dev account, ending when a second process can `pull(0)` given only a username and
   password. **Over two hours means the spike is mis-scoped.** Then Increment 2, the primary
   question and the first clean stopping point: a no-JS SSR read path with **zero files changed
   under `packages/`**. The doc holds every decision already made, so it should not need
   re-litigating — read it before writing anything.

   Why now: it is the only substantial unblocked dev work on the board, and two of its findings
   are **relay** changes (CORS + `OPTIONS`; a per-IP rate-limit budget that is structurally wrong
   for an SSR host) — cheaper to learn before a build is in testers' hands.

2. Then **04 → 07** in [`v0-1.md`](./v0-1.md)'s order. 04 starts the 14-day Play clock and makes
   store identity permanent; 06 waits on 05, and on open decision 1 below.

## Open, waiting on the owner

**How much of the E2E catalog gates v0.1** — it plausibly sizes larger than all of distribution
combined, and it needs a decision rather than a quiet reinterpretation; it sizes 06. That plus
**whether v0.1 ships without merge-by-recovery-phrase** — the only open question that could add a
full flow on both clients — and three smaller ones: [`v0-1.md`](./v0-1.md) → *Open decisions*.

**Shipped, feature-complete, no doc left:** V1 desktop, V1.5 local CRM, V2 mobile, the UI/
view-model extraction, gifts, contact import, holidays. Read `git log` and the package READMEs.
