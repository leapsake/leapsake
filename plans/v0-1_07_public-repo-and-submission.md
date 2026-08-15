# v0.1 · 07 — Public repo + store submission

> **Delete this doc when the work lands.** This is the last one: when it goes, so does
> [`v0-1.md`](./v0-1.md), and `plans/` holds only [`v0-2.md`](./v0-2.md), the design docs, and
> the testing strategy.

The final two steps, in this order. Going public first makes auto-update simpler
([05C](./v0-1_05_desktop-packaging-and-signing.md)) and is the cheaper mistake to make early.

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

## B — Mobile submission

**Value:** shipped mobile apps. **Blocked on Apple enrollment + [04](./v0-1_04_mobile-pipeline.md)'s
14-day window.**

- iOS: TestFlight → App Store review.
- Android: apply for production access once the closed-test criteria are met; promote.

**Acceptance:** both apps installable by the public.

## Then

v0.1 is shipped. Delete this doc, delete [`v0-1.md`](./v0-1.md), and
[`v0-2.md`](./v0-2.md) becomes the plan.
