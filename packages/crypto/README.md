# @leapsake/crypto

The client-agnostic cryptographic primitives behind Leapsake's V3 zero-knowledge
sync (the envelope-encryption model in
[`plans/encryption/model.md`](../../plans/encryption/model.md)). Pure-JS over the
audited `@noble/ciphers` + `@noble/hashes`, so every primitive runs **identically
on Node, Electron, and React Native (Hermes)** — no native module, no per-platform
fork.

The package owns only the math. _Where_ keys live is the `KeyStore` port (its
platform adapters are in the apps); _how_ keys are wrapped for which principal is
modeled in `packages/data`/`packages/core`. This package never persists anything.

## Surface

- `seal` / `open`, `wrapKey` / `unwrapKey` (`wrap.ts`) — XChaCha20-Poly1305 AEAD.
- `generateKey`, `generateSalt`, `generateRecoveryKey` (`keys.ts`, `kdf.ts`).
- `deriveKeyMaterial(password, salt)` (`kdf.ts`) — the password door: one
  Argon2id pass → HKDF-SHA256 split into an independent **KEK** and **auth
  verifier**.
- `KeyStore` port + in-memory adapter (`keystore.ts`).
- constant-time `equalBytes` (re-export) — the one byte helper that stays here,
  because it exists to compare an auth verifier without leaking timing.

The plain codecs (base64/hex/utf-8) and the content-addressed `deterministicUuid`
live in [`@leapsake/bytes`](../bytes/README.md). They handle no key material, so
keeping them here made packages that only wanted an id — `@leapsake/reminders`
did — declare a dependency on the security package. The rule now: **depend on
`crypto` only if you handle keys or ciphertext.**

## Pinned algorithms & parameters

These are recorded as named constants in the source (each carries a versioned
`alg` id so the primitive can change later without locking out existing
accounts/rows). The design audit that fixed them — and the rationale for _why_
each holds the model's properties — is
[`plans/encryption/security-review.md`](../../plans/encryption/security-review.md).

| Concern                          | Choice                                                                         | Constant                                                         |
| -------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Symmetric AEAD (seal / key-wrap) | **XChaCha20-Poly1305**, 24-byte random nonce prepended, no AAD                 | `ALG = "xchacha20poly1305.raw@1"` (`wrap.ts`)                    |
| Password KDF                     | **Argon2id**, m = 19 MiB, t = 2, p = 1, 32-byte output                         | `KDF_ALG = "argon2id-hkdf-sha256@1"`, `ARGON2_PARAMS` (`kdf.ts`) |
| KEK / verifier split             | one Argon2id seed → **HKDF-SHA256** expanded twice with distinct `info` labels | `deriveKeyMaterial` (`kdf.ts`)                                   |
| Salt                             | 16 random bytes, public, per account                                           | `SALT_BYTES` (`kdf.ts`)                                          |
| Recovery key                     | 32 random bytes (CSPRNG), shown once, never stored                             | `generateRecoveryKey` (`kdf.ts`)                                 |

Argon2id m = 19 MiB / t = 2 / p = 1 is the OWASP interactive minimum, chosen so
the pure-JS implementation stays acceptable on mobile (Hermes) while resisting
GPU/ASIC cracking.

> ⚠️ **Be honest about what that parameter is holding up.** OWASP's figure is a
> floor for *sub-second interactive login*, where a failed guess costs the
> attacker a round trip. Here the same pass is the **sole stretch protecting
> at-rest and relay confidentiality against a fully offline attacker** who holds
> the salt and an observed verifier — a much harder job, and 19 MiB is cheap to
> attack at scale on GPU/ASIC. The parameter is defensible (pure-JS on Hermes is
> the real constraint) but it is justified by *mobile UX*, not by that adversary.
>
> Raising it is deliberately cheap: `KDF_ALG` is versioned per account, so a bump
> re-derives nothing and locks nobody out. Measure Hermes headroom and take as
> much as mobile tolerates — many RN apps bear 46–64 MiB. This stays load-bearing
> even after OPAQUE, which removes the *passive* observation of a verifier but
> not a malicious operator's active grind ([`plans/v0-2.md`](../../plans/v0-2.md)
> → *Hosted-relay gate*).

> **Scope.** The asymmetric scheme (X25519/Ed25519 for authenticated sharing) is
> deferred to encryption **Stage 3** and is not in this package yet. The
> `security-review.md` audit is an _internal design review_, not a third-party
> cryptographic audit — an external review is still worth commissioning before a
> public, at-scale launch.
