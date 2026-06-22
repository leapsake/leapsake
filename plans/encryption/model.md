# Leapsake Encryption, Privacy & Sharing — The Model

> **This is the *stable* "why" doc — the conceptual model and the locked decisions.**
> It rarely changes. It is the source of truth for *how* Leapsake protects data and
> shares it, and it feeds the V3 work tracked in [`status.md`](../status.md). The point of
> writing the model first is the same as the sync-safe-from-day-one decision (`AGENTS.md`):
> encryption and key-custody decisions are brutally expensive to reverse, so we decide the
> *model* before we touch
> a row.
>
> **For *when* each part ships and *what is built*, see [`status.md`](../status.md)** —
> the single source of truth for the staged delivery plan, the build log, and the next
> slice. This doc describes the full target; `status.md` says when each piece lands.
> The KEK layer (§4) is what makes that staging cheap: every later capability is *one
> more wrapping of the master key, with no re-encryption of existing data.*
>
> **Companion docs:** [`schema.md`](./schema.md) (the key tables),
> [`custody-sequence.md`](./custody-sequence.md) (the key lifecycle, step by step),
> [`sync.md`](./sync.md) (the transport seam + merge model + the P2P decision). Start
> at [`README.md`](./README.md) if you're new to this folder.

## 1. Goals

- **Offline-first, single-device-complete.** The app works fully on one device with
  **no account, no password, and no sync.** Sync is opt-in; nothing about the
  privacy model may require a server to use Leapsake.
- **Default to the safest practice; let the user choose otherwise.** A core product
  theme: *default to the practices that protect and respect the user, but give them
  control to use their data how they want.* Security is a **configurable dial**, set
  high by default, not a fixed wall.
- **Zero-knowledge by default.** Servers should, by default, store only ciphertext
  they cannot read. The user holds the keys.
- **Modern-SaaS convenience without surrendering privacy.** Arbitrary sharing (a
  contact, a photo album) with others — including unauthenticated users via a URL —
  with revocable, time-/visit-limited, and authenticated-only links. The aim is
  Google-Drive-grade empowerment on top of a zero-knowledge default.

## 2. Two separable problems

These are distinct, have different best solutions and costs, and can ship
independently. Do not conflate them:

1. **Encryption at rest** — the on-device SQLite file is unreadable/unqueryable
   without a client-held key.
2. **Zero-knowledge sync & sharing** — the server (and anyone in transit) only ever
   sees ciphertext it cannot decrypt.

(2) is the high-value, hard-to-retrofit privacy property. (1) is mostly about device
theft / other-process access and is the piece that fights our `node:sqlite` choice
(§8).

## 3. The unifying mechanism: per-item keys + key wrapping

The single most important decision. **Do not encrypt everything under one master
key.** Instead:

- **Every shareable unit** (a contact, a photo album, a "share bundle") gets its own
  random **content key**.
- That content key is then **wrapped** (encrypted) under whichever keys should have
  access:
  - wrapped under the owner's **master key** → owner can always read it;
  - wrapped under another user's **public key** → that authenticated person can read
    it;
  - placed in a **URL fragment** → anyone with the link can read it;
  - wrapped under a **server principal's key** → a server-side renderer / Alexa /
    hosted link can read *exactly that item* (§9, §11).

The server stores ciphertext plus a small bag of *wrapped* keys per item. It never
holds an unwrapped key, so it stays zero-knowledge even while brokering sharing. This
is **envelope encryption**, and it is what makes at-rest, sync, sharing, the
multi-client story, and the configurable security dial all the **same** operation:
*wrap this content key for that principal, at the trust level the user chose.*

> **Architectural statement.** Build *one* strong mechanism (per-item content keys +
> a wrapped master key). Expose "security level" and "which client/server can read"
> as **policy over key custody**, not as separate codepaths.

