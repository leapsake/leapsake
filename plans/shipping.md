# Shipping Leapsake

> **Everything still between here and a Leapsake a stranger can install, in order.** Forward-
> looking only: what already shipped is `git log`, and the durable _why_ behind each choice sits
> next to the code it constrains. **Delete each section as its work lands**, and the file when
> macOS ships.

**Where this stands:** iOS is in external TestFlight with a real tester on it; the release
pipeline carries a build to _In Beta Review_ unattended; the `beta` E2E bar is green on both
mobile platforms. v0.1 is **iOS alone, single-device**; the relay half of the clients returns in
v0.2 ([`v0-2.md`](./v0-2.md) → _Encryption, sync, and the relay_).

**The two parts below overlap on purpose.** Part 2's paperwork has a 30-day clock inside it and
must start **now**, in parallel with Part 1, not when Part 1 finishes.

---

# Part 1 — Before iOS GA

`0.1.0` is **Waiting for Review**: `v0.1.0-rc.2` submitted build 387695, recorded against its
commit in `refs/notes/releases`, and the version is on manual release. What is left is Apple's
answer, then one command pair. If it is not on this list, it does not block GA.

## When Apple approves: release it

The version parks in _Pending Developer Release_. From this machine, with `main` checked out:

```sh
pnpm release cut final --push                  # tags the commit the approved build came from
pnpm release ship --tag=<the tag it prints> --here
git push origin <that tag> refs/notes/releases # or the exact command ship prints
```

`final` builds nothing: it releases the approved version and tags the commit that went live,
which it reads from `refs/notes/releases`. The tag is cut before the release, so it cannot land
on a rejected commit.

## If Apple rejects it

Fix what the rejection cites, then `pnpm release cut rc --push` and `ship` the new tag, pushing
the notes after. The same `0.1.0` record is reused, so a rejection costs an `rc.N+1` and nothing
more; the version string is spent only once a version is _released_.

**Acceptance:** the iOS app installable by the public. **Then delete Part 1.**

---

# Part 2 — After iOS GA: the account sequence

**Start step 1 now.** It has the only calendar clock left in the whole plan.

1. **Leapsake incorporates** and gets a D-U-N-S number: up to **30 days**, and the entity must
   exist first, so this runs in parallel with Part 1 rather than after it.
2. **The iOS record transfers to the company.**
3. **macOS follows, signed under the company's Developer ID from its first release**
   ([`desktop-packaging.md`](./desktop-packaging.md)). That ordering is not incidental; see the
   re-key cost below.

**Why GA has to come first:** Apple's transfer criteria require at least one **released**
version. The only alternative, freeing the name and re-reserving it from the company, opens a
race on a name that _is_ exclusively reserved on Apple's side. GA-then-transfer is the only route
that keeps the name, the bundle ID, the installs and the reviews.

**Android is not part of this sequence.** It ships from the personal Play account and moves to
the company by ordinary app transfer whenever the company exists, at no cost to users as long as
nobody requests a signing-key upgrade at transfer time
([`apps/mobile/README.md`](../apps/mobile/README.md) → _Android and the Play Console_). So data
safety does not decide where Android launches, and nothing else does either.

## What the transfer costs, and why it is affordable

