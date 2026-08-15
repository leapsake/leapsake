# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**The web spike — two checks, then tear it down.** It stays in flight until it is finished, and it
comes before 08 *(owner, 2026-08-14)*.

Both checks need the **owner at a keyboard**: a **Firefox** walk-through with
`javascript.enabled=false` (a browser pref), and **installing** `/client-pwa` to read whether an
installed origin gets durable storage (a native dialog). An agent must not attempt them.

**The runbook is written and its setup is verified end to end:**
[`v0-1_web-spike-runbook.md`](./v0-1_web-spike-runbook.md) — ~15 minutes, and the answers get
written into its own §5. Nothing else needs reading first.

**Only once the owner reports both answers:** the teardown, which needs no owner — runbook §4.
**No more measurement** *(owner, 2026-08-14)* — the phone row is a standing risk, not a task.

## Next

**08 → 04 → 07**, the launch chain — [`v0-1.md`](./v0-1.md) holds the order and why 08 runs first.
Start at **08 Inc 1, the policy substrate**: first-run device id, migration 29, the repo, the
allowlist guard — no UI, no OS calls, no owner input. 06 also waits on its *Open decisions*.
