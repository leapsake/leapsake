# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`shipping.md`](./shipping.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions
> awaiting the owner are [`shipping.md`](./shipping.md) → *Open, and waiting on the owner*.

## In flight

**v0.1 is iOS alone** *(owner, 2026-09-06)*, and the release path to it is built — three betas
have shipped and a real external tester is on the app. Android and macOS follow **after** the
company exists and the iOS record transfers to it ([`shipping.md`](./shipping.md) → *Part 2*),
which is also why nothing may reach Play from the personal account.

**Next, and it is one thing: the out-of-band custody assertions** — the last of the `rc` bar, and
the only part of the catalog with no code. **Every *flow* that bar names is now green on iOS**:
both at-rest doors landed 2026-09-09 (7c password, 7b phrase), finding four bugs in the
pre-database boot path between them. What is left is the five checks that read the **bytes**
rather than the screen. **Four are reachable from the harness today** (`simctl
get_app_container`, which `wipe` already calls); the open one is the **iOS key store**, which
`simctl keychain` cannot read. Do not build an in-app inspection screen — the catalog's rule is
*never call into app code*. Then the catalog moves into `ios.mjs`'s `requires:`.

**Then, in order — [`shipping.md`](./shipping.md) → *Part 1* is the whole list, with
acceptance for each step.** ② **Public repo**, full-history secret scan first. ③ **The App Store
Connect fields nothing in the repo can check** — privacy URL, a *published* App Privacy
questionnaire, screenshots, age rating; `ascSetup` reads none of them. ④ **Submit**, then **GA**.

**In parallel, starting now, alongside the list above rather than after it:** incorporate and
get a D-U-N-S number — up to 30 days, and the entity must exist before the transfer GA unlocks.

**Not gating, and not next.** Export shipped 2026-09-07/08; what is left in
[`export.md`](./export.md) is increment 6 and three device verifications. Reminders and
contact-import fidelity rest at a natural stopping point ([`v0-2.md`](./v0-2.md)); contact
methods' URL templates are convention — confirm on real hardware while testing a build.
