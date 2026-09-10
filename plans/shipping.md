# Shipping Leapsake

> **Everything still between here and a Leapsake a stranger can install, in order.** Forward-
> looking only: what already shipped is `git log`, and the durable *why* behind each choice sits
> next to the code it constrains. **Delete each section as its work lands**, and the file when
> macOS ships.
>
> *Consolidated from `v0-1.md` + `ios-ga.md` on 2026-09-07, which were the last of ten numbered
> v0.1 docs. Numbering is retired — a gating doc is named for what it delivers.*

**Where this stands:** iOS is in external TestFlight with a real tester on it; the release
pipeline carries a build to *In Beta Review* unattended; the `beta` E2E bar is green on both
mobile platforms. v0.1 is **iOS alone, single-device** — sync is built and held behind
`multiDevice` in [`@leapsake/flags`](../packages/flags/README.md).

**The two parts below overlap on purpose.** Part 2's paperwork has a 30-day clock inside it and
must start **now**, in parallel with Part 1 — not when Part 1 finishes.

---

# Part 1 — Before iOS GA

Steps 1–3 are code; 4–6 are process and store paperwork. **The code is done bar one line of
release plumbing** — step 3's custody assertions landed on 2026-09-09 — so **4 and 5 are now the
long pole**, and 5 is the one nothing in the repo can check for you. If it is not on this list,
it does not block GA.

## 1 — Export

**A user must be able to get their data out before strangers can put data in.** Three facts make
this a blocker rather than a nicety:

- **There is no other copy.** v0.1 is single-device by construction, so the app container is the
  only place a user's data exists. Desktop at least documents a manual copy
  ([`apps/desktop/README.md`](../apps/desktop/README.md) → *Backing up and restoring*); mobile has
  no equivalent and no user-reachable filesystem.
- **The account sequence aims a user at deletion.** Clearing TestFlight for the transfer (Part 2)
  is exactly when a tester is most likely to delete and reinstall.
- **A promise is already in the code.** Forget-account offers an export first —
  [`@leapsake/key-custody`](../packages/key-custody/README.md) → *Forgetting the last device*
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

✅ **Acceptance is met** *(2026-09-08)*. The archive is the whole store, not just people and
contact methods, and both destructive confirmations offer it. **Delete this section** once the
three verifications in [`export.md`](./export.md) → *Still owed: the device tier* are done;
nothing else here is outstanding. **Reading an export back in landed on 2026-09-08** (increments
5a–5d), so what is left in that file is increment 6 — restore, desktop parity, CardDAV — and
none of it gates GA.

## 2 — Catalog Flow 7b, the phrase door

✅ **Acceptance is met** *(2026-09-09)*. `apps/mobile/maestro/e2e/07b-phrase-door.yaml`, green on
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

1. ⚠️ **The gate showed the *wrong door's* error.** `error` is a prop holding the last failed
   attempt, and `switchTo` did not retract it — so leaving the phrase door left its error behind
   and the **password** door rendered "That recovery phrase doesn't open this database." above an
   empty password field. Screenshotted, not inferred. It names the wrong door at the exact moment
   someone is working out which one they can still answer. `RecoveryGate` now suppresses an error
   the user has switched away from, and 7b asserts the absence.
2. **`eraseText` cannot clear a `multiline` field, and no count fixes it.** It backspaces from the
   caret, and `tapOn` puts the caret at the element's *centre* — so a bare `eraseText` and then
   `eraseText: 250` both left a tail, the door correctly rejected the result, and the red landed
   several steps later on the unlock. The field is now cleared through the app's own state, by
   leaving the door and coming back (`switchTo` does `setSecret("")`).
3. **The Forget-account branch of `factory-reset.yaml` ran for the first time.** It was
   structurally unreachable while every green arc ended Unauthenticated; 7b arrives with an
   account, so it takes that branch — which closes the ⚠️ in [`export.md`](./export.md) →
   *Still owed: the device tier* asking for "a flow that resets *after* Flow 4".

Both flows and their catalog entries: [`testing/crucial-flows.md`](./testing/crucial-flows.md) →
Flow 7. **Delete this section** once step 3 lands.

## 3 — The rest of the `rc` bar

