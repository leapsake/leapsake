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

The code is done: export, both at-rest doors, the out-of-band custody assertions, and a release
path where `rc` submits to App Store review and `final` releases the approved version and tags
the commit that went live. What is left is one piece of release plumbing that a larger change
absorbs, then process and store paperwork. **Steps 2 and 3 are the long pole**, and 3 is the one
nothing in the repo can check for you. If it is not on this list, it does not block GA.

## 1 — The `rc` gate becomes a check

`scripts/release/targets/ios.mjs` carries "the crucial-flow catalog green" as a `manual:`
sentence on the `rc` rung, enforcing nothing. It belongs in `requires:`. **How the check learns
the catalog is green is answered by the tag-triggered pipeline** in
[`fable-investigation/remote-releases.md`](./fable-investigation/remote-releases.md): the
pipeline itself runs the gate per platform on hosted runners before any upload, so the machine
that runs the tests is not the person shipping, and no local receipt is ever built. Steps 1–4
of that doc are script-only and can start now; steps 6–8 need step 2 below.

**Acceptance:** `pnpm release rc` cannot ship a build the catalog has not passed.

## 2 — Public repo

**Value:** transparency for a privacy product; free macOS Actions runners, which the pipeline in
step 1 depends on. Before GA because going public first makes desktop auto-update simpler
([`desktop-packaging.md`](./desktop-packaging.md) → C) and is the cheaper mistake to make early.

⚠️ **Git history is public forever.** In this order:

1. **Run the secret scan over every object, not every ref.** `pnpm test:secrets` runs on every
   ref in the trophy; its `--all-objects` mode reads **every blob in the object database,
   reachable or not**, and is the one to run before the repo actually flips. This history has
   been rewritten (`refs/original/`) and pushed, and a host keeps unreachable objects
   addressable by SHA long after no branch points at them. Every finding is recorded with its
   reasoning in `.gitleaksignore`, which publishes with the repo and is meant to be read.
2. **Read the security findings as a stranger would.** They publish with the repo: the relay's
   threat register ([`apps/server/README.md`](../apps/server/README.md)), the Argon2id honesty
   note ([`packages/crypto/README.md`](../packages/crypto/README.md)), and the open items in
   [`v0-2.md`](./v0-2.md). Transparency is on-brand and self-hosters deserve it; what to check
   is that **H1 in particular reads as a scoped, decided deferral rather than an unattended
   hole**. It is the one an outside reader finds first.
3. After flipping: the workflows in
   [`fable-investigation/remote-releases.md`](./fable-investigation/remote-releases.md) steps
   6–7, starting with the throwaway workflow that measures whether hosted runners can carry the
   device tiers at all.

**Acceptance:** repo public with a clean history scan; Actions green on a PR.

## 3 — The App Store Connect fields nothing in the repo can check

`ascSetup` reads the beta group, Test Information and Beta App Review Information, and stops
there, because nothing more is required to distribute a _beta_. It does **not** read
`privacyPolicyUrl` or the App Privacy answers, so a green `pnpm release beta --dry-run` says
nothing about either and both are required here.

**These have to be in place before `pnpm release rc`, not before `final`**: `rc` is the rung
that submits to review, so the metadata is what Apple reads on the day.

- Paste <https://leapsake.com/privacy/> into the app record.
- **Publish** the App Privacy questionnaire (answer: no collection); a draft does not count.
- Description, keywords, category, age rating, support URL. The first submission needs all of
  them, and none recurs.
- **Screenshots at two sizes, not one.** `supportsTablet: true`, so the listing is universal and
  App Store Connect requires a 13" iPad set alongside the 6.9" iPhone set. See
  [`v0-2.md`](./v0-2.md) → _Client / UX_ for what iPad support does and does not promise, and
  verify the app on an iPad simulator before submitting.
- ⚠️ The version string is **spent permanently** once a version is _released_. A rejection does
  not spend it: the same `0.1.0` record is edited and resubmitted, which is why a rejected rc
  costs a fresh `rc.N+1` and nothing more.

## 4 — Submit, then release

**Two commands, days apart, and the rungs mean different things.** Once
[`remote-releases.md`](./fable-investigation/remote-releases.md) lands, both are a tag arriving
at the remote; the laptop path stays as the guarded backdoor.

`rc` builds, uploads, hands the build to TestFlight's testers _and_ submits it to App Store
review. A rejection is answered with another `rc`: the version record is reused, so the attempts
cost tags rather than version strings.

`final` builds nothing. Once Apple approves, the version parks in _Pending Developer Release_
(`releaseType: MANUAL`), and `final` releases it, resolves which commit that build came from out
of `refs/notes/releases`, and tags it. That tag is the marker for the commit that actually
reached the public, which is why it is cut last, and why it cannot land on a rejected commit.

⚠️ **Push `refs/notes/releases` along with the tag.** The release prints the full command; a bare
`git push origin main <tag>` leaves the receipts on one machine, and `final` reads them to find
the live commit.

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
  (Flows 7b and 7c), so the rehearsal is a suite run rather than a ceremony.
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

# Open, and waiting on the owner

1. **Does v0.1 ship without merge by recovery phrase?** `recoverAccount` refuses a device that
   already holds an account exactly as `joinAccount` does, so merging by phrase needs the same
   copy-first treatment and is a second full flow on both clients. The gap: a user who has the
   account's **phrase** but not its password must recover on their _other_ device first, which is
   fine unless that device is the one they lost. **Leaning ship-without** (password-plus-a-second-
   device covers the realistic case, and the flow it would duplicate is the most delicate one we
   have), but it is a real hole in the _cannot strand anyone_ promise. Context:
   [`@leapsake/key-custody`](../packages/key-custody/README.md) → _Not built: merge by recovery
   phrase_. **Flow 7a is decided with this, not separately.**

# Not here

Everything that does not gate the above is [`v0-2.md`](./v0-2.md), under a rule kept strict on
purpose: **ready-but-non-blocking is still not now.** The two platform docs
([`android-pipeline.md`](./android-pipeline.md), [`desktop-packaging.md`](./desktop-packaging.md))
hold the work Part 2 orders. Windows and Linux desktop are out of scope entirely: blocked on a
host, not waived ([`../CONTRIBUTING.md`](../CONTRIBUTING.md) → _The E2E release gate_).
