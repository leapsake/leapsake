# Leapsake — Onboarding & Key-Custody Sequence

> **Reference doc — the key lifecycle.** The bridge from [`model.md`](./model.md) to
> [`schema.md`](./schema.md): it walks the lifecycle one step at a time, annotating at
> each step **what key is created, where it is stored, when the user is prompted, and
> where the trust boundary sits.** It introduces no new mechanism — every step is "wrap
> this content key / master key for that principal" (`model.md` §3). For *what is built
> vs. design* and *the next step to build*, see [`status.md`](../status.md) — this doc no
> longer restates build status.
>
> The organizing idea is **incremental custody**: each phase adds only the *minimum*
> new key material over the previous one. A running **Key ledger** after each phase
> shows exactly what now exists and where, so the schema can be read straight off it.

## 0. Vocabulary (the keys in play)

| Key | Type | Created by | Purpose |
|---|---|---|---|
| **Master key (MK)** | symmetric | client, at **account creation** (Phase 0.5) | the root; wraps everything below. Never derived from the password (§4). |
| **Enclave key** | symmetric, OS-held | OS keychain / Secure Enclave | a device's local unlock path for MK; also gates the at-rest DB. |
| **db-key** | symmetric | client, at account creation | the whole-DB at-rest key (§8); read from a sidecar *before* the store opens. |
| **Recovery key (RK)** | symmetric, high-entropy | client, at account creation | an out-of-band unlock path for MK **and** db-key; user-held, never stored by us. |
| **KEK** | symmetric | `Argon2id(password, salt)` | the password unlock path for MK and db-key; **exists from account creation, relay or not.** |
| **Auth verifier** | opaque token | separate derivation from passphrase | what the server stores to authenticate login — reveals nothing about the KEK (§9.3). |
| **Account keypair** | X25519 + Ed25519 | client, at account creation | public key published to a directory; private key (MK-wrapped) unwraps shares sent to you. |
| **Content key (CK)** | symmetric, per item | client, per shareable unit | encrypts one item/blob; wrapped for each principal that may read it. |
| **Principal keypair** | X25519 + Ed25519 | per server integration | a constrained reader (Alexa / CardDAV / hosted link) you wrap *specific* CKs to (§9.2 Scenario 2). |
| **Session key** | symmetric, per login | server, at SSR login | wraps MK for one trusted SSR session; lives split between cookie and store (§9.2 Scenario 1). |

The **invariant** through every phase: the server never holds an *unwrapped* MK at
rest, and never holds the passphrase, KEK, or RK at all.

> **Stage mapping ([`status.md`](../status.md)).** The phases map onto the staged delivery
> plan: **Phases 0–2 and 3a are the Stage-1 zero-knowledge core**; **Phase 3b**
> (authenticated share) and **Phase 4a** (constrained principal) are **Stage 3**;
> **Phase 4b** (SSR session) is **Stage 4**. Whole-DB **at-rest** encryption is
> **Stage 2**. Every phase is written in full below; staging changes only *when* each
> ships, not the mechanism — so the Stage-1 phases create the *minimum* key material
> (symmetric only; no account keypair), and later stages only *add* wrappings.
>
> ⚠️ **Rewritten 2026-07-26 for "encryption follows custody" (model.md §7.2).** The
> pivotal change: **Phase 0 now creates no keys whatsoever**, and everything the old
> Phase 0 did has moved into the new **Phase 0.5 — Create an account**. If you are
> holding an older mental model in which first launch mints a master key, drop it.

---

## Phase 0 — First launch, fresh install ("Already using Leapsake?" → **No**) — *Stage 1*

A single device, no account, no server, no password (§7.1, §7.2). **No key ceremony and
no keys** — straight into the app.

- **Prompt:** one question — "Already using Leapsake?" → **No** → straight into the app.
- **Keys created: none.** Not a master key, not an enclave key, not a db-key, not a
  recovery key. The OS keychain stays empty.
- **Store:** `stores/local/leapsake.db`, **plaintext and queryable** (an *Open* store,
  model.md §7.2). All three encryption layers of §2 are inactive.
- **Trust boundary:** entirely on-device; no server exists in this phase, and nothing
  leaves the machine.

> **Key ledger after Phase 0:** *empty.* No keys anywhere, so there is nothing to lose —
> wiping the OS keychain costs this user nothing, and the file opens on any device it is
> copied to. That is the whole point of the state (model.md §7.2): the protection a
> user-less key would add is small, and the data-loss path it creates is not.

---

## Phase 0.5 — Create an account (the moment custody begins) — *Stage 1*

