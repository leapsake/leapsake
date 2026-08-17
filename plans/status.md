# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**08 — all code is in; iOS simulator smoke-check done, Android untried** (Inc 1, 2, and 3 — see
[`@leapsake/notifications`](../packages/notifications/README.md) and
[`v0-1_08_local-notifications.md`](./v0-1_08_local-notifications.md) → *Inc 3, scoped*, §1–§7 all
done). On a real iOS simulator, all of *Done when* is now confirmed: permission-once, a delivered
digest, `each` mode's one-per-reminder delivery, completion/snooze silencing a pending one, and a
second device's policy editable from the first. Found and fixed a real race along the way — see
the plan doc's Inc 3 note. **Next: Android**, untried on any platform. That closes 08 and unblocks
04.

## Next

**08 → 04 → 07**, the launch chain — [`v0-1.md`](./v0-1.md) holds the order and why 08 runs first.
06 also waits on its *Open decisions*.
