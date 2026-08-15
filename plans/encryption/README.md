# Leapsake Encryption, Privacy & Sync — design docs

This folder holds the **design** for how Leapsake protects, shares, and syncs user data — the
stable "why". **Design only** — no backlog lives here any more; see *Where the unbuilt work
lives* below. What is already built is in `git log` and in the doc-comments of the code; what is
being worked on *right now* is the only thing [`../status.md`](../status.md) tracks.

> **Consolidated twice.** 2026-07-27 from six docs — `custody-sequence.md` folded into
> `model.md` §7.5 (it had become the same story told twice) and `local-custody-options.md`
> retired once its decision was made. 2026-08-14: `schema.md` retired, because the key tables
> it specified are **built** — the migrations and the Zod schemas are the reference now, and a
> second copy could only drift from them. If you find yourself
> wanting a fifth doc for a custody or auth question, it belongs in `model.md` §7 instead:
> **one place says how auth and encryption work.**
>
> **One exception, clearly marked:** [`prune.md`](./prune.md) is an **exploratory** doc, not
> a decision record — a pre-v0.1 discussion with an open-questions list rather than locked
> decisions. Don't cite it as settled, and don't add more like it without the same banner.

## Read in this order

| Doc | What it is | When to read it |
|---|---|---|
| [`model.md`](./model.md) | The conceptual model and the locked decisions — the three layers, the envelope/key hierarchy, **all of custody** (§7: states, exits, store layout, key lifecycle), the trust boundary, the honest limits. | Always start here. Mandatory before touching onboarding, the boot path, or key handling. |
| [`sync.md`](./sync.md) | The `SyncTransport` transport seam, the merge model, the account-bootstrap channel + the join-scheme decision, and the **P2P-is-a-deferred-adapter** decision. | When building sync, the relay, or evaluating P2P. |
| [`prune.md`](./prune.md) | ⚠️ **Exploratory, nothing decided.** Relay retention: why the append log never shrinks, why minimum-cursor pruning corrupts joining devices, and the LWW-licensed compaction that needs no device tracking. | When thinking about relay storage cost, retention, or backup — and only ever as a proposal. |
| [`security-review.md`](./security-review.md) | The recorded design review of the key hierarchy and relay auth: how the constructions hold the model's properties + the residual risks accepted. Pinned params live in [`packages/crypto/README.md`](../../packages/crypto/README.md). | When touching the KDF / password door, or before an external audit. |

> **Custody is [`model.md`](./model.md) §7, and only there** — §7.2 the states, §7.2.1 the
> act that turns encryption on, §7.3 Locked / Sign out / Forget account, §7.4 one store per
> account, §7.5 the key lifecycle, plus §8.1 for converting a store. Nothing in this folder
> or anywhere else restates it; if you are about to, edit §7 instead.

## The one rule that keeps these from drifting

**These docs are design; unbuilt work lives in the numbered v0.1 docs or
[`../v0-2.md`](../v0-2.md), never here.** A work item that lands leaves no trace in this folder —
its delivery detail belongs in `git log` and in the doc-comments of the code it touched. Never
restate "what's done" or "which stage" in `model.md`/`sync.md`; they are meant to read the same
whether a thing shipped yesterday or ships next year.

**And when a thing is built, its *specification* moves to the code.** A doc here describes
intent; once there is a migration, a Zod schema and a repository, they are the reference and the
doc is a second copy that can only drift. That is what retired `schema.md` — the key tables are
now documented where they are defined.

## Where the unbuilt work lives — not here

**Stages 1–2 (zero-knowledge sync, at-rest) are done** and verified over the wire and on disk;
**custody is finished** on both clients; relay hardening is complete through H3.

This folder is **design only**. Everything unbuilt moved out on 2026-08-07 so it could be
ordered against the rest of the project:

| Work | Where |
|---|---|
| Proving the SSR / PWA design before v0.1 hardens it | [`../v0-1_web-spike.md`](../v0-1_web-spike.md) |
| Relay disposability, CK revocation/GC, the shared rate-limit counter, background sync, vCard export, the `createCore` cleanup, the relay-backup capability | [`../v0-2.md`](../v0-2.md) → *Encryption, sync, and the relay* |
| Automatic locking, session lifetime, biometrics | [`../v0-2.md`](../v0-2.md) — explicitly v0.2 *(owner, 2026-07-27)* |
| Stages 3–4 (sharing, the web app), the hosted-relay gate, passkeys, device management | [`../v0-2.md`](../v0-2.md) → *Post-launch* |
| Restore-from-file-backup | **Built and verified** *(2026-08-11)*. The procedure is [`apps/desktop/README.md`](../../apps/desktop/README.md) → *Backing up and restoring* |

The **open design questions** that are tied to a not-yet-started stage — the asymmetric scheme,
the public-key directory trust model, the web framework, share-URL formation, metadata
minimization, the SSR enclave ceiling — are listed with the stage that will answer them, in
[`../v0-2.md`](../v0-2.md).

> The relay store's `ALTER TABLE` try/catch migration pattern (`apps/server/src/store.ts`) is
> fine for single-node SQLite; revisit only if that store ever moves backends.

## The 60-second summary

- **Three layers, different jobs** (`model.md` §2): the **file lock** protects the database
  on this device, the **sync envelope** (`seal(row, MK)`) is what makes the relay blind, and
  **per-item content keys** exist for *sharing granularity*. Know which one you mean — the
  relay is kept honest by the envelope, not by the per-item keys.
- **Encryption follows custody** (`model.md` §7.2): no account → no keys → plaintext store;
  account → all layers on, with the password as the way back in.
- **Envelope encryption** (`model.md` §3): every shareable item gets a random **content
  key**, which is **wrapped** for whichever principals may read it (the owner's master
  key, a recipient's public key, a URL fragment, a constrained server). The server only
  ever holds ciphertext + wrapped keys → **zero-knowledge by default**.
- A **KEK layer** (`model.md` §4) means every later capability — recovery, passkeys, the
  security dial, sharing — is *one more wrapping of the master key, re-encrypting
  nothing*. That is what lets the work ship as small additive **stages**.
- **Sync** rides on top: the server is a **blind relay** (`sync.md`), all merge is
  client-side, and **true P2P stays possible** as a future transport adapter.
- **State:** deliberately not restated here (the one rule above) — see
  [`../status.md`](../status.md).
