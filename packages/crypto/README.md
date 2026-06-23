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
- byte/string/base64/hex codecs + constant-time `equalBytes` (`base64.ts`,
  re-exports).

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

> **Scope.** The asymmetric scheme (X25519/Ed25519 for authenticated sharing) is
> deferred to encryption **Stage 3** and is not in this package yet. The
> `security-review.md` audit is an _internal design review_, not a third-party
> cryptographic audit — an external review is still worth commissioning before a
> public, at-scale launch.
