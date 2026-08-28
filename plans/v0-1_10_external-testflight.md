# v0.1 · 10 — External TestFlight, from one command

> **Delete this doc when the work lands.** The rules belong in `scripts/release/`, which
> documents itself, and the Apple-side facts that survive belong in
> [`apps/mobile/README.md`](../apps/mobile/README.md). This file exists only for the part
> that is not built yet.

**Value:** `pnpm release beta` puts a build in front of people who are not the author, with
no App Store Connect session in the path — the same standard `alpha` already meets, one rung
up. It is the last rung before a store listing, and the first one where a stranger installs
Leapsake.

✅ **The alpha half is done** *(2026-08-26)*. Tag, gate, prebuild, archive, export, validate,
upload — all of it stage-agnostic already. `pnpm release beta` gets further than it looks:
the ladder computes `0.1.0-beta.1`, the store still sees `0.1.0`, preflight passes, and
`scripts/release/targets/ios.mjs:210` already declares the `beta` rung as *external
TestFlight* gated on a real app icon and export compliance. Two things stop it, and they are
different in kind.

## The blocker that is not Apple

`isStrict` (`scripts/release/index.mjs:258`) is `stage !== "alpha"`, so **beta runs
`pnpm test:all --strict`**, and the `e2e` tier is statically `blocked`
(`scripts/test-all.mjs:136`). Strict turns a blocked tier into a failure. `pnpm release beta`
therefore fails before it touches Apple at all.

⚠️ **Do not soften this by extending the alpha exemption.** That exemption was justified in
[`06`](./v0-1_06_e2e-and-release-gate.md) §B by *who installs the build* — internal
TestFlight is named App Store Connect users and no one else. §C's rule is that the
crucial-flow catalog must be green before the first release on a platform **where someone who
is not the author installs it**, and external TestFlight is precisely that rung. Exempting
beta would not be a smaller version of the same argument; it would contradict it.

**So [`06`](./v0-1_06_e2e-and-release-gate.md) is a hard dependency, and it is the long pole
here** — the Apple plumbing below is a day or two. What 06 now needs is only its mobile half
(Maestro on iOS and Android); its desktop leg left v0.1 with desktop packaging.

Note also that `--strict` runs the **whole** suite regardless of which targets ship, so a
beta needs a booted Android emulator as well as an iOS simulator. `--provision` boots them,
which is what a release passes — but it is on the critical path, not a background detail.

## What the iOS target has to do

`altool` puts the `.ipa` in App Store Connect and stops (`ios.mjs:332`). Everything that
makes a build reach an external tester is App Store Connect **API** work, and there is no
ASC API client anywhere in the repo today.

- **`scripts/release/asc.mjs`** — a small client for the App Store Connect REST API. An
  ES256 JWT signed with the `.p8` the release already uses, 20-minute expiry, and a
  `request()` that surfaces Apple's `errors[].detail`, which is unusually informative.
  `node:crypto` does all of this alone (`createPrivateKey`, then `sign` with
  `dsaEncoding: "ieee-p1363"` for the raw R‖S signature JWS wants) — **no dependency**, in
  keeping with the rest of `scripts/`.
- **Extend `publish()` past the upload** when the rung calls for it. Branch on `ctx.stage`,
  which `publish` already receives. Four steps: wait for `processingState` to reach `VALID`
  (5–20 minutes, needs a real timeout and a progress line, and must throw on `INVALID`);
  attach the *What to Test* text; add the build to the external group; submit for beta
  review, tolerating the already-submitted error, because recent App Store Connect often
  submits implicitly on group assignment.
- **Resolve the app by bundle ID**, not by a new secret. `filter[bundleId]` against
  `app.json` keeps `com.leapsake.app` the single identity the release knows.
- **The *What to Test* text comes from a repo file**, checked at preflight. Deriving it from
  `git log` produces notes written for us rather than for testers. The check matters more
  than the file: a missing note must fail in the first ten seconds, not after a 20-minute
  archive.
