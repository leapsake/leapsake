# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**08 — all code is in** (Inc 1, 2, and 3 — see
[`@leapsake/notifications`](../packages/notifications/README.md) and
[`v0-1_08_local-notifications.md`](./v0-1_08_local-notifications.md) → *Inc 3, scoped* for the
mobile adapter and UI, §1–§7 all done). `NotificationSettingsSection`
(`apps/mobile/app/settings.tsx`) is a real, per-device mode/delivery-time picker plus a
cross-device policy list, wired to the permission flow and the boot/foreground/post-write
reconcile. **Next: the manual on-device smoke check** the plan's *Done when* section calls for —
nothing here has run on a simulator or a phone yet. That check is what closes 08 and unblocks 04.

## Next

**08 → 04 → 07**, the launch chain — [`v0-1.md`](./v0-1.md) holds the order and why 08 runs first.
06 also waits on its *Open decisions*.
