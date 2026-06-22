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
| **Master key (MK)** | symmetric | client, once per account | the root; wraps everything below. Never derived from the passphrase (§4). |
| **Enclave key** | symmetric, OS-held | OS keychain / Secure Enclave | a device's local unlock path for MK; also gates the at-rest DB. |
| **Recovery key (RK)** | symmetric, high-entropy | client, once at onboarding | an out-of-band unlock path for MK; user-held, never stored by us. |
| **KEK** | symmetric | `Argon2id(passphrase, salt)` | the passphrase unlock path for MK; **only exists once sync is enabled.** |
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
> **Stage 2** and touches only the *enclave* path. Every phase is written in full
> below; staging changes only *when* each ships, not the mechanism — so the Stage-1
> phases create the *minimum* key material (symmetric only; no account keypair, no
> recovery key until sync), and later stages only *add* wrappings.

---

## Phase 0 — First launch, fresh install ("Already using Leapsake?" → **No**) — *Stage 1*

A single device, no account, no server, no passphrase (§7.1). **No key ceremony at
all** — straight into the app.

- **Prompt:** one question — "Already using Leapsake?" → **No** → straight into the
  app. *No passphrase, and no recovery key shown yet* — until sync exists there is no
  remote copy for a recovery key to restore, so it would protect nothing; it is
  generated at sync-enable (Phase 1) instead.
- **Keys created (all on-device):**
  - **MK** — random.
  - **Enclave key** — minted in / by the OS keychain.
  - *(Deferred to **Stage 2**, [`status.md`](../status.md): the **at-rest DB key**, §8. Until
    then the local file is plaintext-and-queryable, as today; the Stage-1 privacy win
    is zero-knowledge **sync**, not on-disk encryption.)*
- **Stored:**
  - `wrap(MK, enclave key)` → device keychain/app store.
  - **Enclave key** → Secure Enclave / keychain.
- **Trust boundary:** entirely on-device. **No server exists in this phase**; nothing
  leaves the machine. The account keypair, KEK, auth verifier, and recovery key do
  **not** exist yet — each is deferred to the phase (and stage) where it first means
  something.

> **Key ledger after Phase 0:** MK (enclave-wrapped, on one device — a *single* unlock
> door, so losing the device loses the data, which is true with or without a recovery
> key when no backup exists), enclave key (OS). No account, no passphrase, no recovery
> key, no network.

---

## Phase 1 — Enable sync (promote the single device to an account) — *Stage 1*

The precondition for *any* second device. This is the step that first introduces a
passphrase and a server (§5: "a passphrase is required only when you opt into sync"),
**and** the moment the recovery key is finally generated (it now has a remote copy to
restore).

- **Prompt:** choose a **passphrase**; **generate and show the RK once** ("save this;
  it's your way back if you forget the passphrase"); an explicit consent screen for
  *what the server will store* (ciphertext + wrapped keys + the verifier).
- **Keys created:**
  - **RK** — random, high-entropy, displayed once (moved here from Phase 0).
  - **KEK** = `Argon2id(passphrase, salt)` — derived client-side.
  - **Auth verifier** — a *separate* derivation from the passphrase (§9.3 split).
  - *(Deferred to **Stage 3**, [`status.md`](../status.md): the **account keypair** and its
    published public key. They serve sharing *to other people*, not multi-device sync,
    so they wait until authenticated sharing — Phase 3b. The Stage-1 sync core is
    symmetric-only.)*
- **Re-wrapping (no data re-encryption — the point of the KEK layer, §4):**
  - Add `wrap(MK, KEK)` and `wrap(MK, RK)` as *new* unlock paths, alongside the
    existing enclave wrapping.
- **Stored:**
  - **Server:** the `Argon2id` salt (public), the **auth verifier**, and
    `wrap(MK, KEK)`. All ciphertext except salt + verifier.
  - **Client:** `wrap(MK, RK)` on device; plus it can now reach the server.
  - **RK** → *not stored by us* — the user holds it.
- **Trust boundary — the first one that crosses the network.** The server now holds a
  *wrapped* MK and a verifier. It **cannot** derive the KEK (Argon2id is one-way; the
  verifier is a different derivation), so it cannot unwrap MK. **Zero-knowledge holds.**
  This is the moment the §9.3 "two values from one passphrase" rule earns its keep.

> **Key ledger after Phase 1:** MK now has *three* unlock paths (enclave, RK, KEK).
> Server holds `wrap(MK, KEK)` + verifier + salt. Passphrase/KEK/RK/MK never leave the
> client in the clear. (No account public key yet — that's Stage 3.)

---

## Phase 2 — Add a second device ("Already using Leapsake?" → **Yes**) — *Stage 1*

The new device joins the account established in Phase 1. It consumes the passphrase
unlock path; it never needs the RK or the first device's enclave key.

- **Prompt:** sign in (account id / email) + **passphrase**. *(tvOS/low-input
  variant: device-link by QR from the phone instead of typing — §13.)*
- **Flow:**
  1. Device derives the **auth verifier** from the passphrase → authenticates.
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

Open questions this sequence does **not** resolve, deferred to design time per status.md:
the **public-key directory** trust model (Phase 3b), **Tier 1** server-escrow as an
extra MK wrapping (a variant of Phase 1), and the **at-rest engine** choice on desktop
(orthogonal to this whole sequence — it only ever touches the *enclave* path, §8).
