# Leapsake Encryption, Privacy & Sync — design docs

This folder holds the **design** for how Leapsake protects, shares, and syncs user data —
the stable "why," not the status. **For what's built and what's next, see the single status
oracle [`../status.md`](../status.md)** (all workstreams).

> **Four docs, four questions.** Consolidated 2026-07-27 from six — `custody-sequence.md`
> folded into `model.md` §7.5 (it had become the same story told twice) and
> `local-custody-options.md` retired once its decision was made. If you find yourself
> wanting a fifth doc for a custody or auth question, it belongs in `model.md` §7 instead:
> **one place says how auth and encryption work.**

## Read in this order

| Doc | What it is | When to read it |
|---|---|---|
| [`model.md`](./model.md) | The conceptual model and the locked decisions — the three layers, the envelope/key hierarchy, **all of custody** (§7: states, exits, store layout, key lifecycle), the trust boundary, the honest limits. | Always start here. Mandatory before touching onboarding, the boot path, or key handling. |
| [`schema.md`](./schema.md) | The concrete key tables (`content_key`, `key_wrap`, `account`, `device`, `share`). Reference. | When touching the schema or the `packages/data` repos. |
| [`sync.md`](./sync.md) | The `SyncTransport` transport seam, the merge model, the account-bootstrap channel + the join-scheme decision, and the **P2P-is-a-deferred-adapter** decision. | When building sync, the relay, or evaluating P2P. |
| [`security-review.md`](./security-review.md) | The recorded design review of the key hierarchy and relay auth: how the constructions hold the model's properties + the residual risks accepted. Pinned params live in [`packages/crypto/README.md`](../../packages/crypto/README.md). | When touching the KDF / password door, or before an external audit. |
| [`security-findings.md`](./security-findings.md) | The adversarial "poke holes" review of the *shipped* code + relay: a severity-ranked backlog of concrete attacks (offline crack oracle, unthrottled login, convergence DoS) with mitigations. | Before hardening the relay / KDF, or picking up a security fix. |

> **Decided 2026-07-26/27 — "encryption follows custody."** First launch mints **no keys**
> and leaves the store plaintext; creating an account (**username + password, required**) is
> the single act that turns encryption on, and the recovery phrase is its forgot-password
> backstop rather than a first-run ritual. This reverses the former "encrypted by default,
> never plaintext" line. All of it lives in [`model.md`](./model.md) §7 — §7.2 states, §7.2.1
> the flow, §7.3 Locked/Sign out/Forget account, §7.4 one store per account, §7.5 the key
> lifecycle — plus §8.1 for converting a store. **Build order: [`../status.md`](../status.md).**

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