Rejected alternative: **field-level encryption** (encrypt column values, leave schema
plaintext). It breaks `search-service`, indexing, and any `WHERE`/`JOIN` on encrypted
columns — the entire data layer assumes it queries plaintext. So: whole-DB at rest
(§8) + per-item content keys for sync/sharing, **not** field-level.

## 4. The key hierarchy

The load-bearing detail: **never derive the master key directly from the
passphrase.** Insert a key-encryption-key (KEK) layer.

```
passphrase ──Argon2id──► KEK ──┐
recovery key ──────────────────┤
device enclave (cached) ───────┼─►(unwraps)─► MASTER KEY
                               │                  │
[server-held key] ─(optional)──┘                  ├─► wraps ► per-item CONTENT KEYS
                                                  └─► protects ► ACCOUNT KEYPAIR
                                                                   • public key → published to a directory
                                                                   • private key → unwraps shares sent to you
```

Why the indirection matters:

- **Change the passphrase without re-encrypting any data** — just re-wrap the master
  key under a new KEK.
- **Multiple independent unlock paths to the same master key** — passphrase *or*
  recovery key *or* device enclave *or* (optionally) a server-held key. Each is just
  another wrapping. This is the mechanism that makes the security dial (§5),
  recovery (§6), and passkeys-later (§7) all cheap.
- **Per-item content keys are constant** regardless of how the master key is
  protected, so sharing works identically at every security level.

Primitives we expect to use (subject to a security review at design time): Argon2id
for the KDF; XChaCha20-Poly1305 (or AES-256-GCM) for symmetric content/wrapping;
X25519 sealed-box / age-style recipients for asymmetric wrapping to public keys;
Ed25519 for signing. A `packages/crypto` (client-agnostic, portable — beside `core`)
should own these so every client does crypto identically (the same posture as
`schema`/`core`).

## 5. Configurable security — the custody dial

"Configurable security" and "opt out of a password" are the **same dial**: who is
allowed to hold the master key. Recovery convenience and server-readability move
together.

| Tier | Master key custody | Server can read? | Recovery | Enables |
|---|---|---|---|---|
| **2 — Zero-knowledge** (default) | passphrase / recovery / enclave only | **No** | recovery key only (lose passphrase **and** recovery key → data gone) | strongest privacy |
| **1 — Recoverable** | *also* wrapped under a server-held key | **Yes** | email / password reset | "encrypted SaaS" convenience |
| **0 — Open** | server holds key / no envelope | **Yes** | trivial | server-side compute: search, SSR, Alexa |

Dialing down = **adding another wrapping** of the master key (under a server key).
Dialing up = removing it and rotating. Same mechanism; the per-item content-key
architecture stays constant across all tiers.

> **Staging ([`status.md`](../status.md)).** Only **Tier 2** ships in the Stage-1 core. Tier 1 (server
> escrow) and Tier 0 are **Stage 2+** — each is literally "add one more MK wrapping,"
> so deferring them costs nothing and re-encrypts nothing.

**The honest impossibility result.** If the user holds **no secret at all**, then for
data to be usable on a second device or the web, *someone else must hold the key —
and that someone is the server*. So **"no user secret + multi-device +
zero-knowledge" is a contradiction.** The two genuine ways to keep zero-knowledge
without a *typed password*:

1. **Single-device only** — master key in the secure enclave, no password, no server
   holds it. Breaks the moment you want sync/web without transferring a secret.
2. **Passkeys (WebAuthn PRF)** — a passkey derives a symmetric key with no typed
   password, and the *platform* (iCloud Keychain / Google) syncs it across the user's
   devices E2EE. You get "no password, multi-device, app-server still
   zero-knowledge" by outsourcing the cross-device secret to the platform. Trade:
   you trust Apple/Google's keychain sync, and it doesn't cover platforms lacking
   passkeys (Alexa, headless CLI).

The reframe: **"password" really means "a secret the user holds,"** which can be a
passphrase *or* a passkey.

## 6. Recovery

Recovery is the true cost of zero-knowledge: **if only the user can decrypt, a lost
passphrase = unrecoverable data** — no "forgot password" reset (the Proton /
1Password "we genuinely cannot help you" problem). So recovery must be **designed
deliberately**, not bolted on:

