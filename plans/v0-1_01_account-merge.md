# v0.1 · 01 — Merging a local account into a synced one

> **Delete this doc when the work lands.** How the built half works — the converter, the adopt flow, the crash
> ordering, `reconcileOnJoin` — is in the doc-comments on the files named below. This doc holds
> the missing half and is deleted when it empties.

**Why this doc exists:** the same work was described in three places, each partially — the
encryption folder's *username collision* open question, the onboarding plan's merge section, and
the mobile-pipeline gate. It is now the **first thing to build**, so it
gets one home. Those three now point here.

## The invariant this serves

> **A local store — Unauthenticated *or* Authenticated — must always be mergeable into an
> authenticated synced account.** *(owner, 2026-08-02.)*

A user who takes the wrong branch at the create/sign-in fork loses **time, never work**. That
outranks the UX guards in [`02 — the account invitation`](./v0-1_02_account-invitation.md): those reduce how often the
mistake is made, this decides what it costs.

**Sequencing settled** *(owner, 2026-08-07)*: this ships **before**
[`02 — the account invitation`](./v0-1_02_account-invitation.md), not alongside it. That step puts a *create
account* invitation on Home, which mass-produces the population holding a local-only account;
closed testers are the group likeliest to own a second device and therefore to hit it. The exit
gets closed before the trap is advertised. This moves [`04 — the mobile pipeline`](./v0-1_04_mobile-pipeline.md)
and the Play 14-day clock out by the length of this doc — accepted knowingly.

## What is already built — do not re-derive it

| Piece | Where | State |
|---|---|---|
| The row merge | `packages/core/src/sync.ts:625` `reconcileOnJoin` | **Done**, wired on desktop (`main/index.ts:406`) and mobile (`lib/core-context.tsx:980,1060`). Keeps this device's rows and sends overlaps to duplicate review rather than auto-fusing |
| Unauthenticated → synced | `apps/desktop/src/main/db/adopt-account-flow.ts:67` | **Done**: convert → password door → roster entry → destroy original. Called from `main/index.ts:699` (join) and `:767` (recover); integration test at `apps/desktop/test/integration/account-adopt.test.ts` |
| Plaintext → encrypted converter | desktop `main/db/convert-store.ts:46`, mobile `db/convert-store.ts:27` | **Done**, two deliberately parallel implementations — neither engine's native shortcut works on the other (desktop has `PRAGMA rekey` but no `sqlcipher_export`; SQLCipher has the reverse), so both run the same ordinary-SQL `ATTACH` + copy-from-`sqlite_master` |
| Crash ordering | the converter's doc-comment table | **Done**: convert → roster → destroy, with both overwrite guards enforced |
| Encrypted → encrypted copy | desktop `main/db/convert-store.ts` `rekeyStore` | **Done** *(Increment 1, 2026-08-08)*: the encrypted-source door onto the same ATTACH machinery, guards and crash ordering shared with the plaintext one. Tests in `apps/desktop/test/convert-store.test.ts` |

**The hard part — merging people without losing or silently fusing them — already exists.** What
is missing is custody plumbing, and it is bounded.

## Where it is refused today

| Layer | What it does |
|---|---|
| `apps/desktop/src/main/db/adopt-account-flow.ts:95` | throws — *"This device already holds an account. Forget it before joining another."* |
| ~~`convert-store.ts` refuses any non-plaintext source~~ | **Lifted by Increment 1.** `convertStoreToEncrypted` still refuses one, but `rekeyStore` is now the door that accepts it. The only refusal left is the flow guard above |

⚠️ **Read the comment at `adopt-account-flow.ts:88-94` before touching that guard.** An in-place
adopt branch **existed and was deliberately removed**, because "silently adopting a second account
into a store still homed under the first one's id was never a state worth producing." That
objection is *not* overturned here. What the invariant asks for is an **explicit, user-initiated
merge**; relaxing the guard in place would rebuild the branch that was cut. Keep the distinction —
it is the difference between rehoming a store on purpose and letting a roster inconsistency do it
by accident.

## The increments

Ordered so the thing most likely to fail comes first.

### ~~Increment 1 — the re-key converter, desktop~~ — **done 2026-08-08**

`rekeyStore` in `apps/desktop/src/main/db/convert-store.ts`: an encrypted source opened under
`fromKey`, `ATTACH`ing a destination under `toKey`, sharing one private body — and therefore one
set of guards and one crash ordering — with `convertStoreToEncrypted`. Twelve cases in
`apps/desktop/test/convert-store.test.ts`.

