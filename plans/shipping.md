# Shipping Leapsake

> **Everything still between here and a Leapsake a stranger can install, in order.** Forward-
> looking only: what already shipped is `git log`, and the durable _why_ behind each choice sits
> next to the code it constrains. **Delete each section as its work lands**, and the file when
> macOS ships.
>
> _Consolidated from `v0-1.md` + `ios-ga.md` on 2026-09-07, which were the last of ten numbered
> v0.1 docs. Numbering is retired — a gating doc is named for what it delivers._

**Where this stands:** iOS is in external TestFlight with a real tester on it; the release
pipeline carries a build to _In Beta Review_ unattended; the `beta` E2E bar is green on both
mobile platforms. v0.1 is **iOS alone, single-device** — the relay half of the clients was deleted on
2026-09-17 and is rebuilt for v0.2 from the tag `relay-clients-final`.

**The two parts below overlap on purpose.** Part 2's paperwork has a 30-day clock inside it and
must start **now**, in parallel with Part 1 — not when Part 1 finishes.

---

# Part 1 — Before iOS GA

Steps 1–3 are code; 4–6 are process and store paperwork. **The release path is done** — `rc`
submits to App Store review, and `final` releases the approved version and tags the commit that
went live _(2026-09-13)_ — and step 3's custody assertions landed on 2026-09-09. What step 3
still owes is one gate, and it is the only code left: the crucial-flow catalog is a `manual:`
sentence on the `rc` rung rather than a check that fails the release. So **4 and 5 are the long
pole**, and 5 is the one nothing in the repo can check for you. If it is not on this list, it
does not block GA.

## 1 — Export

**A user must be able to get their data out before strangers can put data in.** Three facts make
this a blocker rather than a nicety:

- **There is no other copy.** v0.1 is single-device by construction, so the app container is the
  only place a user's data exists. Desktop at least documents a manual copy
  ([`apps/desktop/README.md`](../apps/desktop/README.md) → _Backing up and restoring_); mobile has
  no equivalent and no user-reachable filesystem.
- **The account sequence aims a user at deletion.** Clearing TestFlight for the transfer (Part 2)
  is exactly when a tester is most likely to delete and reinstall.
- **A promise is already in the code.** Forget-account offers an export first —
  [`@leapsake/key-custody`](../packages/key-custody/README.md) → _Forgetting the last device_
  carried that promise as unbacked until the offer shipped on 2026-09-08. It is in the package
  rather than in `encryption/model.md`, whose §7 handed custody to that code on 2026-08-14.

**Shape:** user-initiated, client-side (the client already holds plaintext), vCard/JSContact,
people + contact methods first. Doubles as groundwork for a future CardDAV surface. **What the
format is and why lives in [`@leapsake/vcard`](../packages/vcard/README.md) and
[`@leapsake/export`](../packages/export/README.md); what is still unbuilt is
[`export.md`](./export.md)**. What follows is the gate, not the design.

⚠️ **It must not use iCloud.** Not a preference — a **permanent, one-way** constraint: **no
version** of the app may **ever** ship an iCloud entitlement, or Apple's transfer criteria
disqualify the record forever and strand it on the personal account (Part 2). An iCloud-backed
backup is the obvious design and the one design that cannot be built. **Share sheet, or a file
the user chooses.** Revisit only after the transfer completes, if ever.

**Acceptance:** a user can export people and contact methods to a file they keep, without an
account, and Forget-account offers it. **Mobile is what blocks GA** — desktop already documents a
manual `userData` copy and does not ship in v0.1, so desktop parity follows rather than gates.

✅ **Acceptance is met** _(2026-09-08)_. The archive is the whole store, not just people and
contact methods, and both destructive confirmations offer it. **Delete this section** once the
three verifications in [`export.md`](./export.md) → _Still owed: the device tier_ are done;
nothing else here is outstanding. **Reading an export back in landed on 2026-09-08** (increments
5a–5d), so what is left in that file is increment 6 — restore, desktop parity, CardDAV — and
none of it gates GA.

## 2 — Catalog Flow 7b, the phrase door

