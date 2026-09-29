# @leapsake/bytes

The low-level codecs — bytes ↔ string, and the content-addressed id derived from
them. Pure JS on every target (no `Buffer`, no `btoa`/`atob`, no `TextEncoder`), so
identical code runs on Node/Electron and on React Native's Hermes. Depends on
`@noble/*` and `@scure/base` only; no workspace dependencies, so it sits beside
`schema` at the base of the graph.

The base64 and hex codecs are `@scure/base`'s, not our own. It is the same audited
family as `@noble/*`, it is pure JS on Hermes, and it was already installed as
`@scure/bip39`'s dependency, so declaring it added nothing to the tree. Its decoders
are strict (canonical padding, no whitespace), which everything this package ever
encoded already is. `test/base64.test.ts` pins the exact encoded output, so a later
codec swap cannot change a stored format unnoticed.

## Surface

- `bytesToBase64` / `base64ToBytes` — ciphertext and secrets as compact strings
  (relay wire payloads, `keystore.json` values, `expo-secure-store` values).
- `bytesToHex` / `hexToBytes` — storage keys restricted to `[A-Za-z0-9._-]`
  (`expo-secure-store` rejects the `:` in `payload:<uuid>`).
- `utf8ToBytes` / `bytesToUtf8` — re-exported from `@noble/ciphers`, pure-JS so
  there is no reliance on a global `TextEncoder`/`TextDecoder`.
- `deterministicUuid(namespace, name)` — a stable v5-shaped UUID from
  `sha256(namespace ‖ ":" ‖ name)`, so two devices that independently mint "the
  same" content-addressed row produce the same `id` and the existing whole-row LWW
  merge collapses them. It stamps the v5 version and RFC 4122 variant bits on a
  SHA-256 digest, so it validates as a UUID (`z.uuid()`) but is not what a strict
  RFC v5 generator, which uses SHA-1, would produce. It only needs to be ours.

## Why this is a package, not a `utils` grab-bag

The membership rule is a **security boundary**, not a taxonomy: everything here is
a codec over _non-secret_ data. Nothing touches key material, so nothing here
needs the scrutiny [`@leapsake/crypto`](../crypto/README.md) does.

That distinction was previously unreadable. These helpers lived in `crypto`, so
`@leapsake/reminders` — which only ever wanted a deterministic id — declared a
dependency on the security package, and "which code handles secrets?" could not be
answered from the dependency graph. Splitting them out makes it answerable:
**depend on `crypto` only if you handle keys or ciphertext.** `reminders` now
depends on neither `crypto` nor anything that pulls it in, and `apps/server`
carries `crypto` as a devDependency only.

If something arrives that is pure and portable but is _not_ a codec over non-secret
bytes, it does not belong here — that is the line that keeps this from becoming a
junk drawer.

## What deliberately stays in `crypto`

`equalBytes`. It looks like a byte utility, but its whole reason to exist is
comparing an auth verifier without leaking timing (`key-custody/src/session.ts`),
which makes it a security primitive whose call sites deserve review.
