# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`shipping.md`](./shipping.md); everything deferred is [`v0-2.md`](./v0-2.md); decisions
> awaiting the owner are [`shipping.md`](./shipping.md) → _Open, and waiting on the owner_.

## In flight

**v0.1 is iOS alone**, in external TestFlight with a real tester on it. macOS follows **after**
the company exists and the iOS record transfers to it ([`shipping.md`](./shipping.md) → _Part 2_).

**Android stopped waiting** _(owner, 2026-09-13)_ — it ships from the **personal** account on the
same rung ladder as iOS: `alpha`→internal, `beta`→closed, which is also how it earns production
access ([`android-pipeline.md`](./android-pipeline.md)). **`v0.1.0-beta.9` shipped both phones
from one tag on 2026-09-18** — Android 374643 to the closed track, iOS 374687 into beta review —
so the scripted path is proven and `--only` is retired. Next there is the Console-precondition
preflight that bare releases now need, then the 14-day tester clock.

**The release path is finished** _(2026-09-13)_. `rc` builds, hands the build to testers **and**
submits it to App Store review; `final` builds nothing — it releases the approved version and tags
the commit that went live, resolved from `refs/notes/releases`. A rejection costs a fresh `rc.N+1`,
never a deleted tag. **Push the notes ref with the tag** or the receipts stay on one machine.

**iPad is supported** _(owner, 2026-09-13)_ — `supportsTablet` was always on, so the listing is
universal and review tests on one. Layout work is deferred ([`v0-2.md`](./v0-2.md) → _Client / UX_).

**Next, in order — [`shipping.md`](./shipping.md) → _Part 1_ is the whole list, with acceptance
for each step.** ① **The App Store Connect metadata** — privacy URL, a _published_ App Privacy
questionnaire, description, age rating, support URL, and screenshots at **two** sizes now
(6.9" iPhone + 13" iPad); `ascSetup` reads none of it. ② Verify the app on an iPad simulator
before submitting. ③ **Public repo**, full-history secret scan first. ④ `pnpm release rc`, then
`pnpm release final` once Apple approves.

**Still owed on step 3, and the only code left:** the crucial-flow catalog is a `manual:` sentence
on the `rc` rung, not a check that fails the release.

**In parallel, starting now:** incorporate and get a D-U-N-S number — up to 30 days, before the
transfer that GA unlocks.

**The relay half of both clients is deleted** _(2026-09-17)_ — v0.1 is single-device by
construction now, not by a flag. It is rebuilt for v0.2 from the tag `relay-clients-final`
([`v0-2.md`](./v0-2.md) → _Encryption, sync, and the relay_).

**Not gating.** [`export.md`](./export.md) holds increment 6 and three device verifications;
contact-import fidelity rests at a natural stopping point ([`v0-2.md`](./v0-2.md)); contact
methods' URL templates are convention — confirm on real hardware while testing a build.
