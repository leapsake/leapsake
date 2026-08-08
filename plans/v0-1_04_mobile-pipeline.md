# v0.1 · 04 — Mobile EAS pipeline + first closed-test upload

> **Delete this doc when the work lands.** The build configuration it produces (`eas.json`,
> signing setup) documents itself; anything a future maintainer needs goes in
> `apps/mobile/README.md`.

**Value:** starts the 14-day Play clock. Ships nothing to the public, unblocks everything.

**Prerequisites, all hard:** [01](./v0-1_01_account-merge.md), [02](./v0-1_02_account-invitation.md),
[03](./v0-1_03_store-identity-and-restore.md). Closed testers are real users with real data —
do not put a build in their hands before the account fork exists, the merge path makes a wrong
turn recoverable, and the restore path is verified. See [`v0-1.md`](./v0-1.md) for why this one
increment carries the whole critical path.

## What to build

- Create `eas.json` with build profiles (dev / preview / production) — **none exists today**.
- Android signing via Play App Signing; keep the upload key out of the repo.
- First production-profile Android build → **closed testing track**; recruit ≥12 testers.
- iOS build profile in the same pass; TestFlight upload once Apple enrollment clears.

## The clock, which is the whole point

Google Play production access requires a closed test with **≥12 testers opted in continuously for
14 days**, and the clock **only starts once a build is uploaded**. Everything about the ordering
in [`v0-1.md`](./v0-1.md) exists to start this as early as it can safely start.

⚠️ **Recruiting 12 real humans for 14 continuous days is a logistics task, not an engineering
one.** Start the list well before this increment — it is open decision 4 in
[`v0-1.md`](./v0-1.md).

## Acceptance

Reproducible signed builds from a clean checkout; Android build live in closed testing with the
tester count met and the 14-day clock running.
