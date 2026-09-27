# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the v0.1 order is
> [`shipping.md`](./shipping.md); everything deferred is [`v0-2.md`](./v0-2.md).

## In flight

**v0.1 is iOS alone**, in external TestFlight with a real tester on it. macOS follows **after**
the company exists and the iOS record transfers to it ([`shipping.md`](./shipping.md) → _Part 2_).

**Android ships the same rungs** from the personal Play account, `rc` to closed testing;
`final` waits on production access, earned by the [14-day closed test](./android-pipeline.md).

**Next: `0.1.0` is Waiting for Review** (`v0.1.0-rc.2`, build 387695). When Apple approves
(a rejection is answered with another `rc`, see [`shipping.md`](./shipping.md) → _Part 1_):

```sh
pnpm release cut final --push
pnpm release ship --tag=<the tag it prints> --here
git push origin <that tag> refs/notes/releases
```

**Not gating GA:** [remote releases](./fable-investigation/remote-releases.md) — the owner's
go/no-go on step 6; step 7's workflows are written, and off until the Actions secrets exist.

**In parallel:** incorporate and get a D-U-N-S number — up to 30 days, before GA's transfer.

**Not gating.** [`v0-2.md`](./v0-2.md) → _Export_ (increment 6, three device checks),
contact-import fidelity, and the contact-method URL templates to confirm on real hardware.
