# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`shipping.md`](./shipping.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions
> awaiting the owner are [`shipping.md`](./shipping.md) → _Open, and waiting on the owner_.

## In flight

**v0.1 is iOS alone**, in external TestFlight with a real tester on it. macOS follows **after**
the company exists and the iOS record transfers to it ([`shipping.md`](./shipping.md) → _Part 2_).

**Android ships the same rungs** from the personal Play account; `rc` and `final` wait on
production access, earned by the [14-day closed test](./android-pipeline.md).

**Next, in order — [`shipping.md`](./shipping.md) → _Part 1_ has the acceptance for each.**
① **App Store Connect metadata** — privacy URL, a _published_ App Privacy questionnaire,
description, age rating, support URL, screenshots at **two** sizes (6.9" iPhone + 13" iPad);
`ascSetup` reads none of it. ② Verify the app on an iPad simulator before submitting.
③ `rc`, then `final` — from the pipeline in
[`remote-releases.md`](./fable-investigation/remote-releases.md): steps 1–5 done, **step 6 in
flight**: runners carry the gate; the Android crash patch has 3 of 6 clean jobs and needs one
more measure run, then the owner's call. Step 7's script pieces are done; its workflows are next. **Meanwhile `v0.1.0-beta.10`
is tagged at origin and unshipped**; the gate is green here.

**In parallel:** incorporate and get a D-U-N-S number — up to 30 days, before GA's transfer.

**Not gating.** [`v0-2.md`](./v0-2.md) → _Export_ holds increment 6 and three device
verifications; contact-import fidelity rests there too; contact methods' URL templates are
convention — confirm on real hardware while testing a build.
