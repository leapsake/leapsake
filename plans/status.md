# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`shipping.md`](./shipping.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions
> awaiting the owner are [`shipping.md`](./shipping.md) → _Open, and waiting on the owner_.

## In flight

**v0.1 is iOS alone**, in external TestFlight with a real tester on it. macOS follows **after**
the company exists and the iOS record transfers to it ([`shipping.md`](./shipping.md) → _Part 2_).

**Android ships the same rungs** from the personal Play account; next is the Console-precondition
preflight, then the 14-day tester clock ([`android-pipeline.md`](./android-pipeline.md)).

**Next, in order — [`shipping.md`](./shipping.md) → _Part 1_ has the acceptance for each.**
① **App Store Connect metadata** — privacy URL, a _published_ App Privacy questionnaire,
description, age rating, support URL, screenshots at **two** sizes (6.9" iPhone + 13" iPad);
`ascSetup` reads none of it. ② Verify the app on an iPad simulator before submitting.
③ **Public repo**, full-history secret scan first. ④ `pnpm release rc`, then `final`.

**Still owed on step 3, and the only code left:** the crucial-flow catalog is a `manual:` sentence
on the `rc` rung, not a check that fails the release.

**In parallel, starting now:** incorporate and get a D-U-N-S number — up to 30 days, before the
transfer that GA unlocks.

**Not gating.** [`export.md`](./export.md) holds increment 6 and three device verifications;
contact-import fidelity rests at a natural stopping point ([`v0-2.md`](./v0-2.md)); contact
methods' URL templates are convention — confirm on real hardware while testing a build.
