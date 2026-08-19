# v0.1 · 04 — Mobile EAS pipeline + first closed-test upload

> **Delete this doc when the work lands.** The build configuration it produces (`eas.json`,
> signing setup) documents itself; anything a future maintainer needs goes in
> `apps/mobile/README.md`.

**Value:** starts the 14-day Play clock. Ships nothing to the public, unblocks everything.

**Prerequisites, all hard:** the account merge, the account invitation, and the verified restore
path (all landed, 2026-08-08 → 08-11). Closed testers are real users with real data — do not put
a build in their hands before the account fork exists, the merge path makes a wrong turn
recoverable, and the restore path is verified. See [`v0-1.md`](./v0-1.md) for why this one
increment carries the whole critical path.

## What to build

- **Settle store identity first** — see below. It is minutes of decision, and the first upload
  makes it permanent.
- Create `eas.json` with build profiles (dev / preview / production) — **none exists today**.
- Android signing via Play App Signing; keep the upload key out of the repo.
- First production-profile Android build → **closed testing track**; recruit ≥12 testers.
- iOS build profile in the same pass. **Apple enrollment cleared 2026-08-19**, so TestFlight is
  available immediately — there is nothing left to wait on for the iOS half.

## Store identity — the free-to-fix decision this upload makes permanent

*(Carried over from the retired 03 on 2026-08-11, because the deadline was always this upload
rather than the v0.1 cut — owner, 2026-07-31. Everything stays `0.0.0` until here.)*

Store version strings are permanent and monotonic per store record, and stores reject
non-numeric strings — so `0.0.0` and `0.1.0-dev` are both unusable there.

- Pick the real `version` and the versioning scheme for both clients. The *mechanism* is built —
  `scripts/set-version.mjs` writes every manifest and `pnpm test:versions` gates agreement — so
  this is purely the decision.
- Pick a **build-number strategy** (`ios.buildNumber` / `android.versionCode`), which exists
  nowhere yet. EAS can auto-increment them here.
- ✅ **Already done:** the credential shapes this increment and 05 introduce (`*.p12`,
  `AuthKey_*.p8`, `*.mobileprovision`, `*.jks`, `*.keystore`, `credentials.json`) are gitignored
  at the root preemptively — cheaper than a history rewrite, and the history goes public in 07.

Bundle IDs are settled in [`v0-1.md`](./v0-1.md) → *The decisions this encodes*:
`com.leapsake.app` for mobile. The new ID is a new app identity, so existing dev installs hold
orphaned data under the old one — uninstall and rebuild the dev client before running
`pnpm test:native`. `scheme: "leapsake"` is unchanged, so `leapsake://` deep links still route.

⚠️ **An App Store Connect record for Leapsake already exists** *(owner, 2026-08-19)* — the form
only, no build uploaded, nothing shared. **Check its bundle ID against `com.leapsake.app` before
building anything.** A record's bundle ID is fixed at creation and cannot be edited; while no
build has been uploaded the record can still be deleted and re-created for free, and after the
first upload it cannot. If they disagree, resolving it now is a two-minute job and later is not.
The record also means the Apple-side name is claimed — but see [`v0-1.md`](./v0-1.md) → *The one
long clock left* for what that commits you to, and for the Play-side name, which is not.

**Acceptance for this part:** fresh dev install on **iOS and Android** under `com.leapsake.app`;
`git status` clean.

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
