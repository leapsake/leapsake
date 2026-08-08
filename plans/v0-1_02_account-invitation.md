# v0.1 · 02 — The account invitation

> **Delete this doc when the work lands.** Its durable design — how the nudge engine decides,
> snoozes, and retires steps — is already in `@leapsake/reminders`
> ([README](../packages/reminders/README.md) + the doc-comments on `ONBOARDING_STEPS` and
> `snoozePolicyOf`). Nothing here restates it.

**Prerequisite: [01 — account merge](./v0-1_01_account-merge.md) must land first.** This doc puts
a *create account* invitation in front of every user; 01 is what makes taking it wrongly
survivable. Do not start this one early.

**Gates [04 — mobile pipeline](./v0-1_04_mobile-pipeline.md).** Closed testers are real users with
real data, and two things follow: their data sits in the clear until they have an account
(`encryption/model.md` §7.2.1's un-erasable window), and they are the population most likely to
install on a **second device**, which needs an account to work at all.

## Value

Gets users from Unauthenticated to Authenticated — the state that turns encryption on, and the
precondition for sync and sharing, neither of which has a key to seal under until an account
exists.

⚠️ **This is not a data-loss fix, and saying so was the old plan's mistake for two drafts.** An
Unauthenticated store is plaintext with no keys, so there is nothing to be locked out of. Copy
promises **access, not safety** (`encryption/model.md` §7.2.1): an account protects access, a
*backup* protects against losing the device. Get this wrong and users hear a guarantee we do not
make.

## The fork — the shape this ships in *(owner, 2026-08-02)*

The two nudges are an explicit fork, not two similar offers:

- **"Already have Leapsake? Sign in"** — stands from day 1.
- **"Create your account"** — appears only once there is local data worth protecting.

**Why the guard sits on *create*, not spread evenly.** The two possible mistakes cost wildly
different amounts:

| The user… | …when they should have… | Cost |
|---|---|---|
| signs in | created | **None.** `SyncSetup` (`Settings.tsx:695`) calls `window.sync.lookup` and branches to `LoginStep` or `SignupStep` on the answer. Guessing wrong self-corrects |
| creates | signed in | **Was stranding.** `CreateAccount` runs no lookup — it cannot, it is deliberately relay-free. 01 is what turns this from one-way into a detour |

**Ordering alone does not fix it**, which is why the wording carries the load: both rows are on
Home simultaneously, and *"create your account"* reads like the primary setup action while
*"connect to sync"* reads like an optional extra. A returning user can easily take the wrong one
from the top of the list. *"Connect to sync"* is our vocabulary, not the user's — a returning
user is looking for the words **sign in**.

## What to build

- A fourth step on the existing rails: `hasAccount`, a `create-account` route, and both client
  CTA tables (`apps/desktop/src/renderer/src/lib/reminder-row.ts:32` `ctaLinkFor`,
  `apps/mobile/lib/reminder-row.ts:62` `ctaOffer`).
- **`applies: (s) => s.hasEntities && !s.hasAccount`** — the invitation waits for something worth
  protecting. `hasEntities` already exists as a signal, so this needs no new plumbing.
  > **Not a wall-clock delay, deliberately.** "Day 2 or 3" is the *expected effect* of gating on
  > data, not a second condition. A user who imports 200 contacts on day 1 has reached the moment
  > the account matters **most**, and an elapsed-time floor would mute the invitation exactly
  > then. If a floor is ever wanted anyway it needs no new column: `sync-devices` is minted at
  > the first reconcile, so its `createdAt` *is* the install date.
- It is the step that must never be wrongly silenced, so it takes **more repetitions than the
  floor** — the one step expected to.
- **Resolve the collision with `sync-devices`:** both nudges currently deep-link to the same
  Settings screen, and `sync-devices` only retires on `relayUrl`, so a user who creates a
  local-only account keeps a nudge pointing at a flow that cannot satisfy it. Retire
  `sync-devices` on `hasAccount` too, or reword it.
- Titles stay free of `#`/`@` tokens so the core insert-wrapper materializes no tags or mentions.

**Working copy draft** (wording is not blocking, but the honesty clause is):
> 🔐 **Set up your login to protect the data on this device.**
> It stays on this device. A login encrypts it and is what lets you sync later.

## Acceptance

A brand-new profile sees no custody UI until it has data; the invitation then appears on Home;
creating an account clears it permanently and leaves the store encrypted with the plaintext
original gone; *Not now* re-surfaces it on schedule; *Don't ask again* does not. **Both clients.**

Verify it disappears **immediately** on account creation, not at next launch — desktop's store
swap rebuilds core, and mobile's `createAccountHere` path needs checking (a one-line
`regenerateSystem()` if not).

## Deliberately deferred

**Guarding the destination** — the create screen opening with *"Do you already have a Leapsake
account on another device?"* — was weighed and cut from this increment. It catches every route
in, including Settings visited directly, and is the only option that does not depend on the user
reading two Home rows correctly. It is worth doing; it is not worth blocking the launch clock
for, now that 01 makes the wrong turn recoverable. It belongs with the Settings decomposition in
[`v0-2.md`](./v0-2.md).