- **Recovery key** (default) — a random high-entropy code generated **once at
  onboarding**, shown to the user to store (password manager / paper). It is another
  wrapping of the master key, so a lost passphrase ≠ lost data *if* the recovery key
  was kept.
- **Server-escrow recovery** (opt-in, Tier 1) — wrap a copy of the master key under a
  server-held key so email/password reset works. This is the same act as dialing to
  Tier 1; it trades zero-knowledge for recoverability, with informed consent.
- **Social recovery** (future, possible-not-planned) — split the recovery key via
  Shamir's Secret Sharing among trusted contacts; architecturally it is just another
  wrapping, so the model already allows it.

## 7. Decisions locked in discussion

Each line is a settled decision; the section it points to has the reasoning.

- **Encrypted by default, never plaintext** — even on a single device, where the
  **enclave holds the key and no passphrase is needed** (§5, §6). *(Sequencing: this
  is the **at-rest** property, which lands in **Stage 2** ([`status.md`](../status.md)); the Stage-1 core's
  privacy win is zero-knowledge **sync** (§2), and the local file stays
  plaintext-and-queryable — as today — until Stage 2.)*
- **Single-device is first-class; sync is fully optional** — onboarding must **not**
  force account/passphrase setup. A passphrase is required **only** when the user
  opts into sync / a 2nd device, never just to start using Leapsake. Flow in §7.1.
- **Passphrase is the default** secret for zero-knowledge multi-device — de-facto and
  universally understood. Requiring it for multi-device is **accepted** (impossible
  otherwise — §5).
- **Passkeys are optional, added later** — not the default. The KEK layer (§4) makes
  adding one a non-migrating change (one more wrapping of the master key).
- **Recovery key generated once at onboarding**, at every tier; the enclave caches
  the unlock so the passphrase isn't re-typed each launch (§6).
- **SSR web app is in scope and vital** for accessibility; a heavy-JS SPA must **not**
  be required (§10). Server-side decryption for SSR / Alexa / CardDAV is **accepted**,
  minimizing what the server knows (§9).

### 7.1 First-launch onboarding — the "Already using Leapsake?" branch

One prompt on first launch decides the path. **Encryption is on either way**; the
only question is whether this device joins an existing account (needs the passphrase)
or starts fresh (does not).

| Answer | Means | What happens |
|---|---|---|
| **Yes** | a 2nd+ device | configure **sync** against the existing account → prompt for the **passphrase** (the multi-device secret — §5) |
| **No** | fresh install | **single-device** on this device → straight into the app with the **enclave key**; recovery key shown once (§6); **no passphrase** |

A passphrase is never required to *start* using Leapsake on one device — only to
*sync*.

## 8. Encryption at rest, and the `node:sqlite` tension

> **Stage 2 ([`status.md`](../status.md)) — now in v0.1 launch scope.** At-rest was **not**
> in the Stage-1 core (Stage 1 shipped the high-value sync envelope first, §2); it is the
> **next encryption increment**. **Decided:** at-rest is worth a backend swap — the
> `node:sqlite` preference (chosen to stay native-module-free) **yields** to it. Until it
> ships the local file is plaintext-and-queryable, as today. The shape below is the target.

The right shape is **whole-database encryption** (SQLCipher-style: the file on disk is
ciphertext, the engine decrypts pages into memory as you query, a key is supplied at
open time). This keeps the file unqueryable-until-unlocked **while preserving
everything already built** — search-folding, kinship, timelines all run on in-memory
plaintext, untouched.

The tension: **`node:sqlite` has no encryption support**, and it was adopted (reboot
plan §3 note) specifically to *delete* the native-module ABI dance. Full-DB
encryption reintroduces a native or WASM dependency on **desktop**:

- **SQLCipher binding** — back to a native module on desktop (the thing we escaped).
- **SQLite WASM "multiple-ciphers"** in Electron — avoids the native ABI problem,
  pure-ish, but a perf/architecture change.
