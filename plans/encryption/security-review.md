# Leapsake Encryption — Security Review of the Key Hierarchy

> **What this doc is.** The recorded design review that gates writing the
> password-door crypto (`model.md` §4 / §9.3). Everything before this point was
> **AEAD-only** (XChaCha20-Poly1305 seal/wrap, no KDF, no asymmetric); the
> password door is the first code to derive a key from a human secret, so the
> primitives and parameters are reviewed and **pinned here** before the code
> ships. For build status see [`status.md`](../status.md).
>
> **Scope & honesty.** This is an *internal design audit* — it fixes the
> algorithms, parameters, and constructions and argues they meet the model's
> stated properties. It is **not** a third-party cryptographic audit. An external
> review is still worth commissioning before a public, at-scale launch; this
> review is what unblocks Stage-1 development, not what certifies it.

## 1. Decisions (pinned)

The chosen algorithms and parameters are recorded as named constants in the code
and tabulated in **[`packages/crypto/README.md`](../../packages/crypto/README.md)**
(the code reference). In brief: XChaCha20-Poly1305 AEAD for seal/wrap; Argon2id
(m = 19 MiB / t = 2 / p = 1) → HKDF-SHA256 split into an independent KEK + auth
verifier; 16-byte public salt; a 32-byte recovery key shown once. Implemented over
audited pure-JS `@noble/ciphers` + `@noble/hashes`.

Two pinned decisions specific to *this* review, not the package surface:

- **Relay auth credential** — the §9.3 **`authVerifier`** as a bearer token over
  (assumed-TLS) HTTPS; the relay stores only **SHA-256(verifier)**, compared
  **constant-time** (`apps/server/src/relay.ts`,
  `packages/data/src/http-sync-transport.ts`).
- **Asymmetric (X25519/Ed25519)** — **deferred to Stage 3**; not needed by the
  symmetric Stage-1 core (`model.md` §4, `status.md`).

## 2. Why these hold the model's properties

- **Never derive MK from the password (`model.md` §4).** The password derives a
  **KEK**, which only *wraps* the master key. Changing the password re-wraps MK
  under a new KEK and re-encrypts nothing; MK has multiple independent unlock
  doors (enclave / password / recovery), each just another `key_wrap` row.

- **The §9.3 two-values-from-one-password split.** A single expensive Argon2id
  pass produces a 32-byte seed; HKDF-SHA256 then expands it into two
  **independent** 32-byte outputs under domain-separated `info` labels
  (`leapsake:kek:v1`, `leapsake:auth:v1`). The **`authVerifier`** is what the
  server stores to authenticate login; because HKDF outputs are independent,
  holding the verifier yields **no information about the KEK**, so a blind relay
  can authenticate a device without ever being able to unwrap MK. The verifier is
  compared **constant-time** (`equalBytes`).

- **The blind relay's authentication.** The relay (`sync.md` §2) authenticates a
  device with the **`authVerifier`** as a bearer credential — the same value the
  §9.3 split already designates as server-stored. Two properties keep this sound:
  (1) because the verifier is HKDF-independent of the KEK, the relay can
  authenticate without holding anything that helps unwrap MK — it stays **blind**;
  (2) the relay persists only **SHA-256(verifier)**, never the verifier, so a relay
  DB leak is not a usable credential and — because the verifier is *already* a
  high-entropy Argon2id→HKDF output, not a low-entropy password — a fast hash is
  sufficient and the leak is **not** a cheap password-guessing oracle. The compare
  is **constant-time** (`crypto.timingSafeEqual`), and a device's records are
  namespaced by the **authenticated** account id, never one supplied in the request
  body — so a device can only ever reach its own namespace.

- **Argon2id parameters.** m = 19 MiB / t = 2 / p = 1 is the OWASP interactive
  minimum — chosen so the pure-JS implementation stays acceptable on mobile
  (Hermes) while resisting GPU/ASIC cracking of the password. Argon2**id**
  (hybrid) gives both side-channel and GPU resistance. Parameters are **named
  constants recorded under `KDF_ALG`**, so raising cost later is a new alg
  revision, not a reshape — existing accounts keep deriving under the id they
  were created with (the same per-row-`alg` posture the wrap layer already uses).

- **AEAD failure is closed.** XChaCha20-Poly1305 authenticates on open; a wrong
  KEK/recovery key or any tampered byte throws rather than returning garbage —
  which is what lets `unlockWithRecoveryKey` rely on the unwrap failing for a
  wrong key, and what makes a wrong password a verifier mismatch *before* any
  unwrap is attempted.

- **Nonce safety.** 24-byte random nonces (XChaCha) make accidental reuse
  negligible, so callers seal/wrap freely without tracking a counter.

## 3. Residual risks accepted (consistent with `model.md` §12)

- **Lost password + lost recovery key = unrecoverable data** at Tier 2. By design
  (`model.md` §6); Tier-1 server escrow is the opt-in Stage-2 mitigation.
- **The server transiently sees the password on no-JS SSR login** (`model.md`
  §9.3) — a Stage-4 concern, not reachable by the Stage-1 native clients, which
  derive locally and send only the verifier.
- **Metadata is not hidden** (record counts, sync timing, who-shares-with-whom) —
  explicitly out of scope for V3 (`model.md` §12).
- **Username enumeration — accepted & mitigated, not eliminated.** The launch join
  scheme is **username + password** (decided 2026-06-20; rationale in `status.md`).
  A username rendezvous is inherently an existence oracle: the unauthenticated
  `GET /accounts/lookup` (prelogin must hand back the public salt) and the
  registration 409 both reveal whether a username is taken. This is intrinsic to
  user-chosen handles and to zero-knowledge password login (you need the salt
  before you can authenticate); it cannot be removed without dropping usernames
  (the deferred high-entropy-code door) or adopting an aPAKE (OPAQUE). **Mitigation
  (built):** per-IP **rate limiting** on the two unauthenticated endpoints
  (`apps/server/src/relay.ts`, `RateLimit`; env-tunable) — and on the
  recovery-authed endpoints (`/accounts/reset`, `/accounts/recovery`) under a
  separate, stricter per-IP budget applied before the verifier check. Residual: a
  single-node in-memory limiter — a multi-node / reverse-proxied relay needs a
  shared counter and `X-Forwarded-For` awareness (the limiter otherwise sees the
  proxy IP).
- **Password strength is the encryption strength — floored, not solved.** The
  password derives the KEK, so a weak password weakens the at-rest protection and,
  on a relay-store leak, the offline-attack cost — with no server-side reset to
  compensate. **Controls (built):** a **12-character minimum** + passphrase
  guidance (`MIN_PASSWORD_LENGTH`, length-over-complexity per NIST) and Argon2id
  stretching; the **recovery key** is the genuine backstop and the UI states
  plainly that there is **no password reset**. Residual: a user may still choose a
  weak-but-long password — accepted (the high-entropy-code door is the future
  stronger option).
- **Relay auth hardening deferred.** The bearer verifier is replayable by a
  network MITM if TLS is stripped, and the relay has no per-device (only
  per-account) credential. Acceptable for this internal slice — TLS termination, a
  challenge–response handshake to defeat replay, device-scoped tokens, and
  proxy-aware client-IP handling for the rate limiter are the named follow-ups
  (`status.md`), to land before a public, at-scale relay.
- **Not yet externally audited** — see the scope note above.
