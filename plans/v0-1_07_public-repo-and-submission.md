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
3. **Decide on [`encryption/security-findings.md`](./encryption/security-findings.md).** It is an
   adversarial review with open HIGH findings — H1, the relay as a standing offline
   password-cracking oracle, plus open M1/M2/M4.
   > **Recommendation: publish it.** Transparency is on-brand, H1's deferral is already a
   > documented deliberate trade-off, and self-hosters deserve to know what they are accepting.
   > Quietly deleting it before going public would be worse on every axis. **But close anything
   > in its "suggested fix order" marked pre-v0.1 first** — an acknowledged-and-unfixed finding
   > reads very differently from a fixed one.
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
