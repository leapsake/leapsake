# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increment 1** *(2026-08-12)*. A second process now reconstructs a seeded
  account cold from username + password alone. Three answers already: the shared UI **loads
  through Vite SSR with zero package edits** (the riskiest assumption, now observed);
  **Argon2id, not the pull, dominates the cold path** at every store size, reframing
  cold-vs-warm around a warm *key*; and it **stalls the whole event loop**, so an SSR host
  needs a worker pool or a native binding.
  Findings: [`apps/web-spike/README.md`](../apps/web-spike/README.md).
- **Restore-from-backup, verified and written down** *(2026-08-11)*. All four cases confirmed on
  a clean machine from copied files — plaintext store, both unlock doors, and the negatives —
  and the answer to *"how do I back up Leapsake?"* now lives with the app it describes:
  [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up and restoring*. The last
  gate before 04 is gone; `v0-1_03` is retired, its store-identity half carried into 04.
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. A local-only
  account is no longer a one-way street in either direction: it can **merge** into a synced one,
  or **publish itself** to a relay, and a taken username forks to merge-or-rename rather than
  dead-ending. Verified against a real relay on desktop, and by hand through the Settings dialogs
  on both clients. Design: [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **[`v0-1_web-spike.md`](./v0-1_web-spike.md) — Increment 2**, the primary question and the
   first clean stopping point: a no-JS SSR read path with **zero files changed under
   `packages/`**. Increment 1 de-risked it — the shared UI loads through Vite SSR unmodified —
   so this is loader-porting and prop-wiring, kept honest by `WANTED-CHANGES.md`. Read the doc
   first; it holds every decision already made. One change out of Increment 1: measure
   **warm-key/cold-store** first, ahead of warm-per-session.

   Why now: it is the only substantial unblocked dev work on the board, and two of its findings
   are **relay** changes (CORS + `OPTIONS`; a per-IP rate-limit budget now *confirmed* wrong for
   an SSR host) — cheaper to learn before a build is in testers' hands.

2. Then **04 → 07** in [`v0-1.md`](./v0-1.md)'s order. 04 starts the 14-day Play clock and makes
   store identity permanent; 06 waits on 05, and on open decision 1 below.

## Open, waiting on the owner

**How much of the E2E catalog gates v0.1** — it plausibly sizes larger than all of distribution
combined, and it needs a decision rather than a quiet reinterpretation; it sizes 06. That plus
**whether v0.1 ships without merge-by-recovery-phrase** — the only open question that could add a
full flow on both clients — and three smaller ones: [`v0-1.md`](./v0-1.md) → *Open decisions*.

**Shipped, feature-complete, no doc left:** V1 desktop, V1.5 local CRM, V2 mobile, the UI/
view-model extraction, gifts, contact import, holidays. Read `git log` and the package READMEs.