**The pivotal phase**, and the one that has no analogue in the old sequence. It is
reached from the Home invitation once the user has data worth protecting, or from
Settings whenever they choose. It is **fully local** — no relay, no email, nothing sent.
This single step moves the client from Tier 3 to Tier 2 (model.md §5) and turns on
encryption layers 1 and 3.

- **Prompt:** choose a **username + password**; then the **recovery phrase, shown once**,
  framed as the forgot-password backstop. Copy must promise *access*, not device safety
  (model.md §7.2.1).
- **Keys created (all on-device):**
  - **MK** — random.
  - **Enclave key** — minted in / by the OS keychain; `wrap(MK, enclave)` persisted.
  - **db-key** — the whole-DB at-rest key (§8).
  - **RK** — random, high-entropy; the 24 words encode it.
  - **KEK** = `Argon2id(password, salt)`; plus the **auth verifier**, a *separate*
    derivation (§9.3) — minted now even though no relay exists yet, so binding one later
    adds no new ritual.
- **Wrappings created:** `wrap(MK, enclave)`, `wrap(MK, KEK)`, `wrap(MK, RK)` inside the
  store; and beside the store, the two **db-key sidecars** — `seal(db-key, RK)` and
  `seal(db-key, KEK)`. The sidecars are separate files by necessity: they are read
  *before* the database can be opened.
- **Data migration:** the Open store is converted to a Protected one and the plaintext
  original destroyed (model.md §8.1), then layer-3 fields are sealed.
- **Trust boundary:** still entirely on-device. Nothing has touched a network.

> **Key ledger after Phase 0.5:** MK reachable by enclave, password, or phrase. db-key
> reachable by enclave, password, or phrase. The user now holds two secrets — one chosen,
> one generated — and the OS keychain is no longer a single point of failure.

---

## Phase 1 — Bind the account to a relay (enable sync) — *Stage 1*

The precondition for *any* second device. Because Phase 0.5 already minted the password
door, the recovery key, and the auth verifier, this phase creates **no new key material
at all** — it only publishes what already exists. That is the payoff of converging local
and synced custody.

- **Prompt:** a relay URL, and an explicit consent screen for *what the server will store*
  (ciphertext + wrapped keys + the verifier).
- **Keys created:** none.
- **Stored:**
  - **Server:** the `Argon2id` salt (public), the **auth verifier**, `wrap(MK, KEK)`, and
    the recovery escrow. All ciphertext except salt + verifier.
  - **RK** → *not stored by us* — the user holds it.
- **Trust boundary — the first one that crosses the network.** The server holds a
  *wrapped* MK and a verifier. It **cannot** derive the KEK (Argon2id is one-way; the
  verifier is a different derivation), so it cannot unwrap MK. **Zero-knowledge holds.**
  This is the moment the §9.3 "two values from one password" rule earns its keep, and the
  moment encryption layer 2 (§2) starts doing work.
- **Username collision:** the relay is authoritative over usernames, so a locally-chosen
  one may already be taken (the relay answers `409`). Binding must therefore be able to
  *rename* the account. See `status.md` → Open questions for the unsettled half (telling
  "two accounts that should be merged" apart from "two genuinely different people").