✅ **Acceptance is met** _(2026-09-09)_. `apps/mobile/maestro/e2e/07b-phrase-door.yaml`, green on
the iPhone 16 Pro simulator, appended **last** to the `test:e2e` arc. With 7c, both at-rest doors
are now automated, and the `rc` bar's flow half is complete.

**The shape was the question, and it answered it as predicted.** 7b resets the device, seeds a
person, creates its own account and captures the phrase from the reveal it just watched — because
a capture cannot leave the flow that made it, so the flow that needs the words must be the flow
that saw them. It runs last because that opening reset destroys the store `04` builds and `07c`
inherits.

**The capture cost 4 seconds and needed no new app surface** — which was the one part of this
step nobody had ever measured, and the reason it was written down as unvalidated rather than
assumed. A `repeat` of `copyTextFrom` over `1\. .*` … `24\. .*`, accumulating into `output` via
`evalScript`, read all 24 words on the first attempt with no scrolling — so the `recovery-phrase`
anchor was not built, and the phrase is still never exposed as a single string. Two Maestro
details are worth keeping: `repeat` has no loop index (the counter lives in `output`), and an
`evalScript` must contain no `{` or `}` or interpolation truncates it.

**Measured, whole flow 4m45s:** the store conversion 53s and the one password unlock 26s (the two
Argon2id passes); the phrase door itself is **sub-second in both directions** — a wrong phrase
rejected and a right one accepted — because it unwraps raw key material and derives nothing.

**It found three things, and one of them was a real bug in front of a locked-out user:**

1. ⚠️ **The gate showed the _wrong door's_ error.** `error` is a prop holding the last failed
   attempt, and `switchTo` did not retract it — so leaving the phrase door left its error behind
   and the **password** door rendered "That recovery phrase doesn't open this database." above an
   empty password field. Screenshotted, not inferred. It names the wrong door at the exact moment
   someone is working out which one they can still answer. `RecoveryGate` now suppresses an error
   the user has switched away from, and 7b asserts the absence.
2. **`eraseText` cannot clear a `multiline` field, and no count fixes it.** It backspaces from the
   caret, and `tapOn` puts the caret at the element's _centre_ — so a bare `eraseText` and then
   `eraseText: 250` both left a tail, the door correctly rejected the result, and the red landed
   several steps later on the unlock. The field is now cleared through the app's own state, by
   leaving the door and coming back (`switchTo` does `setSecret("")`).
3. **The Forget-account branch of `factory-reset.yaml` ran for the first time.** It was
   structurally unreachable while every green arc ended Unauthenticated; 7b arrives with an
   account, so it takes that branch — which closes the ⚠️ in [`export.md`](./export.md) →
   _Still owed: the device tier_ asking for "a flow that resets _after_ Flow 4".

Both flows and their catalog entries: [`testing/crucial-flows.md`](./testing/crucial-flows.md) →
Flow 7. **Delete this section** once step 3 lands.

## 3 — The rest of the `rc` bar

✅ **The out-of-band custody assertions are built** _(iOS, 2026-09-09)_.
`scripts/lib/custody-assertions.mjs` reads the app's own bytes out of the simulator container
after Flows 1 and 4 go green: store custody (the 16-byte SQLite magic), store location, the
roster, and both doors. **What they buy:** every other test reads the screen, so a build that
displayed "your data is encrypted" and encrypted nothing would pass the whole suite green.
Their negative cases — the ones that prove a check can go red at all — are unit-tested against
fixture trees, since none of them can fail on a working simulator.

✅ **The key-store row is a decided deferral, not an oversight.** `xcrun simctl keychain` has
`add-cert`, `add-root-cert`, `reset` — and **no read verb** — and the surface that would answer
it is refused on principle (_never call into app code_: an app reporting "I am encrypted" is the
one piece of evidence an encrypting-nothing build would also produce). What stands in for it is
Flow 4's ciphertext store, which a build that minted no keys could not produce. Written down in
[`testing/crucial-flows.md`](./testing/crucial-flows.md) → _Where these run on mobile_, and
printed on every run so it stays visible.