✅ **The out-of-band custody assertions are built** *(iOS, 2026-09-09)*.
`scripts/lib/custody-assertions.mjs` reads the app's own bytes out of the simulator container
after Flows 1 and 4 go green: store custody (the 16-byte SQLite magic), store location, the
roster, and both doors. **What they buy:** every other test reads the screen, so a build that
displayed "your data is encrypted" and encrypted nothing would pass the whole suite green.
Their negative cases — the ones that prove a check can go red at all — are unit-tested against
fixture trees, since none of them can fail on a working simulator.

✅ **The key-store row is a decided deferral, not an oversight.** `xcrun simctl keychain` has
`add-cert`, `add-root-cert`, `reset` — and **no read verb** — and the surface that would answer
it is refused on principle (*never call into app code*: an app reporting "I am encrypted" is the
one piece of evidence an encrypting-nothing build would also produce). What stands in for it is
Flow 4's ciphertext store, which a build that minted no keys could not produce. Written down in
[`testing/crucial-flows.md`](./testing/crucial-flows.md) → *Where these run on mobile*, and
printed on every run so it stays visible.

**What is left is one line of release plumbing.** `scripts/release/targets/ios.mjs` carries "the
crucial-flow catalog green on a real device" as a `manual:` sentence on the `rc` rung — decorative,
enforcing nothing. It belongs in `requires:`, so the gate enforces it instead of reminding you.
⚠️ **How it learns the catalog is green is the question, and the answer is probably "wait for
step 4".** Three shapes, in preference order: **(a)** the check reads a **CI commit status** —
the industry-standard split, where the machine that runs the tests is not the person shipping,
and the one the *everything remote, independently verifiable* direction above is heading for
anyway; **(b)** a **receipt** the E2E run drops, which the check verifies against `HEAD` **plus a
clean worktree** — cheap, but it is this machine vouching for itself, so it defends against
*forgetting*, never against *lying* or against "works on my machine"; **(c)** re-running
`pnpm test:e2e` from the check, which costs the suite twice, since `pnpm test:all --strict
--provision` already runs later in the same pipeline. Build (b) only if a gate is wanted before
step 4 lands; otherwise (a) is less code and a stronger claim.

