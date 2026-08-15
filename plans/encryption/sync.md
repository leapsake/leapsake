# Leapsake — Sync: the decisions not yet built

> **What this doc is now.** The transport port, the blind relay, the merge model and the
> account-bootstrap channel are all **built**, so they are documented where they live:
> [`@leapsake/sync`](../../packages/sync/README.md) (the port, the merge model and its
> accepted cost, how a second device gets the master key, the P2P invariants),
> [`apps/server`](../../apps/server/README.md) (the relay, its auth, why username +
> password, the threat register), and `packages/schema/src/merge.ts` (the resolver).
>
> What is left here is the two sync decisions with **no code yet**: whether we ever do
> true P2P, and what replaces the password verifier before anyone else's data is hosted.
> Both shape work that is scheduled but unstarted, which is why they are still in `plans/`.

## 1. P2P — a deferred adapter, not a closed door

**Decision: do not build P2P; do not foreclose it either.** True peer-to-peer sync stays a
first-class roadmap item, implemented later as **a second `SyncTransport` adapter** alongside
the relay. The four invariants that keep it addable for free are honored today and are
recorded with the code that must keep honoring them
([`@leapsake/sync`](../../packages/sync/README.md) → *What must stay true for P2P*).

**Why not now.** The hybrid topology already needs a relay — a public, durable host is
required anyway for shareable URLs and the SSR web app (`model.md` §14) — and once a blind
relay exists, pure-P2P personal sync buys little for a personal CRM syncing a handful of
devices, at real cross-platform cost. P2P shines for large fleets, serverless operation, and
large-file swarming; none of those is this shape. So the relay is first and P2P is additive.

**The Iroh assessment**, for whoever picks this up. [Iroh](https://www.iroh.computer/) is the
leading candidate: a connectivity layer (dial peers by node-ID over QUIC, NAT hole-punching,
relay fallback) plus content-addressed blobs, with
[JS bindings](https://docs.iroh.computer/languages/javascript) (`@number0/iroh`, napi-based)
so it is consumable from TypeScript.

- The honest caveat is **platform reach, not language**. The "TypeScript everywhere"
  principle (`AGENTS.md`) is about *our source*, not our dependencies.
  - **Desktop / Node** — a napi native module; the easy case.
  - **React Native** — a native module means leaving **Expo Go** for a dev build, a real
    cost against the zero-dev-build workflow V2 preserved.
  - **Browser / web** — the WASM + WebTransport path is real but nascent.
- **The likely path** when P2P graduates: an Iroh adapter, **desktop-first**, with the relay
  adapter remaining the universal fallback and the only transport on web. The port makes
  "different transports on different platforms" natural — exactly as `KeyStore` and
  `SqliteDriver` already do.
- Iroh would **not** replace `@leapsake/crypto`. It secures *transport*, which the envelope
  already makes untrusted; it provides no envelope, no at-rest encryption, no capability
  links, and no merge model. A transport adapter and nothing more.

## 2. Auth hardening — OPAQUE at the hosted-relay gate *(decided 2026-07-05)*

**The problem:** the relay observes the raw auth verifier, so against a curious *operator* —
the exact adversary a blind relay is designed for — account confidentiality reduces to
password strength stretched by one interactive Argon2id pass. The attack in full is threat
**H1** in [`apps/server/README.md`](../../apps/server/README.md) → *Threat register*.

Three candidate fixes were weighed **through the accessibility lens** (`model.md` §1: a
security default must not cost laypeople usability). Recorded so it is not relitigated:

- **Decision: OPAQUE (an aPAKE), required before any official or hosted relay stores other
  people's data** — "the hosted-relay gate," tracked in [`../v0-2.md`](../v0-2.md). Not v0.1
  scope: v0.1 sync is self-host-only, so the operator is the user or someone they chose to
  trust. **The deciding criterion:** OPAQUE keeps login *exactly* username + password. The
  entire cost is engineering — a vetted protocol dependency — and zero new user-visible
  burden. That is what beat the alternatives, both of which spend the user's attention.
- **Until then:** the current verifier scheme, plus short-lived session tokens and required
  TLS (both built — threat H3), plus an honest sentence in the self-hosting docs.
- **Passkeys (WebAuthn PRF): supported eventually, deliberately not the default.** A
  passkey-derived key is high-entropy — nothing crackable at all — and platform-synced, but
  passkeys are not yet common or universally understood enough to be the layperson default.
  They land as one more additive MK unlock door (`model.md` §4/§5), post-launch.
- **A 1Password-style Secret Key / client pepper: declined as a default.** The only option
  that *fully* closes the operator-crack hole, but it introduces a second user-held secret —
  new-device join stops working with just a password, and the "emergency kit" model is a
  notorious support burden. At most a much-later **opt-in** dial, sequenced after passkeys.
- **The honest limit, accepted.** OPAQUE eliminates passive observation and third-party
  offline cracking — nothing crack-usable transits, and a stolen store alone is not an oracle
  — but a *maximally malicious* operator, holding the server's own OPRF key, can still mount
  an **active** offline guessing campaign against a weak password. Only user-held entropy (a
  passkey, the pepper, the recovery key) removes that entirely. Accepted for the password
  door, mitigated by the 12-character floor and by the Argon2id cost
  ([`../../packages/crypto/README.md`](../../packages/crypto/README.md) → *Pinned
  algorithms*); users wanting stronger custody get it via the passkey door when it ships.
