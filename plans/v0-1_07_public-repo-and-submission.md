# v0.1 · 07 — Public repo + store submission

> **Delete this doc when the work lands.** It is now the **only** numbered doc left — 04, 05,
> 06 and 10 have all gone — so when it goes, so does [`v0-1.md`](./v0-1.md), and `plans/` holds
> only [`v0-2.md`](./v0-2.md), the two deferred-platform docs, and the design docs.

The final two steps, in this order. Going public first makes auto-update simpler
([desktop-packaging.md](./desktop-packaging.md) → C) and is the cheaper mistake to make early.

## A — Public repo

**Value:** transparency for a privacy product; free macOS Actions runners.

⚠️ **Git history is public forever.** The pre-flight precedes the flip, in this order:

1. Confirm `apps/server/test/fixtures/localhost-test-only.key` is a throwaway self-signed
   localhost cert. The name says so — **verify it**.
2. Run a proper secret scan over **full history** (gitleaks/trufflehog). Filename-level scanning
   is already clean; that is not the same thing.
3. **Confirm the security findings read well in public.** They are no longer one document to
   publish-or-not: the relay's four attacks are
   [`apps/server/README.md`](../apps/server/README.md) → *Threat register*, the Argon2id
   honesty note is [`packages/crypto/README.md`](../packages/crypto/README.md), and the open
   items are in [`v0-2.md`](./v0-2.md). **All of it publishes with the repo** — which was the
   recommendation when it was one doc, for reasons that still hold: transparency is on-brand,
   H1's deferral is a documented deliberate trade-off, and self-hosters deserve to know what
   they are accepting. What to actually do here is *read them as a stranger would* and check
   that H1 in particular reads as a scoped, decided deferral rather than an unattended hole —
   it is the one an outside reader will find first.
4. After flipping: a GitHub Actions workflow for **PR checks only**, calling the same scripts.
   The *release* gate stays local — hosted runners cannot provide a real unlocked keychain, and
   mocking it would gut Flows 1, 4, 6, and 7.

**Acceptance:** repo public with a clean history scan; Actions green on a PR.

## B — iOS submission

**Value:** a shipped iOS app. **Nothing blocks it but this doc's section A and the `rc` bar**
([`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *The E2E release gate*; the flows are
[`testing/crucial-flows.md`](./testing/crucial-flows.md) 7b and 7c) — Apple enrollment cleared
2026-08-19, the App Store Connect record exists, and `pnpm release` already carries a build to
*In Beta Review* unattended.

- **First, two App Store Connect fields nothing in the repo can check.** `ascSetup` reads the
  beta group, Test Information and Beta App Review Information — so those are proven by every
  beta that shipped — and stops there, because nothing else is required to distribute a *beta*.
  It does **not** read `privacyPolicyUrl` or the App Privacy answers, so a green
  `pnpm release beta --dry-run` says nothing about either, and both are required here. Paste
  <https://leapsake.com/privacy/> into the app record, and **Publish** the App Privacy
  questionnaire (answer: no collection) rather than leaving it in draft.
- TestFlight → App Store review. The `final` rung is the same path one step further on.
- ⚠️ **Android is not here any more** *(owner, 2026-09-06)*. It ships after v0.1, from the
  company account, and never from this one — [`android-pipeline.md`](./android-pipeline.md), and
  [`v0-1.md`](./v0-1.md) → *The account sequence* for why that ordering is the cheap one.

**Acceptance:** the iOS app installable by the public.

## Then

v0.1 is shipped. Delete this doc, delete [`v0-1.md`](./v0-1.md), and [`v0-2.md`](./v0-2.md)
becomes the plan — alongside [`android-pipeline.md`](./android-pipeline.md) and
[`desktop-packaging.md`](./desktop-packaging.md), which outlive it.

**And immediately: incorporate and transfer.** GA is precisely what makes the App Store Connect
record transferable, and the blast radius of the re-key scales with how many users hold accounts
when it happens ([`v0-1.md`](./v0-1.md) → *The account sequence*, step 2 onward). The paperwork
should already be running by the time this doc is deleted, not starting then.
