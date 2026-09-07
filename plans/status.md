# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`v0-1.md`](./v0-1.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions awaiting the
> owner are [`v0-1.md`](./v0-1.md) → *Open decisions*.

## In flight

**v0.1 is iOS alone** *(owner, 2026-09-06)*, and the release path to it is built: three betas
have shipped, the App Store Connect record is complete, and a real external tester is using the
app. Android and macOS follow **after** the company exists and the iOS record transfers to it —
[`v0-1.md`](./v0-1.md) → *The account sequence*, which is also the reason nothing may be
uploaded to Play from the personal account.

**Next, in order — and [`ios-ga.md`](./ios-ga.md) is now the whole list, in order, with
acceptance for each step.** ① **Export** — newly GA-blocking (2026-09-06): single-device v0.1
has no other copy of a user's data, and it must **not** use iCloud (that would permanently
disqualify the Apple app transfer). ② **The `rc` bar** — Flows 7c then 7b, the out-of-band
custody assertions, and `rc`'s catalog requirement as a `requires:` check in `ios.mjs`.
③ **Public repo** — full-history secret scan first. ④ **Submit**, then **GA**, then
incorporate and transfer.

**Off the critical path, and where the last two weeks went:** the reminders rework (prompt,
per-action windows, Home's three buckets — schedules settled at two levels, 2026-09-05) and
contact-import fidelity against real Apple cards (`X-ABDATE`, omitted years, `X-ABADR`). Both
are at a natural stopping point; what is left of either is in [`v0-2.md`](./v0-2.md).

**Contact methods reach people** — built 2026-08-19. Left: the URL templates are convention,
not verified — **confirm on real hardware with the apps installed** (no simulator can). ✅
Unblocked: TestFlight builds are on a real iPhone. `expo-contacts` socialProfiles stay unmapped.