- **OS-level** (encrypted container / keychain-gated file) — weakest match to
  "portable + unqueryable," OS-specific.

Mitigations: the `SqliteDriver` port (`AGENTS.md`, [`packages/data`](../../packages/data/README.md)) was explicitly built so the
backend is "a one-adapter swap" — an encrypted backend is the same kind of swap.
**Mobile** is easier: expo-sqlite has a SQLCipher path (verify current SDK-56 state
before relying on it), plausibly a config + key-supply change rather than a new
engine.

At-rest and per-item keys **compose cleanly and are orthogonal**:

- **At-rest:** a whole-DB key (device enclave) protects the local *file*.
- **Sync/sharing:** per-item content keys (wrapped under master / recipient keys)
  live *inside* the decrypted DB and are the E2EE envelope.

## 9. Zero-knowledge sync, and safe server-side decryption

### 9.1 Sync — the server becomes a dumb, blind blob store

"Decrypt only client-side, server has zero read access" is the standard **E2EE**
model (1Password / Signal-style). One consequence to accept up front:

> If the server can't read the data, **the server can't merge it.** Conflict
> resolution must happen entirely on the **client**, after decryption.

This *simplifies* the server to an **ordered, encrypted blob store + transport +
auth**. All CRDT / last-write-wins logic (now decided in [`sync.md`](./sync.md) §4) moves
client-side, which the sync-safe model (UUIDs, soft deletes, timestamps,
`deleted_at`-scoped indexes) already supports.

### 9.2 When the server *does* decrypt — minimize four exposures

The user accepts server-side decryption for the **no-JS SSR web app** and for a
possible future **Alexa**. When a server decrypts, minimize: **how long** it holds
keys, **how much** they unlock, **whether** plaintext/keys ever persist, and **who**
(operator) can see them. Two distinct scenarios:

**Scenario 1 — Trusted SSR session** (authenticated user, full account, no JS). The
server needs the user's key for the session; make the holding thin:

- **Split the session key.** At login, generate a random session key; wrap the master
  key under it; store the *wrapped* master key server-side and put the session key in
  an `httpOnly`, `Secure` cookie. Each request, the cookie brings the session key,
  the server unwraps the master key into **request-scoped memory**, renders, then
  discards. A stolen session store is useless without cookies; a stolen cookie is
  useless without the store — the server holds nothing standing-decryptable at rest.
- **Memory-only, request-scoped, zeroized.** Keys/plaintext never touch disk, logs,
  swap, error traces, or APM. Rendered HTML with plaintext is `Cache-Control:
  private, no-store` — never in a shared cache/CDN.
- **Short session TTL + re-auth** for sensitive actions.
- **Ceiling (later, if ever):** run the decrypting renderer inside a
  **confidential-computing enclave** (AWS Nitro / GCP Confidential VM) so the key and
  plaintext live only in attested memory the operator can't read, with remote
  attestation that only audited code touches the key. Named as the ceiling, **not**
  V3 scope.

**Scenario 2 — Constrained server principal** (Alexa, link previews, hosted shares).
Much stronger: **never give this server the master key.** Wrap *only the specific
item content keys it needs* under a **dedicated server keypair**. Blast radius =
exactly those items, forever-scoped, revocable by deleting that wrapped key. It is the
*same primitive* as sharing with a friend — the constrained server is just another
recipient.

### 9.3 Login secret handling (progressive)

- **No-JS login:** browser POSTs the passphrase; server derives the KEK, unwraps,
  **discards the passphrase** (never stored). Server transiently sees the passphrase —
  the accepted trust cost.
- **JS login:** a *tiny* script derives the KEK in-browser and sends only a
  separately-derived **auth verifier**, never the passphrase or encryption KEK — the
  server *cannot* derive the encryption key.

This relies on the standard split: derive **two** values from the passphrase (one to
authenticate, one to encrypt); the server only ever stores the **auth verifier**,
never anything that reveals the encryption KEK.

