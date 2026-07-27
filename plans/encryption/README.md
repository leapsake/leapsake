# Leapsake Encryption, Privacy & Sync — design docs

This folder holds the **design** for how Leapsake protects, shares, and syncs user data —
the stable "why," not the status. **For what's built and what's next, see the single status
oracle [`../status.md`](../status.md)** (all workstreams).

> **Why this is still a subdirectory.** Most of these docs describe **unbuilt** stages
> (at-rest, asymmetric sharing, SSR) and so still earn their own space. As Stage 1 ships and
> Stages 2–4 are designed-and-done, this should collapse toward a single flat
> `plans/encryption.md` — the same flattening already done for reconciliation.

## Read in this order

| Doc | What it is | When to read it |
|---|---|---|
| [`model.md`](./model.md) | The stable conceptual model and locked decisions — the envelope/key-hierarchy *why*, the trust boundary, the honest limits. | To understand *why* the system is shaped this way. |
| [`schema.md`](./schema.md) | The concrete key tables (`content_key`, `key_wrap`, `account`, `device`, `share`). Reference. | When touching the schema or the `packages/data` repos. |
| [`custody-sequence.md`](./custody-sequence.md) | The key lifecycle, step by step (first launch → enable sync → second device → share → constrained principal), with a per-phase key ledger. Reference. | When wiring onboarding / account / device bootstrap. |
| [`sync.md`](./sync.md) | The `SyncTransport` transport seam, the merge model, the account-bootstrap channel + the join-scheme decision, and the **P2P-is-a-deferred-adapter** decision. | When building sync, the relay, or evaluating P2P. |
| [`security-review.md`](./security-review.md) | The recorded design review of the key hierarchy and relay auth: how the constructions hold the model's properties + the residual risks accepted. Pinned params live in [`packages/crypto/README.md`](../../packages/crypto/README.md). | When touching the KDF / password door, or before an external audit. |
| [`security-findings.md`](./security-findings.md) | The adversarial "poke holes" review of the *shipped* code + relay: a severity-ranked backlog of concrete attacks (offline crack oracle, unthrottled login, convergence DoS) with mitigations. | Before hardening the relay / KDF, or picking up a security fix. |

> **Decided 2026-07-26 — "encryption follows custody."** First launch mints **no keys** and
> leaves the store plaintext; creating an account (username + password) is the single act
> that turns encryption on, and the recovery phrase is its forgot-password backstop rather
> than a first-run ritual. This reverses the former "encrypted by default, never plaintext"
> line. It lives in [`model.md`](./model.md) §7.2–7.4 (states, lock/log out, per-user
> stores) and §8.1 (converting a store), with the lifecycle in
> [`custody-sequence.md`](./custody-sequence.md) Phases 0 → 0.5 → 1. The options doc that
> carried this decision (`local-custody-options.md`) is retired — see `git log`.

## The one rule that keeps these from drifting

**Build status and staging live only in [`../status.md`](../status.md)** (the cross-workstream
oracle). Every doc here *links* there instead of restating "what's done" or "which stage."
Keep it that way: when you finish a slice, update `../status.md` and nothing here needs a
status edit.

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
  nothing*. That is what lets the work ship as small additive **stages** (`status.md`).
- **Sync** rides on top: the server is a **blind relay** (`sync.md`), all merge is
  client-side, and **true P2P stays possible** as a future transport adapter.
- **State:** deliberately not restated here (the one rule above) — see
  [`../status.md`](../status.md).
