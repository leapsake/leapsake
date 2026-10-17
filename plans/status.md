# Leapsake — Status

> **What is in flight, and what is next. Nothing else.** No history, no decisions, no
> measurements — and never over 30 lines. What already landed is `git log`; the order is
> [`shipping.md`](./shipping.md); everything deferred is [`v0-2.md`](./v0-2.md).

## In flight

**`0.1.0` is live on the App Store** (iOS alone; macOS follows **after** the company exists
and the iOS record transfers to it, [`shipping.md`](./shipping.md)).

**Android ships the same rungs** from the personal Play account, `rc` to closed testing;
`final` waits on production access, earned by the [14-day closed test](./android-pipeline.md).

**Next: `0.2.0` goes to App Review** as `v0.2.0-rc.N`. Each new core needs its App Store
version record first; `rc`'s preflight says so. When Apple approves:

```sh
pnpm release cut final --push
git checkout <the tag it prints>
pnpm release ship --tag=<that tag> --here
git checkout main
git push origin <that tag> refs/notes/releases
```

**Now:** incorporate and get a D-U-N-S number (up to 30 days), then transfer the iOS record.

**Not gating:** [remote releases](./fable-investigation/remote-releases.md) (the owner's
go/no-go on step 6, then the Actions secrets); [`v0-2.md`](./v0-2.md) → _Export_ (increment
6, three device checks), contact-import fidelity, and the contact-method URL templates.
