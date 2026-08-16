# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**Nothing.** The web spike closed 2026-08-15 — both owner checks answered, `apps/web-spike`
deleted, code at the tag `web-spike-final`. What it inherits to a future web client is
[`web-client.md`](./web-client.md); the rule it produced is
[`encryption/model.md`](./encryption/model.md) §10.1 — **web and PWA require a sync account**,
because browser storage is evictable even when installed.

## Next

**08 → 04 → 07**, the launch chain — [`v0-1.md`](./v0-1.md) holds the order and why 08 runs first.
**08 Inc 1 (the policy substrate) is done** — migration 29, the repo, the allowlist guard,
`ensureLocalDeviceId` (a device id predating any account). Next: **08 Inc 2, the planner** —
new `@leapsake/notifications`, pure and injected-port, `planNotifications`/`reconcile`. Still no
UI, no OS calls. 06 also waits on its *Open decisions*.
