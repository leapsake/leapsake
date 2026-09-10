# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`shipping.md`](./shipping.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions
> awaiting the owner are [`shipping.md`](./shipping.md) → *Open, and waiting on the owner*.

## In flight

**v0.1 is iOS alone**, in external TestFlight with a real tester on it. Android and macOS follow
**after** the company exists and the iOS record transfers to it ([`shipping.md`](./shipping.md) →
*Part 2*) — which is also why nothing may reach Play from the personal account.

**Next, and it is one thing: the out-of-band custody assertions** — the last of the `rc` bar, now
that every *flow* it names is green on iOS. They are the five checks that read the **bytes**
rather than the screen; four are reachable from the harness today, the open one is the **iOS key
store**, and ⚠️ an in-app inspection screen is the wrong answer (*never call into app code*).
Acceptance and the traps: [`shipping.md`](./shipping.md) → *Part 1* step 3.

**Then, in order — [`shipping.md`](./shipping.md) → *Part 1* is the whole list, with acceptance
for each step.** ② **Public repo**, full-history secret scan first. ③ **The App Store Connect
fields nothing in the repo can check** — privacy URL, a *published* App Privacy questionnaire,
screenshots, age rating; `ascSetup` reads none of them. ④ **Submit**, then **GA**.

**In parallel, starting now:** incorporate and get a D-U-N-S number — up to 30 days, and the
entity must exist before the transfer that GA unlocks.

**Not gating.** [`export.md`](./export.md) holds increment 6 and three device verifications;
reminders and contact-import fidelity rest at a natural stopping point ([`v0-2.md`](./v0-2.md));
contact methods' URL templates are convention — confirm on real hardware while testing a build.