**What is left is one line of release plumbing.** `scripts/release/targets/ios.mjs` carries "the
crucial-flow catalog green on a real device" as a `manual:` sentence on the `rc` rung — decorative,
enforcing nothing. It belongs in `requires:`, so the gate enforces it instead of reminding you.
⚠️ **How it learns the catalog is green is the question, and the answer is probably "wait for
step 4".** Three shapes, in preference order: **(a)** the check reads a **CI commit status** —
the industry-standard split, where the machine that runs the tests is not the person shipping,
and the one the _everything remote, independently verifiable_ direction above is heading for
anyway; **(b)** a **receipt** the E2E run drops, which the check verifies against `HEAD` **plus a
clean worktree** — cheap, but it is this machine vouching for itself, so it defends against
_forgetting_, never against _lying_ or against "works on my machine"; **(c)** re-running
`pnpm test:e2e` from the check, which costs the suite twice, since `pnpm test:all --strict
--provision` already runs later in the same pipeline. Build (b) only if a gate is wanted before
step 4 lands; otherwise (a) is less code and a stronger claim.

**Acceptance:** ✅ Flows 1 and 4 assert their out-of-band halves on iOS from the harness (the rung
table's `rc` column for both); ✅ the key-store row's impossibility is written down as a decided
deferral; ☐ `ios.mjs` carries the catalog in `requires:` so `pnpm release rc` fails without it.

The rung table: [`testing/crucial-flows.md`](./testing/crucial-flows.md); the rule they answer to
is [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → _The E2E release gate_.

## 4 — Public repo

**Value:** transparency for a privacy product; free macOS Actions runners. Before GA because
going public first makes desktop auto-update simpler
([`desktop-packaging.md`](./desktop-packaging.md) → C) and is the cheaper mistake to make early.

⚠️ **Git history is public forever.** In this order:

1. ✅ **Verified** _(2026-09-09)_: `apps/server/test/fixtures/localhost-test-only.key` is a
   throwaway. Subject == issuer, `CN=localhost`, `O=Leapsake TEST ONLY - do not use`, and the key
   matches that cert and nothing else. Allowlisted by path in `.gitleaks.toml`, not by hand.
2. ✅ **Built and green** _(2026-09-09)_: `pnpm test:secrets` (`scripts/secret-scan.mjs`), a tier
   in the trophy, over **every ref** — plus a `--all-objects` mode that reads **every blob in the
   object database, reachable or not**, which is the one to run before the repo actually flips.
   ⚠️ That distinction is not pedantry here: this history has been rewritten (`refs/original/`)
   and pushed, and a host keeps unreachable objects addressable by SHA long after no branch
   points at them. Both modes are clean. **Eleven findings were read against the blobs, not
   waved through**: a dead Next.js build key in `apps/client-web/.next/` (an app that no longer
   exists, its `.next/` committed by accident and removed three commits later), the crate name
   `crypto_secretbox` in a retired spike's `Cargo.lock`, and the fixture above. Each is recorded
   with its reasoning in `.gitleaksignore`, which publishes with the repo and is meant to be read.
   The scanner is a **pinned, checksum-verified** official binary cached under `node_modules/`
   ([`../scripts/lib/ensure-gitleaks.mjs`](../scripts/lib/ensure-gitleaks.mjs)) — nothing to
   install, and no third-party postinstall added to the trust base of a repo about to go public.
3. **Read the security findings as a stranger would.** They publish with the repo — the relay's
   threat register ([`apps/server/README.md`](../apps/server/README.md)), the Argon2id honesty
   note ([`packages/crypto/README.md`](../packages/crypto/README.md)), and the open items in
   [`v0-2.md`](./v0-2.md). Transparency is on-brand and self-hosters deserve it; what to check is
   that **H1 in particular reads as a scoped, decided deferral rather than an unattended hole**.
   It is the one an outside reader finds first.
4. After flipping: a GitHub Actions workflow for **PR checks only**, calling the same scripts.
   The _release_ gate stays local **for now, and for a smaller reason than this used to claim**.

⚠️ **This step used to say "hosted runners cannot provide a real unlocked keychain, and mocking
it would gut Flows 1, 4, 6 and 7". That conflates three different keychains, and only one of them
is a real obstacle** _(corrected 2026-09-09, against the code)_:

- **The simulator's keychain — what the mobile flows actually touch — is not a blocker.**
  [`apps/mobile/keystore/secure-store-keystore.ts`](../apps/mobile/keystore/secure-store-keystore.ts)
  uses `expo-secure-store` with `AFTER_FIRST_UNLOCK` and no `requireAuthentication`, so on a
  simulator it is the _device's own_ keychain inside its data container — which is why `wipe` can
  reset it with `xcrun simctl keychain`. No host login session, no biometrics. Simulator builds
  are unsigned, so the tier needs no signing identity either. **Flows 1, 4, 6 and 7 can run on a
  hosted macOS runner.** What stands in the way is cost and horsepower, not capability: `expo
run:ios` is a full native build (cache the app rather than compiling per run), and ⚠️ Flow 4's
  memory-hard Argon2id pass went **bimodal on a starved emulator** (see `EMULATOR_SIZE` in
  [`../scripts/lib/mobile-harness.mjs`](../scripts/lib/mobile-harness.mjs)) — a weaker runner is a
  flakiness risk worth _measuring_ on a throwaway workflow before the gate depends on it.
- **The host login keychain is the real one, and it is desktop's, not mobile's.**
  [`apps/desktop/src/main/keystore/safe-storage-keystore.ts`](../apps/desktop/src/main/keystore/safe-storage-keystore.ts)
  derives its key from a genuine macOS Keychain item, so the macOS E2E tier does want an unlocked
  login keychain in a user session. Solvable (`security create-keychain` / `unlock-keychain` /
  `set-key-partition-list` is the standard recipe) but **unverified here** — and on Linux that
  file's own ⚠️ applies: `isEncryptionAvailable()` returns `true` over a `basic_text` fallback, so
  a green test there proves less than it appears to.
- **The signing keychain is a release concern and a solved one** — importing a `.p12` into a
  temporary keychain is routine iOS CI. Not a reason to keep anything local.

**Where this is heading** _(owner, 2026-09-09)_: **everything remote, and independently
verifiable** — no gate trusting a file on one Mac. The order is this step, then iOS E2E on a
hosted runner (proved on a throwaway workflow first), then releasing from CI with the App Store
Connect API key, then provenance attestation over the artifact. That also settles step 3's open
question: if CI can carry the catalog, the `requires:` check reads a commit status and no local
receipt is ever built.

**Acceptance:** repo public with a clean history scan; Actions green on a PR.

## 5 — The App Store Connect fields nothing in the repo can check

`ascSetup` reads the beta group, Test Information and Beta App Review Information — proven by
every beta that shipped — and stops there, because nothing more is required to distribute a
_beta_. It does **not** read `privacyPolicyUrl` or the App Privacy answers, so a green
`pnpm release beta --dry-run` says nothing about either and both are required here.

**These have to be in place before `pnpm release rc`, not before `final`** — `rc` is the rung
that submits to review, so the metadata is what Apple reads on the day.

- Paste <https://leapsake.com/privacy/> into the app record.
- **Publish** the App Privacy questionnaire (answer: no collection); a draft does not count.
- Description, keywords, category, age rating, support URL — the first submission needs all of
  them, and none recurs.
- **Screenshots at two sizes, not one.** `supportsTablet: true`, so the listing is universal and
  App Store Connect requires a 13" iPad set alongside the 6.9" iPhone set. See
  [`v0-2.md`](./v0-2.md) → _Client / UX_ for what iPad support does and does not promise.
- ⚠️ The version string is **spent permanently** once a version is _released_. A rejection does
  not spend it: the same `0.1.0` record is edited and resubmitted, which is why a rejected rc
  costs a fresh `rc.N+1` and nothing more.

## 6 — Submit, then release

**Two commands, days apart, and the rungs mean different things now.**

`pnpm release rc` builds, uploads, hands the build to TestFlight's testers _and_ submits it to
App Store review. A rejection is answered with another `rc` — the version record is reused, so
the attempts cost tags rather than version strings.

`pnpm release final` builds nothing. Once Apple approves, the version parks in _Pending Developer
Release_ (`releaseType: MANUAL`), and `final` releases it, resolves which commit that build came
from out of `refs/notes/releases`, and tags it. That tag is the marker for the commit that
actually reached the public — which is why it is cut last, and why it cannot land on a rejected
commit.

⚠️ **Push `refs/notes/releases` along with the tag.** The release prints the full command; a bare
`git push origin main <tag>` leaves the receipts on one machine, and `final` reads them to find
the live commit.

**Acceptance:** the iOS app installable by the public. **Then delete Part 1.**

---

# Part 2 — After iOS GA: the account sequence

**Start step 1 now.** It has the only calendar clock left in the whole plan.

1. **Leapsake incorporates** and gets a D-U-N-S number — up to **30 days**, and the entity must
   exist first, so this runs in parallel with Part 1 rather than after it.
2. **The iOS record transfers to the company.**
3. **macOS follows, signed under the company's Developer ID from its first release** —
   [`desktop-packaging.md`](./desktop-packaging.md). That ordering is not incidental; see the
   re-key cost below.

**Why GA has to come first:** Apple's transfer criteria require at least one **released**
version. The only alternative — freeing the name and re-reserving it from the company — opens a
race on a name that _is_ exclusively reserved on Apple's side. GA-then-transfer is the only route
that keeps the name, the bundle ID, the installs and the reviews.

**Android is no longer part of this sequence** _(owner, 2026-09-13)_. It ships from the personal
account to the internal and closed tracks now, and moves to the company by ordinary app transfer whenever the
company exists — [`android-pipeline.md`](./android-pipeline.md).

⚠️ **This section used to say the opposite, and the claim it rested on is false.** It held that a
Play package name is claimed permanently by the first account to upload it, making that upload the
one irreversible step in the whole sequence. Transfers move the package name; the 12-tester/14-day
wall gates _production access_ only; and internal testing is exempt from it on every account type.
The correction and its sources are in [`android-pipeline.md`](./android-pipeline.md).

## What the transfer costs, and why it is affordable

**This section is about iOS.** An App Store transfer changes the **signing principal**, and
[`@leapsake/key-custody`](../packages/key-custody/README.md) → _The signing identity owns the
enclave key_ is the fact to read first: **every existing enclave key becomes unreadable, for
everyone, at once.** ⚠️ **This cost does not generalize** — see _Android's transfer is free_ below
before carrying this table over to the Play move.

✅ **Confirmed against Apple, not assumed** _(2026-09-06)_. The hopeful reading — that the App ID
keeps its original prefix so keychain access survives — is **wrong**: a transferred App ID takes
the **recipient's** Team ID as its prefix, and the keychain access group is Team ID + bundle ID
([TN2311](https://developer.apple.com/library/archive/technotes/tn2311/_index.html)). The standard
mitigation — copy keychain items into an **app-group** keychain, ship it, wait, then transfer — is
**rejected**: an entitlement, a migration release and a wait window to save one password prompt,
and app-group container sharing is itself transfer-restricted for sandboxed Mac apps.

Under _encryption follows custody_ the cost is bounded, and this is the strongest practical
vindication that model has had:

| The user is…                     | What the transfer costs them                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Unauthenticated** (no account) | **nothing** — there are no keys, the store is plaintext, it opens                                    |
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
  wrong**, and the transfer turns that latent state into permanent, unrecoverable loss — on a date
  we choose, for everyone at once. Ship a release ahead of the transfer that asks for the password
  once and checks it against the door. Whoever fails learns it while the enclave still opens
  everything and an export is still one tap away. It is the only mitigation here that **recovers**
  data rather than explaining its loss.
- **Rehearse it before you rely on it.** `apps/mobile/app/dev-clear-dbkey.tsx` reproduces exactly
  this scenario — keychain key gone, store and doors intact. Both doors of it are automated now
  (Flows 7c and 7b), so the rehearsal is a suite run rather than a ceremony.
- **macOS ships after the transfer** for the same reason. `safeStorage`'s keychain ACL is bound to
  the code signature, so shipping desktop under the personal Developer ID first would pay this
  cost a second time, on a second platform, for nothing.

### Android's transfer is free, and the iOS cost must not be carried over _(2026-09-13)_

**A Play transfer costs users nothing** — no gate, no password, no re-key. Play App Signing keeps
the **app signing key** with the app, so the signature a device sees is unchanged, the Android
Keystore entries stay valid, and `expo-secure-store` keeps reading them. Google's transfer doc
moves the package name and "all users, statistics, data, comments, ratings" across, and issues a
new signing key **only if the receiving account requests one** via key upgrade. So the whole rule
is: **do not request a key upgrade at transfer time.** Asking for one would buy Android the entire
iOS cost above, for nothing.

The consequence for sequencing: **data safety does not decide where Android launches** — and as of
_2026-09-13_ nothing else does either. Launching from the personal account and transferring later
is safe for user data, and the **12-tester/14-day wall** this paragraph once treated as the one
remaining obstacle gates _production access_ only; internal testing is exempt from it on every
account type. Android therefore ships from the personal account to the internal and closed tracks, and the
detail is [`android-pipeline.md`](./android-pipeline.md)'s.

**Not a transfer concern, but the Android data risk that is real:** Google Auto Backup ships an
accountless device's _plaintext_ store to Drive. Closed at the source — `android.allowBackup:
false` — with the reasoning in [`apps/mobile/README.md`](../apps/mobile/README.md) → _Layout_.

## What must be true before the transfer will start

Apple refuses the transfer, rather than queueing it, if any of these is unmet. Two reach back into
decisions made _before_ it, which is why they are here and not in a runbook.

- **TestFlight fully off** — every build expired, **every tester deleted**, Test Information
  cleared. This is the one that costs something: it ends the external tester's access. Tell them
  to install the App Store build **without deleting the TestFlight app first** — same bundle ID,
  same container, so an update keeps their data while a delete-then-install destroys it.
- ⚠️ **No version may _ever_ have used an iCloud or Passbook entitlement** — see Part 1 step 1.
  `apps/mobile/app.json` is clean today (no iCloud, no App Groups, no Sign in with Apple, no Apple
  Pay, no associated domains — only `ITSAppUsesNonExemptEncryption` and two
  `LSApplicationQueriesSchemes`) and **must stay that way until the transfer completes**.
- **At least one version released to the App Store** — the reason Part 1 comes first.
- **Not available for pre-order**; both accounts out of any pending or changing state; the latest
  paid/free agreements accepted on both sides.
- **No in-app purchase product ID collides** with one in the recipient account. Moot today; re-read
  it when the paid relay exists.

**The transfer also renames the publisher, in public.** [`../PRIVACY.md`](../PRIVACY.md) names an
individual because that is what the Apple account is, and the App Store seller name has to match.
Incorporating changes both — and the policy is a **live URL a reviewer reads**, served from
[`apps/website`](../apps/website/README.md), so it is a thing the transfer updates rather than
discovers afterwards.

⚠️ **One claim still unverified**: that Play's tester wall genuinely exempts organization
accounts. Google scopes the rule to personal accounts and does not discuss orgs — consistent
across secondary sources, never stated by Google in those words.

---

# Open, and waiting on the owner

1. **Does v0.1 ship without merge by recovery phrase?** `recoverAccount` refuses a device that
   already holds an account exactly as `joinAccount` does, so merging by phrase needs the same
   copy-first treatment and is a second full flow on both clients. The gap: a user who has the
   account's **phrase** but not its password must recover on their _other_ device first — fine
   unless that device is the one they lost. **Leaning ship-without** (password-plus-a-second-
   device covers the realistic case, and the flow it would duplicate is the most delicate one we
   have), but it is a real hole in the _cannot strand anyone_ promise. Context:
   [`@leapsake/key-custody`](../packages/key-custody/README.md) → _Not built: merge by recovery
   phrase_, which is where the two exits from local-only are specified now that
   [`encryption/model.md`](./encryption/model.md) §7 delegates custody to that package.
   **Flow 7a is decided with this, not separately.**

# Not here

Everything that does not gate the above is [`v0-2.md`](./v0-2.md), under a rule kept strict on
purpose: **ready-but-non-blocking is still not now.** The two platform docs
([`android-pipeline.md`](./android-pipeline.md), [`desktop-packaging.md`](./desktop-packaging.md))
hold the work Part 2 orders. Windows and Linux desktop are out of scope entirely — blocked on a
host, not waived ([`../CONTRIBUTING.md`](../CONTRIBUTING.md) → _The E2E release gate_).
