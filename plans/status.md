# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the order is
> [`shipping.md`](./shipping.md); everything deferred is its area's file ([`README.md`](./README.md)).

## In flight

**`0.2.0` is live on the App Store** (iOS alone; macOS follows **after** the company exists
and the iOS record transfers to it, [`shipping.md`](./shipping.md)).

**Android ships the same rungs** from the personal Play account, `rc` to closed testing;
`final` waits on production access, earned by the [14-day closed test](./android-pipeline.md).

A release is five commands from a clean tree, once App Review approves the `rc`. A new
core needs its App Store version record before its first `rc`; the preflight says so.

```sh
pnpm release cut final --push
git checkout <the tag it prints>
pnpm release ship --tag=<that tag> --here
git checkout main
git push origin <that tag> refs/notes/releases
```

**Now:** incorporate and get a D-U-N-S number (up to 30 days), then transfer the iOS record.

**Not gating:** [remote releases](./fable-investigation/remote-releases.md) (the owner's
go/no-go on step 6, then the Actions secrets); [`export.md`](./export.md) (increment
6, three device checks), contact-import fidelity, and the contact-method URL templates.
