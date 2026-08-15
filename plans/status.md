# Leapsake — Status

> **What just landed, what is next, what follows.** Nothing else — and never over 50 lines.
> The full v0.1 order is [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md).

## Just landed

- **The web spike, Increment 6 — the answers are written, two of four checks done**
  *(2026-08-14)*. [`v0-1_web-spike.md`](./v0-1_web-spike.md) is no longer a plan: it is the
  spike's **answers**, and it outlives `apps/web-spike`. Checked since: a **capability link in a
  real browser** — the browser's own network log shows no fragment on the wire, and the tab
  decrypts 840 B of ciphertext with the key it kept — and a clean **Electron** install
  **converging** on the spike's account in 836 ms, round-tripping a no-JS web write *and* a
  desktop write through a store that is **encrypted at rest**. Increments 1-5 are what it
  reports on *(→ 08-14)*: read, write, both sharing flavors, the browser data layer, a Worker
  over a persistent store, and an installed app resuming offline in **69.3 ms** with **0 bytes**
  on the wire. **Zero `packages/` edits**, nine times.
- **Restore-from-backup, verified** *(2026-08-11)*. Four cases on a clean machine; 04's last gate
  is gone: [`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up*
- **The account merge, all four increments, both clients** *(2026-08-08 → 08-11)*. Local-only
  **merges** into synced or **publishes itself**; a taken username forks to merge-or-rename;
  design in [`encryption/model.md`](./encryption/model.md) §7.2.2.

## Next

1. **The web spike — two checks, then tear it down.** Both remaining checks **need the owner at
   a keyboard** and cannot be driven from an agent session, so an agent picking this up should
   *say so rather than attempt them*: a **Firefox** walk-through with `javascript.enabled=false`
   (a browser preference), and **installing** `/client-pwa` to read whether an installed origin
   gets durable storage (a native dialog). What each must show is
   [`v0-1_web-spike.md`](./v0-1_web-spike.md) → *Still owed*; how to start the spike is
   [`apps/web-spike/README.md`](../apps/web-spike/README.md) → *Run it*, which dies with it.
   Then tag `web-spike-final`, delete `apps/web-spike`, revert the `.oxlintrc.json` line, and
   retire the spike's rows here and in [`v0-1.md`](./v0-1.md). **No more measurement**
   *(owner, 08-14)* — the phone row is a standing risk, not a task.

2. Then **04 → 07** in [`v0-1.md`](./v0-1.md)'s order — the launch chain, which the spike runs
   beside rather than blocks. 04 starts the 14-day Play clock and fixes store identity; 06 waits
   on 05 and on the open decision below.

## Open, waiting on the owner

**How much of the E2E catalog gates v0.1** — it plausibly sizes larger than all of distribution
combined, and needs a decision rather than a quiet reinterpretation; it sizes 06. That plus
**whether v0.1 ships without merge-by-recovery-phrase** — the only open one that could add a
full flow on both clients — and three smaller: [`v0-1.md`](./v0-1.md) → *Open decisions*.

**Shipped, feature-complete, no doc left:** V1 desktop, V1.5 local CRM, V2 mobile, the UI/
view-model extraction, gifts, contact import, holidays. Read `git log` and the package READMEs.
