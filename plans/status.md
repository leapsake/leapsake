# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**08 Inc 3 — the mobile adapter and UI** (Inc 1 and 2 are done, see
[`@leapsake/notifications`](../packages/notifications/README.md)). §1 (device id), §2 (the
`expo-notifications` config plugin), §3 (the scheduler port, with a real `channelId`), §4 (the
permission flow — `requestNotificationPermissionOnThisDevice`, injected ports, unit-tested; not
wired anywhere yet since it has no legitimate call site before §7), §5 (boot/foreground
reconcile), and §6 (the post-write trigger — reuses `@leapsake/sync`'s `withSyncKick` a second
time) are done — the reconcile is live end to end. **Next: §7**, the settings UI — the last item,
and the first real call site for both §4 and `setPolicy`. Detail and per-item status in
[`v0-1_08_local-notifications.md`](./v0-1_08_local-notifications.md) → *Inc 3, scoped*.

## Next

**08 → 04 → 07**, the launch chain — [`v0-1.md`](./v0-1.md) holds the order and why 08 runs first.
Finishing 08 Inc 3 unblocks 04. 06 also waits on its *Open decisions*.
