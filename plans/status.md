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

**Next, and it is one thing: catalog Flow 7c, the password door.** Three `testID`s on
`RecoveryGate` (`apps/mobile/lib/core-context.tsx`, which carries none) and one Maestro flow
after `04` in the arc, where Flow 4 leaves exactly its preconditions — an Authenticated store
with data and a password the arc already typed. ⚠️ **Settle 7b's deferral with it, not after
it:** the catalog's 7c ends by asserting the *phrase* door still works, and that clause needs
the 24-word capture 7c was supposed to escape.

**Then, in order — [`shipping.md`](./shipping.md) → *Part 1* is the whole list, with
acceptance for each step.** ② The rest of the `rc` bar: 7b, the out-of-band custody
assertions (**the long pole** — they need a mobile inspection surface that does not exist),
and the catalog as a `requires:` check in `ios.mjs`. ③ **Public repo**, full-history secret
scan first. ④ **The App Store Connect fields nothing in the repo can check** — privacy URL, a
*published* App Privacy questionnaire, screenshots, age rating; `ascSetup` reads none of them.
⑤ **Submit**, then **GA**.

**In parallel, starting now, alongside the list above rather than after it:** incorporate and
get a D-U-N-S number — up to 30 days, and the entity must exist before the transfer GA unlocks.

**Not gating, and not next.** Export shipped 2026-09-07/08; what is left in
[`export.md`](./export.md) is increment 6 and three device verifications. Reminders and
contact-import fidelity rest at a natural stopping point ([`v0-2.md`](./v0-2.md)); contact
methods' URL templates are convention — confirm on real hardware while testing a build.
