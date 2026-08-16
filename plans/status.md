# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**08 — all code is in; iOS simulator smoke-checked, partially** (Inc 1, 2, and 3 — see
[`@leapsake/notifications`](../packages/notifications/README.md) and
[`v0-1_08_local-notifications.md`](./v0-1_08_local-notifications.md) → *Inc 3, scoped*, §1–§7 all
done). On a real iOS simulator: the permission dialog fires exactly once when the mode picker
leaves `off`, `Allow` persists to `notification_settings` (checked via SQLite, not just the UI),
and a second device's policy is visible and editable from the first (stand-in row, not a second
booted simulator). **Next: what's left of *Done when*** — an actual delivered notification,
`each` mode, and completion/snooze silencing one — plus Android, untried. That closes 08 and
unblocks 04.

## Next

**08 → 04 → 07**, the launch chain — [`v0-1.md`](./v0-1.md) holds the order and why 08 runs first.
06 also waits on its *Open decisions*.