- **Preflights in the iOS shape**: the group name from `.env`, the notes file, and — a
  deliberate departure, since every check today is offline — **one live API call** proving
  the key can read `/v1/betaGroups`. That single request is what catches a Developer-role key
  before an archive instead of after an upload, and the cost of the inconsistency is smaller
  than the cost of the failure.
- **`.env.example`** gains the tester group name. Nothing else.
- **The `manual:` list on the beta rung shrinks** to the review wait alone. The beta
  description and *What to Test* entries stop being prerequisites a human supplies.

⚠️ **This softens a stated rule, so say so in the header rather than doing it quietly.**
`scripts/release/index.mjs` makes a principle of leaving the irreversible outward step to a
person. Uploading is already automated at alpha; *distributing to strangers* is a step
further. Automating it is right — cutting the tag is the consent gesture, and one command is
the whole point — but the reasoning belongs next to the rule it bends.

## What only a human can do

Nothing in the Apple Developer portal: the existing distribution certificate and App Store
provisioning profile cover external TestFlight unchanged.

In App Store Connect, **once**:

1. **Check the API key's role.** Uploading works with *Developer*; beta groups, build
   localizations and review submissions need **App Manager**. If the current key is
   Developer, mint a new one and swap the three variables — the `.p8` downloads exactly once.
2. **Create the external tester group.** Its name is the contract with `.env`. Decide public
   link versus email invites now.
3. **Test Information** — beta description and feedback email.
4. **Beta App Review Information** — contact details and review notes. State plainly that no
   sign-in is required: Leapsake works fully local with no account, and a reviewer who
   assumes otherwise is a rejection.
5. **A privacy policy URL that resolves.** Required for external testing.
6. **App Privacy questionnaire** — certainly required before App Store submission; verify
   whether it also gates external TestFlight. The contacts import makes this real work, not a
   checkbox.
7. **Add testers.**

3 and 4 *could* be pushed from the repo via `betaAppLocalizations` / `betaAppReviewDetails`,
which would make the app record reproducible. Not worth building: someone has to write the
copy either way, and it is set once.

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
installs it from TestFlight.

## Not gating: making a re-run idempotent

*Separate work, in `scripts/release/index.mjs` only, that landed in the same conversation.
If it does not land with the above, move it to [`v0-2.md`](./v0-2.md) rather than leaving it
here.*

**The goal:** a release is all-or-nothing across every ready target, and the recovery for any
failure is to fix it and run **the same command again** — never `--only`, which is to be
retired as a routine tool.

For **test** failures this is already true and needs nothing: the gate runs one repo-wide
suite, so a red iOS tier aborts before any tag exists and restores every manifest. Proven on
`alpha.2` ([`06`](./v0-1_06_e2e-and-release-gate.md) §B).

The gap is the phase **after** the tag, which is per-target (`index.mjs:439`). If iOS uploads
and Android fails, there is a tag, one shipped platform and one not — and a bare re-run
computes the *next* number rather than retrying, then re-uploads the platform that already
succeeded. Two changes close it:

- **Resume the existing tag instead of minting a new one** when the previous release did not
  finish. Largely derivable: after a partial release HEAD *is* the tag and the manifests
  agree, which is already the `--from-tag` precondition.
- **Record which targets shipped**, keyed by tag and including the build number — a
  *successful* release leaves the same shape as a partial one, and must still cut the next
  rung. The build number has to be in the record because it is clock-derived: without it a
  retry mints a different one and re-uploads instead of resuming. `LEAPSAKE_BUILD_NUMBER`
  already exists for exactly this and is the mechanism to reuse.

⚠️ **Gate platforms in the registry, never with a flag.** This is what `--only`'s retirement
depends on: when the Android target flips to `ready`, a bare `pnpm release beta` would start
Play's 14-day closed-test clock, which [`status.md`](./status.md) says explicitly not to do
yet. That belongs in `android.mjs` as a `blocked` status or a failing `requires` check on the
rung — something the release refuses and explains — not in a flag someone has to remember to
leave off.
