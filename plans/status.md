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
installed origin gets durable storage (a native dialog). An agent must not attempt them — **and
must not stop at "blocked" either.** Its deliverable is a **numbered runbook the owner can follow
without rereading anything**: setup commands it has actually run, the exact `about:config` pref,
the exact URLs, what to click, the question each check answers, and where to write the answer.
Raw material: [`v0-1_web-spike.md`](./v0-1_web-spike.md) → *Still owed* and
[`apps/web-spike/README.md`](../apps/web-spike/README.md) → *Run it*, which dies with the spike.

**Only once the owner reports both answers:** tag `web-spike-final`, delete `apps/web-spike`,
revert the `.oxlintrc.json` line, retire the spike's rows here and in [`v0-1.md`](./v0-1.md).
**No more measurement** *(owner, 2026-08-14)* — the phone row is a standing risk, not a task.

## Next

**08 → 04 → 07**, the launch chain — [`v0-1.md`](./v0-1.md) holds the order and why 08 runs first.
Start at **08 Inc 1, the policy substrate**: first-run device id, migration 29, the repo, the
allowlist guard — no UI, no OS calls, no owner input. 06 also waits on its *Open decisions*.