**Acceptance:** ✅ Flows 1 and 4 assert their out-of-band halves on iOS from the harness (the rung
table's `rc` column for both); ✅ the key-store row's impossibility is written down as a decided
deferral; ☐ `ios.mjs` carries the catalog in `requires:` so `pnpm release rc` fails without it.

The rung table: [`testing/crucial-flows.md`](./testing/crucial-flows.md); the rule they answer to
is [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *The E2E release gate*.

## 4 — Public repo

**Value:** transparency for a privacy product; free macOS Actions runners. Before GA because
going public first makes desktop auto-update simpler
([`desktop-packaging.md`](./desktop-packaging.md) → C) and is the cheaper mistake to make early.

⚠️ **Git history is public forever.** In this order:

1. Confirm `apps/server/test/fixtures/localhost-test-only.key` is a throwaway self-signed
   localhost cert. The name says so — **verify it**.
2. Run a proper secret scan over **full history** (gitleaks/trufflehog). Filename-level scanning
   is already clean; that is not the same thing.
3. **Read the security findings as a stranger would.** They publish with the repo — the relay's
   threat register ([`apps/server/README.md`](../apps/server/README.md)), the Argon2id honesty
   note ([`packages/crypto/README.md`](../packages/crypto/README.md)), and the open items in
   [`v0-2.md`](./v0-2.md). Transparency is on-brand and self-hosters deserve it; what to check is
   that **H1 in particular reads as a scoped, decided deferral rather than an unattended hole**.
   It is the one an outside reader finds first.
4. After flipping: a GitHub Actions workflow for **PR checks only**, calling the same scripts.
   The *release* gate stays local **for now, and for a smaller reason than this used to claim**.

⚠️ **This step used to say "hosted runners cannot provide a real unlocked keychain, and mocking
it would gut Flows 1, 4, 6 and 7". That conflates three different keychains, and only one of them
is a real obstacle** *(corrected 2026-09-09, against the code)*:

- **The simulator's keychain — what the mobile flows actually touch — is not a blocker.**
  [`apps/mobile/keystore/secure-store-keystore.ts`](../apps/mobile/keystore/secure-store-keystore.ts)
  uses `expo-secure-store` with `AFTER_FIRST_UNLOCK` and no `requireAuthentication`, so on a
  simulator it is the *device's own* keychain inside its data container — which is why `wipe` can
  reset it with `xcrun simctl keychain`. No host login session, no biometrics. Simulator builds
  are unsigned, so the tier needs no signing identity either. **Flows 1, 4, 6 and 7 can run on a
  hosted macOS runner.** What stands in the way is cost and horsepower, not capability: `expo
  run:ios` is a full native build (cache the app rather than compiling per run), and ⚠️ Flow 4's
  memory-hard Argon2id pass went **bimodal on a starved emulator** (see `EMULATOR_SIZE` in
  [`../scripts/lib/mobile-harness.mjs`](../scripts/lib/mobile-harness.mjs)) — a weaker runner is a
  flakiness risk worth *measuring* on a throwaway workflow before the gate depends on it.
- **The host login keychain is the real one, and it is desktop's, not mobile's.**
  [`apps/desktop/src/main/keystore/safe-storage-keystore.ts`](../apps/desktop/src/main/keystore/safe-storage-keystore.ts)
  derives its key from a genuine macOS Keychain item, so the macOS E2E tier does want an unlocked
  login keychain in a user session. Solvable (`security create-keychain` / `unlock-keychain` /
  `set-key-partition-list` is the standard recipe) but **unverified here** — and on Linux that
  file's own ⚠️ applies: `isEncryptionAvailable()` returns `true` over a `basic_text` fallback, so
  a green test there proves less than it appears to.
- **The signing keychain is a release concern and a solved one** — importing a `.p12` into a
  temporary keychain is routine iOS CI. Not a reason to keep anything local.

**Where this is heading** *(owner, 2026-09-09)*: **everything remote, and independently
verifiable** — no gate trusting a file on one Mac. The order is this step, then iOS E2E on a
hosted runner (proved on a throwaway workflow first), then releasing from CI with the App Store
Connect API key, then provenance attestation over the artifact. That also settles step 3's open
question: if CI can carry the catalog, the `requires:` check reads a commit status and no local
receipt is ever built.

**Acceptance:** repo public with a clean history scan; Actions green on a PR.

## 5 — The App Store Connect fields nothing in the repo can check

`ascSetup` reads the beta group, Test Information and Beta App Review Information — proven by
every beta that shipped — and stops there, because nothing more is required to distribute a
*beta*. It does **not** read `privacyPolicyUrl` or the App Privacy answers, so a green
`pnpm release beta --dry-run` says nothing about either and both are required here.

- Paste <https://leapsake.com/privacy/> into the app record.
- **Publish** the App Privacy questionnaire (answer: no collection); a draft does not count.
- Screenshots, age rating, support URL — the `final` rung's own manual list.
- ⚠️ The version string is **spent permanently** once submitted.

## 6 — Submit

TestFlight → App Store review; the `final` rung is the same path one step further on.

**Acceptance:** the iOS app installable by the public. **Then delete Part 1.**

---

# Part 2 — After iOS GA: the account sequence

**Start step 1 now.** It has the only calendar clock left in the whole plan.

1. **Leapsake incorporates** and gets a D-U-N-S number — up to **30 days**, and the entity must
   exist first, so this runs in parallel with Part 1 rather than after it.
2. **The iOS record transfers to the company.**
3. **Android starts under the company account** — [`android-pipeline.md`](./android-pipeline.md).
   Its first Play upload is its only one, and it claims `com.leapsake.app` correctly.
4. **macOS follows, signed under the company's Developer ID from its first release** —
   [`desktop-packaging.md`](./desktop-packaging.md). That ordering is not incidental; see the
   re-key cost below.

**Why GA has to come first:** Apple's transfer criteria require at least one **released**
version. The only alternative — freeing the name and re-reserving it from the company — opens a
race on a name that *is* exclusively reserved on Apple's side. GA-then-transfer is the only route
that keeps the name, the bundle ID, the installs and the reviews.

**Why Android waits rather than hurries:** a Play package name is claimed permanently by the
account that **first uploads** it, and nothing has ever been uploaded. So Android under the
company needs no Play transfer at all, and the 12-tester/14-day closed test — a rule for
*personal* accounts created after 2023-11-13, which ours is — never applies. What was the
critical path became a non-event.

⚠️ **Do not upload anything to Play from the personal account** — not an alpha, not a test. It is
the one irreversible step in the whole sequence. `scripts/release/targets/android.mjs` stays
`status: "blocked"` as the interlock; do not flip it until the company account exists.

## What the transfer costs, and why it is affordable

A transfer changes the **signing principal**, and
[`@leapsake/key-custody`](../packages/key-custody/README.md) → *The signing identity owns the
enclave key* is the fact to read first: **every existing enclave key becomes unreadable, for
everyone, at once.**

✅ **Confirmed against Apple, not assumed** *(2026-09-06)*. The hopeful reading — that the App ID
keeps its original prefix so keychain access survives — is **wrong**: a transferred App ID takes
the **recipient's** Team ID as its prefix, and the keychain access group is Team ID + bundle ID
([TN2311](https://developer.apple.com/library/archive/technotes/tn2311/_index.html)). The standard
mitigation — copy keychain items into an **app-group** keychain, ship it, wait, then transfer — is
**rejected**: an entitlement, a migration release and a wait window to save one password prompt,
and app-group container sharing is itself transfer-restricted for sandboxed Mac apps.

Under *encryption follows custody* the cost is bounded, and this is the strongest practical
vindication that model has had:

| The user is… | What the transfer costs them |
|---|---|
| **Unauthenticated** (no account) | **nothing** — there are no keys, the store is plaintext, it opens |
| **Authenticated** | **one password entry** at the recovery gate; the phrase only if they have forgotten the password too |

Three consequences, all actionable:

- **Blast radius scales with user count, so keep GA and the transfer close together.** Every day
  between them adds users who meet that gate. Step 1 running in parallel is what keeps the gap in
  days rather than months.
- **The gate needs a sentence, timed to the transfer.** A password prompt with no explanation
  reads as a breach. Release notes at minimum; a line on the gate itself is better.
- **Rehearse it before you rely on it.** `apps/mobile/app/dev-clear-dbkey.tsx` reproduces exactly
  this scenario — keychain key gone, store and doors intact. Both doors of it are automated now
  (Flows 7c and 7b), so the rehearsal is a suite run rather than a ceremony.
- **macOS ships after the transfer** for the same reason. `safeStorage`'s keychain ACL is bound to
  the code signature, so shipping desktop under the personal Developer ID first would pay this
  cost a second time, on a second platform, for nothing.

## What must be true before the transfer will start

Apple refuses the transfer, rather than queueing it, if any of these is unmet. Two reach back into
decisions made *before* it, which is why they are here and not in a runbook.

- **TestFlight fully off** — every build expired, **every tester deleted**, Test Information
  cleared. This is the one that costs something: it ends the external tester's access. Tell them
  to install the App Store build **without deleting the TestFlight app first** — same bundle ID,
  same container, so an update keeps their data while a delete-then-install destroys it.
- ⚠️ **No version may *ever* have used an iCloud or Passbook entitlement** — see Part 1 step 1.
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
   account's **phrase** but not its password must recover on their *other* device first — fine
   unless that device is the one they lost. **Leaning ship-without** (password-plus-a-second-
   device covers the realistic case, and the flow it would duplicate is the most delicate one we
   have), but it is a real hole in the *cannot strand anyone* promise. Context:
   [`@leapsake/key-custody`](../packages/key-custody/README.md) → *Not built: merge by recovery
   phrase*, which is where the two exits from local-only are specified now that
   [`encryption/model.md`](./encryption/model.md) §7 delegates custody to that package.
   **Flow 7a is decided with this, not separately.**

# Not here

Everything that does not gate the above is [`v0-2.md`](./v0-2.md), under a rule kept strict on
purpose: **ready-but-non-blocking is still not now.** The two platform docs
([`android-pipeline.md`](./android-pipeline.md), [`desktop-packaging.md`](./desktop-packaging.md))
hold the work Part 2 orders. Windows and Linux desktop are out of scope entirely — blocked on a
host, not waived ([`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *The E2E release gate*).
