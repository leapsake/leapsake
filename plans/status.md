# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`shipping.md`](./shipping.md); everything deferred is [`v0-2.md`](./v0-2.md).

## In flight

**v0.1 is iOS alone**, in external TestFlight with a real tester on it. macOS follows **after**
the company exists and the iOS record transfers to it ([`shipping.md`](./shipping.md) → _Part 2_).

**Android ships the same rungs** from the personal Play account; `rc` and `final` wait on
production access, earned by the [14-day closed test](./android-pipeline.md).

**Next, in order — [`shipping.md`](./shipping.md) → _Part 1_ has the acceptance for each.**
① **App Store Connect metadata** — privacy URL, a _published_ App Privacy questionnaire,
description, age rating, support URL, screenshots at **two** sizes (6.9" iPhone + 13" iPad);
`appleAppStoreConnectSetup` reads none of it. ② Verify the app on an iPad simulator. ③ `rc`,
then `final`, **both from this machine** with `pnpm release ship --here`, which runs the gate
first; push `refs/notes/releases` after each. `v0.1.0-beta.10` is tagged at origin and unshipped.

**Not gating GA:** the [remote-releases](./fable-investigation/remote-releases.md) pipeline.
Step 6 wants one more clean measure run for the Android crash patch, then the owner's call;
step 7's workflows need the owner's Actions secrets.

**In parallel:** incorporate and get a D-U-N-S number — up to 30 days, before GA's transfer.

**Not gating.** [`v0-2.md`](./v0-2.md) → _Export_ holds increment 6 and three device
verifications; contact-import fidelity rests there too; contact methods' URL templates are
convention — confirm on real hardware while testing a build.
