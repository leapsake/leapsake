# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`shipping.md`](./shipping.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions
> awaiting the owner are [`shipping.md`](./shipping.md) → *Open, and waiting on the owner*.

## In flight

**v0.1 is iOS alone** *(owner, 2026-09-06)*, and the release path to it is built: three betas
have shipped, the App Store Connect record is complete, and a real external tester is using the
app. Android and macOS follow **after** the company exists and the iOS record transfers to it —
[`shipping.md`](./shipping.md) → *Part 2*, which is also the reason nothing may be
uploaded to Play from the personal account.

**Next, in order — and [`shipping.md`](./shipping.md) → *Part 1* is the whole list, with
acceptance for each step.** ① **Export** — GA-blocking (2026-09-06): single-device v0.1 has no
other copy of a user's data, and it must **not** use iCloud (that would permanently disqualify
the Apple app transfer). *Shipped 2026-09-07/08* — a user can tap Export on the Data screen and
save a `.zip` holding their whole store, and both destructive confirmations offer it before they
destroy it. **No code gates GA here now**; [`export.md`](./export.md) is down to three device
verifications, plus reading an export back in and desktop parity, none of which gate.
② **The `rc` bar** — Flows 7c then 7b, the out-of-band custody assertions, and `rc`'s catalog
requirement as a `requires:` check in `ios.mjs`.
③ **Public repo** — full-history secret scan first. ④ **Submit**, then **GA**, then
incorporate and transfer.

**Off the critical path — none of this gates GA, and none of it is next.** The reminders rework
and contact-import fidelity against real Apple cards both sit at a natural stopping point; what
is left of either is in [`v0-2.md`](./v0-2.md). Contact methods reach people, but their URL
templates are convention, not verified — **confirm on real hardware with the apps installed** (no
simulator can), while testing a build rather than instead of Part 1.
