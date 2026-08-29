# v0.1 · 10 — External TestFlight, from one command

> **Delete this doc when the work lands.** The rules belong in `scripts/release/`, which
> documents itself, and the Apple-side facts that survive belong in
> [`apps/mobile/README.md`](../apps/mobile/README.md). This file exists only for the part
> that is not built yet.

**Value:** `pnpm release beta` puts a build in front of people who are not the author, with
no App Store Connect session in the path — the same standard `alpha` already meets, one rung
up. It is the last rung before a store listing, and the first one where a stranger installs
Leapsake.

## ✅ The engineering is done *(2026-08-28)*

All of it, and it is not repeated here — the rules live next to the code that enforces them,
which is the point of this doc being deletable:

- **`scripts/release/asc.mjs`** — the App Store Connect client. ES256 JWT out of `node:crypto`
  alone, no dependency, and `scripts/release/asc.test.mjs` holds it to the two things that
  fail silently: the raw `R‖S` signature JWS wants, and Apple's `errors[].detail` reaching
  whoever ran the release.
- **`publish()` in `targets/ios.mjs`** goes past the upload for any rung whose tier is
  `external` (`beta` and `rc`): wait out processing with a real timeout and a progress line,
  attach *What to Test*, add the build to the group, submit for beta review tolerating an
  implicit submission Apple may have made first.
- **The preflights**, including the one deliberate live probe — widened, from what this doc
  planned, to read the app record's TestFlight setup as well as the key's role. Same
  authenticated session, same argument: each extra request replaces a failure that would
  otherwise cost a whole build. It is the check that produced the punch list below.
- **`release-notes/what-to-test.txt`**, `ASC_BETA_GROUP` in `.env.example`, and the `beta`
  rung's `manual:` list down to the review wait alone.
- **The rule this bends** — automating the step that reaches strangers — is argued in
  `targets/ios.mjs`'s own header, where the rule it bends is stated, rather than here.

**The gate it depends on is settled and green on both platforms** *(2026-08-28)*. The rung
grading it was built against is signed off ([`v0-1.md`](./v0-1.md) → *Open decisions* 1), so
nothing here is waiting on a judgment any more. The Android leg of the
E2E arc had never been run when this doc was written; running it took three harness bugs and
one app fix, all of them recorded where they bite —
[`apps/mobile/maestro/README.md`](../apps/mobile/maestro/README.md) and
`scripts/lib/mobile-harness.mjs`.

## What is left, and none of it is code

Everything below is an App Store Connect action by a person. The list is **measured, not
guessed**: `pnpm release beta --only=ios --dry-run` reads the app record and reports exactly
these, and it will keep reporting them until they are done.

1. ✅ **The API key's role is fine.** It reads `/v1/betaGroups`, which a *Developer*-role key
   cannot — so no new `.p8` is needed. *(Checked 2026-08-28.)*
2. ✅ **The external group exists**: `Beta`, external, email invites rather than a public link.
   Put `ASC_BETA_GROUP=Beta` in `.env`. **It has no testers in it** — adding them is item 7.
3. ⏳ **Test Information** — beta description and feedback email. Currently empty.
4. ⏳ **Beta App Review Information** — contact name, phone and email; review notes; and
   `demoAccountRequired = false`. **All three are currently unset, and the third is the one
   that gets a build rejected**: a reviewer who assumes there is a sign-in fails the build for
   a login that does not exist. Say plainly that Leapsake needs no account and works fully
   local.
5. ⏳ **A privacy policy URL that resolves.** The app record's `privacyPolicyUrl` is `null`.
   ✅ The policy itself is **written** — [`../PRIVACY.md`](../PRIVACY.md), publisher and contact
   filled in *(owner, 2026-08-28)*. What is left is a **URL**, which is hosting, and it is the
   only item here whose latency is not purely yours.

   **Two ways, and the choice is a sequencing one.** Making the repo public
   ([`07`](./v0-1_07_public-repo-and-submission.md)) gives that file a resolving URL for free —
   but the owner is **not ready to go public yet** *(2026-08-28)*, and 07 sits *after* this doc
   in the chain for reasons of its own. So either host the page somewhere first, or accept that
   this item waits on 07 and that the two swap order. **Do not let this default silently into
   "wait for 07"** — that is how the one long-latency item on the list becomes the thing that
   held the beta.
6. ⏳ **The App Privacy questionnaire.** Certainly required before App Store submission; verify
   whether it also gates external testing. The contacts import makes this real work.
7. ⏳ **Add testers to the group.**

3 and 4 *could* be pushed from the repo via `betaAppLocalizations` / `betaAppReviewDetails`,
which would make the app record reproducible. Not worth building: someone has to write the
copy either way, and it is set once. The preflight already refuses to release without them,
which is the part that mattered.

## The wait that stays

`pnpm release beta` can reach *submitted for beta review*, unattended. It cannot make review
finish — **roughly a day**, and no engineering shortens it.

That review is per **version**, not per build, and `app.config.ts` strips the suffix, so
`0.1.0-beta.1` and `0.1.0-beta.2` are one version to Apple: the first pays the day, the rest
go out in minutes. The existing alphas do **not** buy credit here — internal builds skip beta
review entirely, so the first external build of `0.1.0` still waits.

**Acceptance:** from a clean checkout, `pnpm release beta` cuts the tag, ships the ready
targets, and leaves the build *In Beta Review* with its notes and group already attached —
no App Store Connect session anywhere in the path. A day later a tester who is not the owner
installs it from TestFlight. **Everything up to the first half of that sentence is built and
unblocked; the second half waits on the seven items above.**
