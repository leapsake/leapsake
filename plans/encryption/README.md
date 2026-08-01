# Leapsake Encryption, Privacy & Sync — design docs

This folder holds the **design** for how Leapsake protects, shares, and syncs user data — the
stable "why" — plus **this workstream's own backlog** (*What remains*, below). What is already
built is in `git log` and in the doc-comments of the code; what is being worked on *right now*
is the only thing [`../status.md`](../status.md) tracks.

> **Four docs, four questions.** Consolidated 2026-07-27 from six — `custody-sequence.md`
> folded into `model.md` §7.5 (it had become the same story told twice) and
> `local-custody-options.md` retired once its decision was made. If you find yourself
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
| [`schema.md`](./schema.md) | The concrete key tables (`content_key`, `key_wrap`, `account`, `device`, `share`). Reference. | When touching the schema or the `packages/data` repos. |
| [`sync.md`](./sync.md) | The `SyncTransport` transport seam, the merge model, the account-bootstrap channel + the join-scheme decision, and the **P2P-is-a-deferred-adapter** decision. | When building sync, the relay, or evaluating P2P. |
| [`prune.md`](./prune.md) | ⚠️ **Exploratory, nothing decided.** Relay retention: why the append log never shrinks, why minimum-cursor pruning corrupts joining devices, and the LWW-licensed compaction that needs no device tracking. | When thinking about relay storage cost, retention, or backup — and only ever as a proposal. |
| [`security-review.md`](./security-review.md) | The recorded design review of the key hierarchy and relay auth: how the constructions hold the model's properties + the residual risks accepted. Pinned params live in [`packages/crypto/README.md`](../../packages/crypto/README.md). | When touching the KDF / password door, or before an external audit. |
| [`security-findings.md`](./security-findings.md) | The adversarial "poke holes" review of the *shipped* code + relay: a severity-ranked backlog of concrete attacks (offline crack oracle, unthrottled login, convergence DoS) with mitigations. | Before hardening the relay / KDF, or picking up a security fix. |

> **Custody is [`model.md`](./model.md) §7, and only there** — §7.2 the states, §7.2.1 the
> act that turns encryption on, §7.3 Locked / Sign out / Forget account, §7.4 one store per
> account, §7.5 the key lifecycle, plus §8.1 for converting a store. Nothing in this folder
> or anywhere else restates it; if you are about to, edit §7 instead.

## The one rule that keeps these from drifting

**The six docs above are design; unbuilt work lives in *What remains* below and nowhere else.**
When a slice lands, delete its entry here — its delivery detail belongs in `git log` and in the
doc-comments of the code it touched, not in a doc that then has to be maintained. Never restate
"what's done" or "which stage" in `model.md`/`sync.md`/`schema.md`; they are meant to read the
same whether a thing shipped yesterday or ships next year.

## What remains

**Stages 1–2 (zero-knowledge sync, at-rest) are done** and verified over the wire and on disk;
**custody is finished** on both clients; relay hardening is complete through H3. Stages 3–4
(sharing, SSR web) are post-launch by decision.

### Pre-v0.1 — interleavable, none of it blocking

- **Shared cross-process rate-limit counter.** Today's limiters *and* the session store are
  in-memory and per-process; a multi-node relay collapses them. One shared follow-up.
- **vCard/JSContact export** (import comes later, with the bulk importer). The portability /
  exit-strategy answer: user-initiated, client-side (the client already holds plaintext),
  people + contact methods first. Cheap, and it doubles as groundwork for the future CardDAV
  surface and the importer increment. **It also unblocks a promise already made:**
  [`model.md`](./model.md) §7.3.1 says Forget-account should offer an export first, and today
  desktop's hard-confirm can only tell the user to copy their `stores` folder — honest but poor
  — while mobile cannot say even that (no user-reachable filesystem). Wire the real offer when
  the exporter lands.
- **Relay disposability** ([`sync.md`](./sync.md) §2): losing `relay.db` must never lose user
  data. Content already lives on devices; close the gap by having devices **self-heal the
  account row + recovery escrow** on sync, so a relay wipe costs one re-join at most.
  > The relay store's `ALTER TABLE` try/catch migration pattern (`apps/server/src/store.ts`) is
  > fine for single-node SQLite; revisit only if that store ever moves backends.