**This section is about iOS.** An App Store transfer changes the **signing principal**, and
[`@leapsake/key-custody`](../packages/key-custody/README.md) → _The signing identity owns the
enclave key_ is the fact to read first: **every existing enclave key becomes unreadable, for
everyone, at once.** A transferred App ID takes the **recipient's** Team ID as its prefix, and the
keychain access group is Team ID + bundle ID
([TN2311](https://developer.apple.com/library/archive/technotes/tn2311/_index.html)); the
standard mitigation, copying keychain items into an app-group keychain ahead of time, is
**rejected**: an entitlement, a migration release and a wait window to save one password prompt,
and app-group container sharing is itself transfer-restricted for sandboxed Mac apps.

Under _encryption follows custody_ the cost is bounded, and this is the strongest practical
vindication that model has had:

| The user is…                     | What the transfer costs them                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Unauthenticated** (no account) | **nothing**: there are no keys, the store is plaintext, it opens                                     |
| **Authenticated**                | **one password entry** at the recovery gate; the phrase only if they have forgotten the password too |

Five consequences, all actionable:

- **Blast radius scales with user count, so keep GA and the transfer close together.** Every day
  between them adds users who meet that gate. Step 1 running in parallel is what keeps the gap in
  days rather than months.
- **The gate needs a sentence, timed to the transfer.** A password prompt with no explanation
  reads as a breach. Release notes at minimum; a line on the gate itself is better.
- ⚠️ **Prove the password still works _before_ the transfer, or the gate strands people.** The
  table says "one password entry", and that is true of everyone who knows their password. It is
  false for a user who created an account, never saved the 24 words, and has since forgotten the
  password: the enclave opens their store silently today, so **they have no idea anything is
  wrong**, and the transfer turns that latent state into permanent, unrecoverable loss, on a date
  we choose, for everyone at once. Ship a release ahead of the transfer that asks for the password
  once and checks it against the door. Whoever fails learns it while the enclave still opens
  everything and an export is still one tap away. It is the only mitigation here that **recovers**
  data rather than explaining its loss.
- **Rehearse it before you rely on it.** `apps/mobile/app/dev-clear-dbkey.tsx` reproduces exactly
  this scenario (keychain key gone, store and doors intact), and both doors of it are automated
  (Flow 4's door acts), so the rehearsal is a suite run rather than a ceremony.
- **macOS ships after the transfer** for the same reason. `safeStorage`'s keychain ACL is bound to
  the code signature, so shipping desktop under the personal Developer ID first would pay this
  cost a second time, on a second platform, for nothing.

**Not a transfer concern, but the Android data risk that is real:** Google Auto Backup ships an
accountless device's _plaintext_ store to Drive. Closed at the source, `android.allowBackup:
false`, with the reasoning in [`apps/mobile/README.md`](../apps/mobile/README.md) → _Layout_.

## What must be true before the transfer will start

Apple refuses the transfer, rather than queueing it, if any of these is unmet. Two reach back into
decisions made _before_ it, which is why they are here and not in a runbook.

- **TestFlight fully off**: every build expired, **every tester deleted**, Test Information
  cleared. This is the one that costs something: it ends the external tester's access. Tell them
  to install the App Store build **without deleting the TestFlight app first**. Same bundle ID,
  same container, so an update keeps their data while a delete-then-install destroys it.
- ⚠️ **No version may _ever_ have used an iCloud or Passbook entitlement.** Not a preference: a
  **permanent, one-way** constraint, or Apple's transfer criteria disqualify the record forever
  and strand it on the personal account. An iCloud-backed backup is the obvious design and the
  one design that cannot be built ([`@leapsake/export`](../packages/export/README.md)).
  `apps/mobile/app.json` is clean today (no iCloud, no App Groups, no Sign in with Apple, no
  Apple Pay, no associated domains; only `ITSAppUsesNonExemptEncryption` and two
  `LSApplicationQueriesSchemes`) and **must stay that way until the transfer completes**.
- **At least one version released to the App Store**, the reason Part 1 comes first.
- **Not available for pre-order**; both accounts out of any pending or changing state; the latest
  paid/free agreements accepted on both sides.
- **No in-app purchase product ID collides** with one in the recipient account. Moot today; re-read
  it when the paid relay exists.

**The transfer also renames the publisher, in public.** [`../PRIVACY.md`](../PRIVACY.md) names an
individual because that is what the Apple account is, and the App Store seller name has to match.
Incorporating changes both, and the policy is a **live URL a reviewer reads**, served from
[`apps/website`](../apps/website/README.md), so it is a thing the transfer updates rather than
discovers afterwards.

---

# Not here

Everything that does not gate the above is [`v0-2.md`](./v0-2.md), under a rule kept strict on
purpose: **ready-but-non-blocking is still not now.** The two platform docs
([`android-pipeline.md`](./android-pipeline.md), [`desktop-packaging.md`](./desktop-packaging.md))
hold the work Part 2 orders. Windows and Linux desktop are out of scope entirely: blocked on a
host, not waived ([`../CONTRIBUTING.md`](../CONTRIBUTING.md) → _The E2E release gate_).
