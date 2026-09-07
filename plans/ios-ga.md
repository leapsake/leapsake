# iOS GA — the mandatory list

> **Everything that must be true before the iOS app is public, in order.** If it is not on this
> list it does not block GA; if it blocks GA it is on this list. **Delete this doc when the app
> ships** — and with it [`v0-1.md`](./v0-1.md), leaving `plans/` holding only
> [`v0-2.md`](./v0-2.md), the two deferred-platform docs, and the design docs.
>
> *Was `v0-1_07_public-repo-and-submission.md` until 2026-09-06.* The allocation number went
> with the rename: it was one of a set of ten, nine of which are gone, and a lone `07` now
> costs a reader more than it tells them. **The numbers below are step order, not ids** — the
> only stable identifiers left in this doc are the **catalog flow ids** (`7b`, `7c`), which are
> deliberately unchanged because they name rows in
> [`testing/crucial-flows.md`](./testing/crucial-flows.md) that outlive v0.1 (Flows 6 and 7a are
> v0.2 sync work) and are referenced from [`../CONTRIBUTING.md`](../CONTRIBUTING.md) and
> `scripts/release/targets/ios.mjs`.

Steps 1–4 are code. Steps 5–7 are process and store paperwork. **1 is the long pole and the only
feature work; start it first and run the rest alongside it.**

## 1 — Export *(GA-blocking as of 2026-09-06)*

**A user must be able to get their data out of the app before strangers can put data into it.**

This is not new scope; it is a promise the plan already made and then filed elsewhere.
[`v0-1.md`](./v0-1.md) defines v0.1 as an installable iOS app "**with a verified backup story**",
while the exporter sat in [`v0-2.md`](./v0-2.md) under *Ready now, deliberately held*. Three
facts closed that gap:

- **There is no other copy.** Sync is behind `multiDevice: false`, so v0.1 is single-device by
  construction. The app container is the only place the data exists.
- **The transfer sequence aims a user at deletion.** Clearing TestFlight for the org transfer
  ([`v0-1.md`](./v0-1.md) → *What must be true before step 3 will start*) is exactly the moment a
  tester is most likely to delete and reinstall, which destroys the container.
- **A promise is already in the code.** `encryption/model.md` §7.3.1 has Forget-account offering
  an export first; desktop's hard-confirm can only suggest copying the `stores` folder and mobile
  cannot say even that. Today that offer is unbacked.

**Shape** — carried over from `v0-2.md`, unchanged: user-initiated, client-side (the client
already holds plaintext), vCard/JSContact, people + contact methods first. It doubles as
groundwork for a future CardDAV surface. Wire the real Forget-account offer when it lands.

⚠️ **It must not use iCloud — not now, and not before the org transfer completes.** This is a
**permanent, one-way** constraint, not a preference: **no version** of the app may **ever** have
shipped an iCloud entitlement or Apple's transfer criteria disqualify the record forever, which
would strand the app on the personal Apple account for good ([`v0-1.md`](./v0-1.md) → *What must
be true before step 3 will start*). An iCloud-backed backup is the obvious design and it is the
one design that cannot be built here. **Use the share sheet / a file the user chooses.** Revisit
iCloud only after the transfer has completed, if ever.

**Acceptance:** a user can export their people and contact methods to a file they keep, from
both clients, without an account. Forget-account offers it.

## 2 — Catalog Flow 7c, the password door

The cheap half of the `rc` bar, and the one that matters most right now: it is the automated
version of the transfer-day rehearsal. `dev-clear-dbkey` and `RecoveryGate` both exist, so this
is three `testID`s and a Maestro flow.

**Acceptance:** 7c green on a real device — keychain key cleared, gate raised, password opens the
store with data intact.

## 3 — Catalog Flow 7b, the phrase door

The harder case. **Carries the phrase-capture cost** — the capture 7b needs is not built (see the
⚠️ above the matrix in [`testing/crucial-flows.md`](./testing/crucial-flows.md)). Price it
deliberately rather than assuming it.

> **The one live question on this list.** The catalog's own note says that if only one door can
> be afforded at `rc`, **7c is the cheaper and 7b covers the harder case**. Deferring 7b is a
> legitimate answer; deferring it *silently* is not. Decide it, write the decision here.

## 4 — The `rc` bar's remaining two

- **The out-of-band custody assertions** — the part of the catalog with no code yet. §C's rung
  table requires **all** of them at `rc`, and they need a **mobile inspection surface that does
  not exist**; that surface is the actual work, not the assertions.
- **Make the catalog requirement a real check.** `scripts/release/targets/ios.mjs` carries "the
  crucial-flow catalog green on a real device" as a `manual:` sentence on the `rc` rung. It
  belongs in `requires:`, so the gate enforces it instead of reminding you.

## 5 — Public repo

**Value:** transparency for a privacy product; free macOS Actions runners. Before GA because
going public first makes auto-update simpler ([desktop-packaging.md](./desktop-packaging.md) → C)
and is the cheaper mistake to make early.

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

## 6 — The App Store Connect fields nothing in the repo can check

`ascSetup` reads the beta group, Test Information and Beta App Review Information — so those are
proven by every beta that shipped — and stops there, because nothing else is required to
distribute a *beta*. It does **not** read `privacyPolicyUrl` or the App Privacy answers, so a
green `pnpm release beta --dry-run` says nothing about either, and both are required here.

- Paste <https://leapsake.com/privacy/> into the app record.
- **Publish** the App Privacy questionnaire (answer: no collection) rather than leaving it in
  draft.
- The `final` rung's own manual list: screenshots, age rating, support URL. And note that the
  version string is spent permanently once submitted.

## 7 — Submit

TestFlight → App Store review. The `final` rung is the same path one step further on. Apple
enrollment cleared 2026-08-19, the record exists, and `pnpm release` already carries a build to
*In Beta Review* unattended.

⚠️ **Android is not on this list** *(owner, 2026-09-06)*. It ships after v0.1, from the company
account, and never from this one — [`android-pipeline.md`](./android-pipeline.md), and
[`v0-1.md`](./v0-1.md) → *The account sequence* for why that ordering is the cheap one.

**Acceptance:** the iOS app installable by the public.

## Then

v0.1 is shipped. Delete this doc and [`v0-1.md`](./v0-1.md); [`v0-2.md`](./v0-2.md) becomes the
plan, alongside [`android-pipeline.md`](./android-pipeline.md) and
[`desktop-packaging.md`](./desktop-packaging.md), which outlive it.

**And immediately: incorporate and transfer.** GA is precisely what makes the App Store Connect
record transferable, and the blast radius of the re-key scales with how many users hold accounts
when it happens ([`v0-1.md`](./v0-1.md) → *The account sequence*, step 2 onward). The paperwork
should already be running by the time this doc is deleted, not starting then.
