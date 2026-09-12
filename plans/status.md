# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`shipping.md`](./shipping.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions
> awaiting the owner are [`shipping.md`](./shipping.md) → *Open, and waiting on the owner*.

## In flight

**v0.1 is iOS alone**, in external TestFlight with a real tester on it. Android and macOS follow
**after** the company exists and the iOS record transfers to it ([`shipping.md`](./shipping.md) →
*Part 2*) — which is also why nothing may reach Play from the personal account.

**The `rc` bar is code-complete.** Onboarding was reworked on 2026-09-10 — Home rows lost their
completion checkbox; the nudges gained an import step, a notifications step, staggered put-offs
and an `/about-you` screen — and `factory-reset.yaml` moved with the copy. With the Home and snooze
redesign in (2026-09-11), every tier is green, `test:e2e` on iOS included: all seven flows.

**Next, in order — [`shipping.md`](./shipping.md) → *Part 1* is the whole list, with acceptance
for each step.** ① All step 3 still owes: the catalog as a **`requires:` check** in `ios.mjs`
rather than a `manual:` sentence. ② **Public repo**, full-history secret scan first. ③ **The App
Store Connect fields nothing in the repo can check** — privacy URL, a *published* App Privacy
questionnaire, screenshots, age rating; `ascSetup` reads none of them. ④ **Submit**, then **GA**.

**In parallel, starting now:** incorporate and get a D-U-N-S number — up to 30 days, before the
transfer that GA unlocks.

**Not gating.** [`export.md`](./export.md) holds increment 6 and three device verifications;
contact-import fidelity rests at a natural stopping point ([`v0-2.md`](./v0-2.md)); contact
methods' URL templates are convention — confirm on real hardware while testing a build.
