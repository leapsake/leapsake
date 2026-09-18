# Leapsake Encryption, Privacy & Sync — design docs

Three docs, for the parts of the privacy design that are **not built yet**. Everything that
*is* built is documented where it lives — see the table below before looking here.

> **Six docs became three.** `custody-sequence.md` and `local-custody-options.md` folded into
> `model.md` in 2026-07 once their decisions were made. On 2026-08-14 `schema.md`,
> `security-findings.md` and `security-review.md` were retired for a different reason: the
> things they specified are **built**, so the code, its schemas and its tests are the
> reference, and a prose second copy could only drift from them. `sync.md` lost the same way
> — most of it described a shipped transport — and is now only its two open decisions.

| Doc | What it is | When to read it |
|---|---|---|
| [`model.md`](./model.md) | The conceptual model and the locked decisions — the three layers, the envelope/key hierarchy, **all of custody** (§7: states, exits, store layout, key lifecycle), the trust boundary, the honest limits. | Always start here. Mandatory before touching onboarding, the boot path, or key handling. |
| [`sync.md`](./sync.md) | The two sync decisions with no code yet: **P2P as a deferred adapter**, and **OPAQUE at the hosted-relay gate**. | When evaluating P2P, or before any hosted relay. |

> **Custody is [`model.md`](./model.md) §7, and only there** — §7.2 the states, §7.2.1 the
> act that turns encryption on, §7.3 Locked / Sign out / Forget account, §7.4 one store per
> account, §7.5 the key lifecycle, plus §8.1 for converting a store. Nothing in this folder
> or anywhere else restates it; if you are about to, edit §7 instead.

## Where the built design is documented

**Stages 1–2 (zero-knowledge sync, at-rest) are done** and verified over the wire and on disk;
custody is finished on both clients; relay hardening is complete through H3. None of that is
described here — it is described next to itself:

| What | Where |
|---|---|
| The key tables (`content_key`, `key_wrap`, `account`, `device`) | `packages/data/src/migrations.ts` (11, 14) and `packages/schema/src/{key-wrap,account,content-key}.ts` |
| The primitives, why each holds the model's properties, the accepted limits | [`@leapsake/crypto`](../../packages/crypto/README.md) |
| How a device obtains, holds, escrows and relinquishes the master key | [`@leapsake/key-custody`](../../packages/key-custody/README.md) |
| The transport port, the merge model and its cost, the account-bootstrap channel, the P2P invariants | [`@leapsake/sync`](../../packages/sync/README.md) |
| The relay: auth, why username + password, the threat register, deployment | [`apps/server`](../../apps/server/README.md) |
| Restore from a file backup | [`apps/desktop`](../../apps/desktop/README.md) → *Backing up and restoring* |

## Where the unbuilt work lives — also not here

This folder holds *design*, never a backlog:

| Work | Where |
|---|---|
| Building the SSR / PWA client — what the spike proved, and what an `apps/web` inherits *(the spike itself is done, 2026-08-15)* | [`../web-client.md`](../web-client.md) |
| Relay disposability, CK revocation/GC, the shared rate-limit counter, background sync, the `createCore` cleanup, the relay-backup capability, the open security findings | [`../v0-2.md`](../v0-2.md) → *Encryption, sync, and the relay* |
| Automatic locking, session lifetime, biometrics | [`../v0-2.md`](../v0-2.md) — explicitly v0.2 *(owner, 2026-07-27)* |
| Stages 3–4 (sharing, the web app), the hosted-relay gate, passkeys, device management | [`../v0-2.md`](../v0-2.md) → *Post-launch* |

The **open design questions** tied to a not-yet-started stage — the asymmetric scheme, the
public-key directory trust model, the web framework, share-URL formation, metadata
minimization, the SSR enclave ceiling — are listed with the stage that will answer them, in
[`../v0-2.md`](../v0-2.md).

## The two rules that keep this folder honest

1. **Design here, work elsewhere.** A work item that lands leaves no trace in this folder; its
   delivery detail belongs in `git log`. Never restate "what's done" or "which stage" in
   `model.md` — it should read the same whether a thing shipped yesterday or ships next year.
2. **When a thing is built, its *specification* moves to the code.** A doc here describes
   intent; once there is a migration, a schema and a test, they are the reference. Move the
   durable "why" next to them and delete the doc — the table above is what that looks like.

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
- **Sync** rides on top: the server is a **blind relay**, all merge is client-side, and
  **true P2P stays possible** as a future transport adapter.
