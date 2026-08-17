# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

Nothing — **08 (local notifications) is done, 2026-08-16.** All of *Done when* confirmed on both
real iOS and Android simulators/emulators, reading each OS's own pending/delivered notification
records directly: permission-once, a delivered digest, `each` mode's one-per-reminder delivery,
completion/snooze silencing a pending one, and a second device's policy editable from the first.
Found and fixed a real boot/foreground race between `regenerateSystemReminders` and
`reconcileNotifications` along the way (`apps/mobile/lib/core-context.tsx`). See
[`@leapsake/notifications`](../packages/notifications/README.md) for the durable design; the plan
doc is retired per its own *Done when*.

## Next

**04 → 07**, the launch chain — [`v0-1.md`](./v0-1.md) holds the order. 06 also waits on its
*Open decisions*.