> **Key ledger after Phase 1:** unchanged from 0.5, plus the server's copy of
> `wrap(MK, KEK)` + verifier + salt. Password/KEK/RK/MK never leave the client in the
> clear. (No account public key yet — that's Stage 3.)

---

## Phase 2 — Add a second device ("Already using Leapsake?" → **Yes**) — *Stage 1*

The new device joins the account established in Phase 1. It consumes the password
unlock path; it never needs the RK or the first device's enclave key.

**Its store is created encrypted from byte one** — a joining device knows the account
exists before it writes a row, so it never passes through the Open state (model.md §7.1).

- **Prompt:** sign in (username) + **password**. *(tvOS/low-input variant: device-link by
  QR from the phone instead of typing — §13.)*
- **Flow:**
  1. Device derives the **auth verifier** from the password → authenticates.
  2. Server returns `wrap(MK, KEK)` (ciphertext). *(Stage 3 adds
     `wrap(account_private, MK)` to this return.)*
  3. Device derives **KEK** locally, unwraps **MK** into memory. *(Stage 3 adds:
     unwraps the account private key too.)*
  4. Device mints its **own enclave key**, adds `wrap(MK, device-2 enclave key)`, and
     caches the unlock so the passphrase isn't re-typed each launch (§6).
- **Keys created (device-local):** device-2 enclave key; device-2 at-rest DB key.
- **Stored:** device-2 keychain holds its enclave key + `wrap(MK, device-2 enclave)`.
  Server state is unchanged except for a new device registration record.
- **Trust boundary:** passphrase and KEK exist only in **device-2 memory**; the server
  brokered ciphertext only. Each device has an independent local enclave path to the
  *same* MK — exactly the §4 "multiple independent unlock paths" property.

> **Key ledger after Phase 2:** MK reachable from device-1 enclave, device-2 enclave,
> RK, or KEK. Two devices, one account, server still blind.

---

## Phase 3 — Create a share

Every shareable unit already owns a **CK** (§3); sharing is just *wrapping that CK for
a new reader*. Two flavors; **capability link is the default** (§11). *(3a is **Stage
1**; 3b needs the account keypair + directory, so it is **Stage 3**.)*

**3a — Capability link (zero-knowledge, default). — *Stage 1***
- **Prompt:** "Create link" → choose policy (`expiresAt`, `maxVisits`); capability
  link is pre-selected.
- **Flow:** client uploads the item's **ciphertext blob** + a **share record**
  (policy only). The **CK goes in the URL `#fragment`** — `app/share/<id>#<CK>`.
- **Stored:** server holds ciphertext + policy. The fragment is **never sent to the
  server**; the viewer's client reads it from the URL and decrypts locally.
- **Trust boundary:** **zero-knowledge.** Revocation = server stops serving the blob
  (trusted refusal, not math — §12); the key alone is useless without the blob.

**3b — Authenticated-user share. — *Stage 3***
- **Flow:** fetch the recipient's **public key** from the directory; store
  `wrap(CK, recipient_public)` in the item's wrapped-key bag server-side. Only the
  recipient's private key unwraps it.
- **Trust boundary:** zero-knowledge, but depends on the **public-key directory** and
  a trust model (TOFU vs. verification) — still an open question (status.md).

> **Key ledger after Phase 3:** per-item CKs now carry *extra wrappings* — to a URL
> fragment (3a) and/or to recipients' public keys (3b). MK custody unchanged.

---

## Phase 4 — Grant a constrained principal (SSR session / Alexa / CardDAV / hosted link)

The clients that **can't** do client-side crypto. Two shapes, both deliberate, opt-in
downgrades (§9.2, §13). *(4a is **Stage 3**; 4b is **Stage 4**.)*

**4a — Constrained principal (Alexa, CardDAV, hosted link) — Scenario 2, preferred. — *Stage 3***
- **Prompt:** explicit opt-in with a plain disclosure ("this lets our server read your
  contacts").
- **Flow:** wrap **only the specific CKs** the principal needs under its **dedicated
  principal public key** — *never the MK*. Store those `wrap(CK, principal_public)`
  server-side.
- **Trust boundary:** blast radius = exactly those items, forever-scoped, **revocable
  by deleting that wrapped-key set**. The MK is never exposed. Same primitive as
  sharing with a friend (Phase 3b) — the server is just another recipient.

**4b — Trusted SSR session — Scenario 1, heavier. — *Stage 4***
- **Flow:** at login the server mints a **session key**, stores `wrap(MK, session
  key)` server-side, and puts the session key in an `httpOnly, Secure` cookie. Each
  request the cookie brings the session key, the server unwraps MK into
  **request-scoped memory**, renders, then zeroizes. Short TTL + re-auth for sensitive
  actions.
- **Trust boundary:** the server *can* read everything for the life of a request —
  the strongest downgrade here, time-boxed and split (a stolen store is useless
  without the cookie and vice-versa). Reserved for the no-JS accessibility floor (§10);
  JS upgrades the same session back to client-side zero-knowledge.

> **Key ledger after Phase 4:** unchanged MK custody for 4a (only selected CKs wrapped
> to a principal keypair); for 4b, a transient `wrap(MK, session key)` exists only
> while a session is live.

---

## What this unlocks (the handoff to schema)

Reading down the per-phase **Key ledger**, the schema falls out as a small set of
tables — all "ciphertext + a bag of wrapped keys," exactly §3:

- a **wrapped-MK store** (one row per unlock path: enclave / RK / KEK / session) —
  Phases 0–2, 4b;
- an **account/identity** table (published public key, salt, auth verifier) — Phase 1;
- a **device registration** table — Phase 2;
- a **per-item content-key / wrapped-key-bag** table (wrappings to MK, recipients,
  fragments, principals) — Phases 3–4;
- a **share/access-policy** table (`expiresAt`, `maxVisits`, `allowedUserIds`,
  revocation) — Phase 3–4.

…plus, from Phase 0.5, an **on-device account roster** that is *not* a table at all — it
lives outside every store, unencrypted, because it must be readable before any store can
be opened (model.md §7.4).

Open questions this sequence does **not** resolve, deferred to design time per status.md:
the **public-key directory** trust model (Phase 3b), **Tier 1** server-escrow as an extra
MK wrapping (a variant of Phase 1), and **username reconciliation** when a locally-chosen
username collides on a relay (Phase 1).