- **CK revocation / GC on entity delete** — sync-era cleanup that stops orphaned keys.
- **True background-fetch sync**, plus a configurable sync-interval UI.
- **Cleanup:** `createCore(driver, keySession?)` no longer reads its key session —
  `milestone.note` was layer 3's only consumer and was retired with migration 27. The parameter
  and the clients' "rebuild the core around the adopted MK" plumbing are inert, and on desktop
  the rebuild is redundant as well, since the store swap re-opens and rebuilds core anyway.
  Left in place on purpose (photos are layer 3's real consumer — [`../files.md`](../files.md)),
  so **simplify it whenever layer 3 next gets attention.**

> **Restore-from-file-backup** is tracked as [`../launch.md`](../launch.md) Increment 3, not
> here — it is a launch gate, and both doors are already proved on desktop against a wiped
> keychain. What remains there is the same exercise on a *fresh machine*, plus writing it up.

### Explicitly v0.2, not v0.1 *(owner, 2026-07-27)*

**Automatic locking on idle, and the bounded session.** The deliberate half (sign out) is
already cheap and built. A real session needs mid-session re-lock in the desktop main process
and in mobile's bootstrap, and it must not be theater, since the keychain still holds the
db-key. Not a one-way door — it sits on the same password door.

### Post-launch (after the web app)

- **Web app — Stage 4** (SSR split-session rendering + PWA; [`model.md`](./model.md) §10): the
  no-JS accessibility floor, and the gate for all URL-based sharing. Framework still open
  (Remix / Next.js / React Router). **Low retrofit risk** — the KEK layer makes the SSR
  session-key door additive, the auth-verifier split it needs is already built, and web is just
  another `core` consumer behind existing ports.
- **Capability-link sharing** ([`model.md`](./model.md) §11): zero-knowledge public links (key
  in the `#fragment`, no `key_wrap` row). Needs the web app as render vehicle **and** the
  share-URL decision below.
- **Stage 3 — authenticated sharing**: account keypair + public-key directory (TOFU-vs-verify
  trust) + constrained principals (hosted links, Alexa, CardDAV). Kept entirely post-web. Needs
  an **external** crypto audit before public ship.
- **Hosted-relay gate** — before any official or paid relay stores other people's data:
  **OPAQUE** login (the H1 decision, [`sync.md`](./sync.md) §4), Tier-1 server-escrow recovery
  (email/password reset as an opt-in dial, [`model.md`](./model.md) §5–6), quotas /
  registration-token enforcement, and the shared rate-limit counter above.
- **Custody doors, in preference order** *(decided 2026-07-05, [`sync.md`](./sync.md) §4)*:
  **passkeys (WebAuthn PRF)** as an additional unlock door — supported, *not* the default (not
  yet universal enough). A 1Password-style **Secret Key is deliberately not planned as a
  default** — at most a much-later opt-in hardening after passkeys. Also the high-entropy
  sync-code / QR-pairing door, and username reconciliation across relays.
- **Device management** — per-device revocation and a master-key rotation mechanism (the
  lost-phone story). Grows in importance with photos (v0.2), so track it before then.

## Open questions

**Custody** — the build is finished, but these are not decided:

- **Username collision when a local account binds a relay.** A locally-chosen username may
  already exist on the relay, which answers `409`. Two cases hide behind that one error and
  want different UX: *"this is me, I made a second account by accident and want them merged"*
  vs. *"different person, I just need a different handle."* Renaming is the easy half and
  should ship with relay binding. Merging is the hard half — but note the machinery partly
  exists (`reconcileOnJoin` surfaces overlapping people after a join and deliberately does
  **not** auto-merge, leaving it to the duplicate-review surface), so *"join the existing
  account and review the duplicates"* may be the whole answer for v0.1. **Decide before relay
  binding ships.** Weightier since 2026-07-29: a local-only account is now one tap away on
  *both* clients, so the population that could later want to bind one is no longer
  desktop-only — while binding itself remains unbuilt on either client.
- **Relay backup capability** — the protocol shape for a relay advertising whether it keeps a
  durable copy ([`model.md`](./model.md) §7.3.1). The **client half is built**
  (`fetchRelayCapabilities`, `@leapsake/sync`): it GETs `/capabilities`, reads a literal
  `durableBackup: true`, and falls back to "no" on anything else. Undecided is the **server**
  side — the endpoint's shape, whether it carries more than one field, and whether it is
  authenticated — so no relay serves it and every user currently sees the last-device deletion
  warning. That default is the safe one, so it does not block v0.1.
- *(Deferred with automatic locking, v0.2)* **session lifetime and its dial**; **biometrics on
  mobile** as the everyday unlock, with a true expiry still demanding the password; and
  **auto-purge of an idle logged-in device**.

**Encryption** — each tied to a not-yet-started stage:

- **Asymmetric scheme** (X25519/Ed25519) — reviewed when **Stage 3** needs it. Plus an
  **external** crypto audit before public ship; the recorded review is an internal design audit.
- **Public-key directory trust model** (TOFU vs. verification) — **Stage 3**.
- **Web framework** — must support both SSR (no-JS) and a client-side decryption path in one
  app ([`model.md`](./model.md) §10) — **Stage 4**.
- **Share-URL formation** — how the official/paid instance and self-hosted instances at
  arbitrary domains form and resolve share URLs, and how account identity / the public-key
  directory reconcile across relays and domains. Blocks **capability-link sharing**; tied to
  the web app + Stage 3.
- **Metadata minimization** — explicitly out of scope for V3. Revisit before privacy-first
  marketing at scale, and again before v0.2: blob sizes and counts reveal more about a photo
  library than text rows do (see [`../files.md`](../files.md)).
- **Confidential-computing enclave for SSR** — the **Stage 4** ceiling; only if server-side
  decryption trust ever needs hardening.

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
