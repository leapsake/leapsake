# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**The web spike — two checks, then tear it down.** Both remaining checks **need the owner at a
keyboard** and cannot be driven from an agent session, so an agent picking this up should *say so
rather than attempt them*: a **Firefox** walk-through with `javascript.enabled=false` (a browser
preference), and **installing** `/client-pwa` to read whether an installed origin gets durable
storage (a native dialog). What each must show is
[`v0-1_web-spike.md`](./v0-1_web-spike.md) → *Still owed*; how to start the spike is
[`apps/web-spike/README.md`](../apps/web-spike/README.md) → *Run it*, which dies with it.

Then tag `web-spike-final`, delete `apps/web-spike`, revert the `.oxlintrc.json` line, and retire
the spike's rows here and in [`v0-1.md`](./v0-1.md). **No more measurement** *(owner,
2026-08-14)* — the phone row is a standing risk, not a task.

## Next

**04 → 07** in [`v0-1.md`](./v0-1.md)'s order — the launch chain, which the spike runs beside
rather than blocks. 04 starts the 14-day Play clock and fixes store identity; 05 gates 06; 06 is
also blocked on the two owner decisions that size it (how much of the E2E catalog gates v0.1, and
whether v0.1 ships without merge-by-recovery-phrase) — both in
[`v0-1.md`](./v0-1.md) → *Open decisions*.
