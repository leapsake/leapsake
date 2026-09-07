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

## ✅ The App Store Connect record is complete too *(2026-09-06)*

Everything this doc listed as a person's job is done, and most of it is proven by the fact that
`0.1.0-beta.1` through `.3` shipped at all: `ascSetup` is a hard `requires:` on the `beta` rung
(`scripts/release/targets/ios.mjs`), the preflight runs before the tag is cut
(`scripts/release/index.mjs`), and it reads the live record rather than trusting a claim. **A
beta tag existing is therefore evidence, not a promise.**

1. ✅ **The API key's role is fine.** It reads `/v1/betaGroups`, which a *Developer*-role key
   cannot — so no new `.p8` was needed. *(Checked 2026-08-28.)*
2. ✅ **The external group exists**: `Beta`, external, email invites rather than a public link,
   named by `ASC_BETA_GROUP` in `.env`.
3. ✅ **Test Information** — beta description and feedback email, filled in and verified by the
   preflight on every beta since.
4. ✅ **Beta App Review Information** — contact name, phone and email, review notes, and
   `demoAccountRequired = false`, which is the one whose default is a rejection.
5. ✅ **The policy is hosted and the URL resolves** — <https://leapsake.com/privacy/>, served by
   [`apps/website`](../apps/website/README.md) from [`../PRIVACY.md`](../PRIVACY.md) itself.

   **The dilemma this doc recorded is gone, and worth a sentence because the resolution was not
   the one predicted.** The choice looked like *host it somewhere, or let the item wait on
   [`07`](./v0-1_07_public-repo-and-submission.md) going public* — with a warning not to let it
   silently default to the second. It defaulted to neither: the site was built *(2026-08-29)*,
   which gave the policy a URL a month before the repo goes public and left `07` free to happen
   on its own schedule. The "only item whose latency is not purely yours" turned out to be an
   afternoon.
6. ⏳ **The App Privacy questionnaire** — two minutes, and the whole of it is answering **no** to
   *do you or your third-party partners collect data from this app?* Apple defines *collect* as
   transmitting off the device, and nothing here does; there is no SDK, no analytics, no crash
   reporter. ⚠️ The answers sit in a **draft until Published**, which is a quiet way to be
   incomplete while believing otherwise.
7. ✅ **Testers in the group** — an external tester who is not the author has the build and is
   using it *(2026-09-06)*.

⚠️ **5 and 6 are the two items nothing in the repo can check, and they are the two that gate
GA rather than beta.** `ascSetup` reads the group, Test Information and Beta App Review
Information; it does **not** read `privacyPolicyUrl` or the App Privacy answers, because
neither is required to distribute an external *beta*. So a green `pnpm release beta --dry-run`
says nothing about either. **Confirm both by hand in App Store Connect before
[`07`](./v0-1_07_public-repo-and-submission.md) → B**, where they stop being optional: paste the
URL above into the app record, and Publish the questionnaire.

Item 6 is also an **attestation with an expiry condition**, not a task that stays done. It is
true only while the build transmits nothing — the invariant [`../PRIVACY.md`](../PRIVACY.md)'s
header already binds — and the answers are per-version.

3 and 4 *could* have been pushed from the repo via `betaAppLocalizations` /
`betaAppReviewDetails`. Still not worth building: someone has to write the copy either way, it
is set once, and the preflight already refuses to release without it — which is the half that
mattered and the half that caught these.

## The wait that stays

`pnpm release beta` can reach *submitted for beta review*, unattended. It cannot make review
finish — **roughly a day**, and no engineering shortens it.

That review is per **version**, not per build, and `app.config.ts` strips the suffix, so
`0.1.0-beta.1` and `0.1.0-beta.2` are one version to Apple: the first pays the day, the rest
go out in minutes. The existing alphas do **not** buy credit here — internal builds skip beta
review entirely, so the first external build of `0.1.0` still waits.

**Acceptance:** ✅ **met** *(2026-09-06)*. From a clean checkout, `pnpm release beta` cuts the
tag, ships the ready targets, and leaves the build *In Beta Review* with its notes and group
already attached — no App Store Connect session anywhere in the path. A day later a tester who
is not the owner installs it from TestFlight. All of that has now happened: three betas, and a
tester who is not the author using the app.

**So this doc's work is done, and by its own header it should be deleted** — the ASC client and
`publish()` document themselves in `scripts/release/`, and the Apple-side facts belong in
[`apps/mobile/README.md`](../apps/mobile/README.md). The two hand-checks in item 5/6's warning
are the only things that must outlive it; they belong to
[`07`](./v0-1_07_public-repo-and-submission.md) → B, which is where they bite.
