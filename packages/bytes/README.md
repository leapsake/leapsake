# @leapsake/bytes

The low-level codecs — bytes ↔ string, and the content-addressed id derived from
them. Pure JS on every target (no `Buffer`, no `btoa`/`atob`, no `TextEncoder`), so
identical code runs on Node/Electron and on React Native's Hermes. Depends on
`@noble/*` only; no workspace dependencies, so it sits beside `schema` at the base
of the graph.

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
  merge collapses them.

## Why this is a package, not a `utils` grab-bag

The membership rule is a **security boundary**, not a taxonomy: everything here is
a codec over *non-secret* data. Nothing touches key material, so nothing here
needs the scrutiny [`@leapsake/crypto`](../crypto/README.md) does.

That distinction was previously unreadable. These helpers lived in `crypto`, so
`@leapsake/reminders` — which only ever wanted a deterministic id — declared a
dependency on the security package, and "which code handles secrets?" could not be
answered from the dependency graph. Splitting them out makes it answerable:
**depend on `crypto` only if you handle keys or ciphertext.** `reminders` now
depends on neither `crypto` nor anything that pulls it in, and `apps/server`
carries `crypto` as a devDependency only.

If something arrives that is pure and portable but is *not* a codec over non-secret
bytes, it does not belong here — that is the line that keeps this from becoming a
junk drawer.

## What deliberately stays in `crypto`

`equalBytes`. It looks like a byte utility, but its whole reason to exist is
comparing an auth verifier without leaking timing (`core/src/key-session.ts`),
which makes it a security primitive whose call sites deserve review.