### 9.4 CardDAV / CalDAV server (longer-term)

A longer-term goal: expose People (and dated milestones) over a **CardDAV/CalDAV**
endpoint so any device's native Contacts/Calendar app can subscribe — the broadest
possible "use your data anywhere" reach, since those protocols are ubiquitous.

This is accurate to suspect it behaves **like the SSR session and the Alexa
integration**: the protocol clients (Apple Contacts, etc.) cannot do Leapsake's
client-side decryption, so a Leapsake-run CardDAV/CalDAV server must hold keys and
**decrypt server-side** to serve vCards/iCalendar. It is therefore **not
zero-knowledge** for the data it exposes — a deliberate, opt-in downgrade, exactly
the configurable-dial pattern (§5).

It sits between the two §9.2 scenarios and leans toward **Scenario 2 (constrained
principal)**: scope it to **only the contact/calendar slice** by wrapping just those
item content keys to a **dedicated CardDAV server keypair** — never the master key —
so enabling it exposes contacts/dates and nothing else, and revoking is deleting that
wrapped-key set. Because the protocol clients authenticate with their own
credentials (and many only support Basic auth over TLS), treat that endpoint as a
standing trusted reader of a narrow slice, hold decrypted data only per-request in
memory (§9.2), and make the whole feature an explicit opt-in with a clear "this lets
our server read your contacts" disclosure.

## 10. The web app: progressive enhancement *of privacy*

"SSR web app" and "PWA" are **not two apps** with two privacy models. They are **one
app**, where JS is a progressive enhancement that upgrades *privacy*, not just
interactivity:

| Mode | Who decrypts | Privacy | Role |
|---|---|---|---|
| **No-JS SSR** | the render server (trusted, transiently — §9.2) | Tier-1-for-the-session | accessibility floor — always works |
| **JS-enhanced / PWA** | the browser, client-side | zero-knowledge | the upgrade you get for free when JS runs |

The app **fully works with no JS** (the accessibility requirement) and
**automatically becomes zero-knowledge when JS is available**. JS just moves the
decryption boundary from server to client. This resolves the latent contradiction in
the V3 web goal ("server-rendered… no client JS required", [`status.md`](../status.md)) vs.
client-side-only decryption: **encrypted content is client-rendered when JS is present and
server-rendered (trusted) when it is not.** *(The V3 web scope in `status.md` states this
explicitly.)*

## 11. Sharing

Per-item keys + wrapping give four modes from one mechanism:

| Mode | How |
|---|---|
| **Public link (unauthenticated)** | `https://app/share/<id>#<key>` — the `#fragment` is **never sent to the server**; the server returns ciphertext, client JS reads the key from the fragment and decrypts locally. Zero-knowledge (Mega / Bitwarden Send model). |
| **Authenticated-user-only** | Wrap the content key under the recipient's **public key**; only their private key unwraps it. Needs a per-user public-key directory. |
| **Revocable** | The server gatekeeps *delivery of the ciphertext*. Disable the share record → server stops serving the blob → the link dies (the key alone is useless without the blob). |
| **Time- / visit-limited** | A server-side access policy (`expiresAt`, `maxVisits`, `allowedUserIds`); the server refuses to serve once the policy fails. |

**Two flavors of public link** fall out, and the choice should be explicit:

- **Capability link** — key in `#fragment`, client-rendered, **zero-knowledge**.
  *Default.*
- **Hosted link** — server holds the key (wrapped to its own keypair, §9.2 Scenario
  2), **SSR-able**, supports no-JS viewers / link previews / SEO — but the server can
  read it.

Per the product philosophy: **default to capability links; make "hosted link" an
explicit, clearly-labeled opt-in** the sharer chooses when they specifically want
no-JS/preview behavior.

**Photos / large binaries** introduce **blob/object storage** (photos don't belong in
SQLite rows). Same per-item-key model — encrypt each blob with a content key, store
ciphertext in object storage, wrap keys as above. A storage concern, not a
crypto-model change.