⚠️ **This doc previously said the destination is "keyed under the account master key". That was
wrong**, and the correction matters for Increment 2. The at-rest `db-key` is minted **per device**,
not per account ([`model.md`](./encryption/model.md) §7.1: a joining device "mints its own db-key,
adopts the account master key"); the MK is the sync envelope *inside* the database, not the file
key. So both of this device's stores are locked with the **same** key, and Increment 2 is a
**re-home** — the file moves to the synced account's folder without changing its lock.
`rekeyStore` still takes two keys, because a device that lost its keychain and returned through a
password door holds a *fresh* one (§6), and that store has to move under it.

**Do not replace the copy with a `rename`.** It is atomic, but it leaves a window where the file
has moved and the roster has not — and a crash there boots into a roster entry naming an empty
folder. Copy → roster → destroy is what makes the sequence survivable, and it is why Increment 1
is a converter rather than a `mv`.

Settled empirically while building, and now in the doc-comment: `PRAGMA cipher` before the
`ATTACH` names the *destination's* cipher and overrides `main`'s. Omitted, the attached file
inherits `main`'s — which is why it is mandatory on the plaintext path (no codec to inherit, so
the file is written with the library default and later fails to open as `sqlcipher`) and
belt-and-braces on the re-key path.

### Increment 2 — the merge flow, desktop

The user-initiated flow the invariant actually promises, on the rails
`adoptAccountOnThisDevice` already lays down.

- **Rehome the store.** The file lives at `storePath(localAccountId)` and carries an account row;
  the merge moves it to `storePath(syncedAccountId)`, rewrites the roster entry, and retires the
  local account. The move itself is `rekeyStore` from Increment 1, called with **the same key
  both ways** (`ensureDatabaseKey` is per device). Note the roster has no *retire* verb — only
  `add` (upsert by id) and `remove`, so the old entry needs removing explicitly.
- **Preserve the crash ordering** — convert → door → roster → destroy, unchanged. One wrinkle
  makes it stricter, not looser: the source is now itself an **encrypted store worth keeping** if
  the merge fails, so "the original survives until the roster names its replacement" matters more
  here than it did in the plaintext case.
- **The local password stops working.** After the merge the store opens under the synced
  account's password. That is user-visible and needs copy, not just a migration — it is the one
  part of this increment that is not mechanical.

**Done when** a desktop profile holding an Authenticated local-only account with data can sign in
to an existing synced account, keeps its rows, sees overlaps in duplicate review via
`reconcileOnJoin`, and opens on next launch under the synced account's password — with the
pre-merge store still launchable if the flow is killed before the roster write.

### Increment 3 — mobile parity

Mobile keeps its own converter (`apps/mobile/db/convert-store.ts`) by design, so Increments 1–2
are two implementations, not one. The mobile half also has no user-reachable filesystem, so the
"original survives" step is verified through `storeState` rather than a file-header read — the
same asymmetry the existing converters already document.

**Done when** the Increment 2 acceptance holds on a device, exercised through the custody
self-test (`leapsake://dev-selftest`) the way the plaintext conversion already is.

### Increment 4 — the username collision

A locally-chosen username may already exist on the relay, which answers `409`. **Two cases hide
behind that one error** and want opposite UX:

| The user means | The answer |
|---|---|
| *"This is me — I made a second account by accident"* | join it and review the duplicates. Increments 1–3 are what make this possible; `reconcileOnJoin` is the review half |
| *"Different person, I just need a different handle"* | rename. The easy half, and it must ship with relay binding |

The invariant settles the first reading — it must exist, and *"join it and review the
duplicates"* is its shape. **Only the rename half is genuinely open**, and it is the last thing
here rather than the first because a `409` a user cannot act on is worse than one they never
reach.

**Done when** both readings are reachable from the collision, on both clients.

## Open questions

- **Does the retired local account leave a tombstone?** Retiring it in the roster is enough for
  the device, but nothing yet decides whether the relay should learn that a local account id was
  folded into a synced one. Nothing depends on it today; it would matter for device management
  ([`v0-2.md`](./v0-2.md) → *Post-launch*).
- **Concurrent merges** — the same edge case [`v0-2.md`](./v0-2.md)
  already notes for merges generally: two devices merging overlapping pairs differently may
  diverge under LWW. Not made worse by this work, and not solved by it.
