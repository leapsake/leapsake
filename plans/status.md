# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increment 2 — the primary question, answered yes** *(2026-08-12)*. A person's
  page server-renders with **JavaScript disabled and zero files changed under `packages/`**. The
  adapter a no-JS client owes the shared UI is **six lines**, and the desktop loader ported
  call-for-call. **Cold store + warm key wins**: 6.6 ms p50 at 100 people, 36.8 ms at 1 000,
  against a 150 ms rule — so the SSR host never holds a standing decrypted database and §9.2's
  warm-store trust claim is not forced. Two things to carry: §9.2 should say the `authVerifier`
  is wrapped under the session key, and **`duplicates.findFor` is O(n²) on every person page**
  (11.8 s of a 12.1 s request at 10 000 people) — desktop's problem too, not SSR's.
  Findings: [`apps/web-spike/README.md`](../apps/web-spike/README.md).
- **The web spike, Increment 1** *(2026-08-12)*. A second process reconstructs a seeded account
  cold from username + password alone; the shared UI loads through Vite SSR unmodified, and
  Argon2id **stalls the whole event loop**, so an SSR host needs a worker pool or a native
  binding.
- **Restore-from-backup, verified and written down** *(2026-08-11)*. All four cases confirmed on
  a clean machine from copied files, and the answer to *"how do I back up Leapsake?"* now lives
  with the app it describes: [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up
  and restoring*. The last gate before 04 is gone; `v0-1_03` is retired.
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. A local-only
  account can **merge** into a synced one or **publish itself** to a relay, and a taken username
  forks to merge-or-rename. Design: [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **An owner call, because a stopping point was reached.**
   [`v0-1_web-spike.md`](./v0-1_web-spike.md) calls Increment 2 the first clean one — *"a clean
   yes with zero package edits is most of the value on offer"* — and that is what landed. Either
   continue into Increment 3 (the no-JS **write** path, ending in a desktop app seeing the edit
   through a real relay) and 4-5, or bank the answer and start the launch chain. The spike's two
   **relay** changes (CORS + `OPTIONS`; the per-IP login budget) are already known and do not
   need more spike to justify.

2. Then **04 → 07** in [`v0-1.md`](./v0-1.md)'s order. 04 starts the 14-day Play clock and makes
   store identity permanent; 06 waits on 05, and on open decision 1 below.

## Open, waiting on the owner

**How much of the E2E catalog gates v0.1** — it plausibly sizes larger than all of distribution
combined, and it needs a decision rather than a quiet reinterpretation; it sizes 06. That plus
**whether v0.1 ships without merge-by-recovery-phrase** — the only open question that could add a
full flow on both clients — and three smaller ones: [`v0-1.md`](./v0-1.md) → *Open decisions*.

**Shipped, feature-complete, no doc left:** V1 desktop, V1.5 local CRM, V2 mobile, the UI/
view-model extraction, gifts, contact import, holidays. Read `git log` and the package READMEs.