## 12. The honest trust boundary & limits

State these explicitly; they are conscious decisions, not gaps:

- **Content confidentiality is cryptographic / zero-knowledge** — the server cannot
  read content (Tier 2).
- **Access policy (expiry, visit counts, revocation) is server-enforced and therefore
  *trusted*** — it is the server honestly refusing to serve, not math. The server is
  an *honest-but-curious blind blob store*.
- **Revocation cannot recall an already-downloaded copy** — same as Google Drive; it
  stops *future* fetches. True forward-revocation needs re-encryption under a new key.
- **Metadata still leaks** to the server: who shares with whom, when, blob sizes,
  record counts, sync timing. Hiding metadata is a much larger project; **out of
  scope** for V3.
- **Lost passphrase + lost recovery key = unrecoverable data** at Tier 2 (§6).

## 13. Clients are "principals you wrap keys to" — the `KeyStore` port

Current clients are desktop + mobile; future considerations: **SSR web, PWA, CLI,
tvOS, Alexa**. (Aware-of, not fully-futureproofed.) Clients differ on two axes — *can
they do client-side crypto* and *where can they store a key safely* — so abstract the
second behind a **`KeyStore` port**, the same move as the `SqliteDriver` port.

| Client | Client-side crypto? | Key storage | Notes |
|---|---|---|---|
| **Desktop / Mobile** | Yes | OS keychain / Secure Enclave (best) | full zero-knowledge; the easy cases |
| **CLI** | Yes | OS keychain or prompted passphrase | power-user friendly |
| **tvOS** | Yes | Secure Enclave | typing a passphrase on a remote is misery → **enroll by QR / device-linking from the phone**, don't prompt |
| **PWA** | Yes (WebCrypto) | weak — IndexedDB, no enclave → **passkey PRF** is the right custody answer | key custody is the whole problem on web |
| **SSR web** | server decrypts | n/a | trusted session / progressive enhancement (§9.2, §10) |
| **Alexa** | **No** — voice→cloud; the "client" is Amazon's server running the skill | server-side | **can't be zero-knowledge**; model as a constrained principal (§9.2 Scenario 2) — wrap only specific item keys to it |
| **CardDAV / CalDAV** | **No** — native Contacts/Calendar apps speak the protocol; a Leapsake server serves vCards/iCalendar | server-side | **can't be zero-knowledge** (§9.4); constrained principal scoped to the contact/calendar slice — wrap only those item keys to a dedicated server keypair |

The payoff: a client that can't do client-side crypto (Alexa) or can't hold keys well
(web without passkeys) is **not a special case** — it is "a principal you wrap
specific item keys to, at the security level the user chose." The mechanism is
uniform; clients differ only in *which keys they may hold and where they store them.*

## 14. Decentralization vs. shareable URLs → a hybrid topology

The deepest tension: **a public URL needs a durable, addressable host**; pure P2P has
none. So "decentralized / offline-first / P2P" and "share a link that opens anywhere"
genuinely diverge. Resolution is a **hybrid**:

- **Personal multi-device sync** → P2P or a dumb relay, fully E2EE.
- **Sharing + web** → a **centralized but blind** server: hosts ciphertext at stable
  URLs, enforces access policy, still cannot read anything.

"Centralized vs. decentralized" stops being binary — the server is centralized for
*availability and policy* and decentralized-grade for *confidentiality*. That is the
Google-Drive-convenience-with-zero-knowledge sweet spot.

> **True P2P is a deferred *adapter*, not a closed door.** Because content is encrypted
> *before* it leaves the device, the transport is untrusted and therefore swappable —
> the blind relay is one adapter behind a `SyncTransport` port; a P2P transport is
> another, addable later without reshaping the model. [`sync.md`](./sync.md) owns that
> seam, the merge-model decision it constrains, and exactly what must *not* be assumed
> (a server-authoritative ordering) to keep the P2P door open.

