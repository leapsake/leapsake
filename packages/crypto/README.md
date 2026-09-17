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

These are recorded as named constants in the source, each carrying a versioned
`alg` id so the primitive can change later without locking out existing
accounts or rows. Why each one holds the model's properties is the section after
next.

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

### The test cost

Under Vitest, and only there, `setKdfParamsForTests` lowers Argon2id to m = 64 KiB
/ t = 1 from `vitest.setup.ts` at the repo root. Account and custody suites derive
keys hundreds of times; at production cost they were the longest files in the run
by an order of magnitude, and every second of that was proving the primitive is
slow rather than proving anything about our code.

The override is a module-level parameter set rather than an argument threaded
through the nine call sites, for the reason `packages/flags` gives: launch
configuration read at the leaves does not belong in every signature. It throws
unless `process.env.VITEST` is set, so a shipped build cannot reach it whatever
calls it — a test in `test/kdf.test.ts` holds that. `KDF_ALG` is unchanged for
Vitest deliberately: these doors never outlive the process and are never opened by
production code, so no cheap-recipe account can be mistaken for a real one. E2E
still derives at full cost; lowering that too would need its own `alg` id, because
those doors are written to a real database file.

## Why these hold the model's properties

The design review that pinned the table above (2026-07-05, before the password door
was written) argued each choice against what the model promises. The arguments are
here because they are the reason a future change is safe or unsafe — not history.

- **The password never derives MK.** It derives a **KEK**, which only *wraps* the
  master key. So changing a password re-wraps MK and re-encrypts **nothing**, and MK
  can have several independent unlock doors — enclave, password, recovery — each just
  one more `key_wrap` row. Any change that makes MK a function of the password
  forfeits this, and with it every future door.
- **Two independent values from one password.** A single expensive Argon2id pass
  yields a 32-byte seed; HKDF-SHA256 expands it into two **independent** 32-byte
  outputs under domain-separated `info` labels (`leapsake:kek:v1`,
  `leapsake:auth:v1`). Because HKDF outputs are independent, holding the auth
  verifier reveals **nothing** about the KEK — which is exactly what lets a blind
  relay authenticate a device it can never decrypt for. Keep the labels distinct and
  keep the split; collapsing them would hand the relay a KEK oracle.
- **A stored verifier is not a password oracle.** The relay persists only
  `SHA-256(verifier)` and compares constant-time. A fast hash is sufficient *because
  the verifier is already a high-entropy Argon2id→HKDF output*, not a low-entropy
  password — so a relay DB leak yields nothing cheap to grind. (What a *live* relay
  can do is a different and harsher question — threat H1 in
  [`apps/server/README.md`](../../apps/server/README.md).)
- **AEAD failure is closed.** XChaCha20-Poly1305 authenticates on open, so a wrong
  KEK or recovery key, or any tampered byte, **throws** rather than returning
  garbage. `unlockWithRecoveryKey` leans on exactly this: the unwrap failing *is* the
  wrong-key signal. A wrong password is caught earlier still, as a verifier mismatch
  before any unwrap is attempted.
- **Nonce safety by size, not bookkeeping.** 24-byte random nonces (XChaCha) make
  accidental reuse negligible, so callers seal and wrap freely without tracking a
  counter. This is why the AEAD choice is XChaCha rather than ChaCha20-Poly1305.
- **Argon2id, not Argon2i or 2d** — the hybrid gives both side-channel and GPU
  resistance.

## Accepted limits

- **Lost password + lost recovery key = unrecoverable data.** By design
  (`plans/encryption/model.md` §6). Server-side escrow exists only as a future opt-in
  dial for people who want it.
- **Password strength is the encryption strength** — floored, not solved. A 12-character
  minimum with length-over-complexity guidance (`MIN_PASSWORD_LENGTH`, per NIST) plus
  Argon2id stretching, with the recovery key as the genuine backstop and a UI that says
  plainly there is no reset. A user may still choose something long and weak; accepted.
- **The asymmetric scheme (X25519/Ed25519) is deferred to Stage 3** and is not in this
  package. Nothing in the symmetric Stage-1 core needs it.
- **Not externally audited.** The review behind this section is an *internal design
  audit*; it unblocked development rather than certifying it. A third-party
  cryptographic audit is still worth commissioning before a public, at-scale launch.
