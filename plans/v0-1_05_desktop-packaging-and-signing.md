# v0.1 · 05 — Desktop packaging, signing, and auto-update

> **Delete this doc when the work lands.** The packaging configuration documents itself; the
> native-module constraint below is already recorded beside the code it constrains
> (`scripts/ensure-sqlite-abi.mjs` and [`sqlite-abi-napi.md`](./sqlite-abi-napi.md)).

Three stages of one job: turn `out/` into something a stranger can install and that can fix
itself later. Split into A/B/C because **A is the classic Electron failure** and deserves to fail
on its own, not inside a signing change.

**Prerequisite:** [03](./v0-1_03_store-identity-and-restore.md) for the version and bundle ID.
**B is blocked on Apple enrollment** — start that today (see [`v0-1.md`](./v0-1.md)).

## A — Packaging (unsigned)

**Value:** first real `.app` — a distributable artifact where none exists.

- Add electron-builder (or Forge) producing a macOS `.app` + DMG/zip from `out/`.
- Wire `better-sqlite3-multiple-ciphers` native-module packaging for the Electron ABI. **This is
  where `scripts/ensure-sqlite-abi.mjs` and asar unpacking must agree.**
- Bundle ID `com.leapsake.desktop`; app icon; category; version from 03.

> An N-API fork release would delete this whole constraint — see
> [`sqlite-abi-napi.md`](./sqlite-abi-napi.md). Watch-item, blocked upstream; do not wait for it.

**Acceptance:** `.app` launches on a clean macOS user account, creates its DB, migrates, and
reaches Home. Native SQLite loads from the packaged bundle.

**Risk:** native-module packaging is the classic Electron failure and the reason this is its own
stage rather than a step inside signing.

## B — Signing + notarization

**Value:** an artifact a stranger can actually install. **Blocked on Apple enrollment.**

- Developer ID Application cert; hardened runtime; entitlements.
- Notarization + stapling in the build pipeline.
- **Re-run [06](./v0-1_06_e2e-and-release-gate.md)'s E2E against the signed build.** This is
  where a Team-ID/keychain surprise surfaces, and you want it surfacing here rather than in a
  user's hands — see [`@leapsake/key-custody`](../packages/key-custody/README.md) for why signing
  identity and key custody are coupled.

**Acceptance:** downloaded DMG opens on a clean Mac with no Gatekeeper warning; E2E green against
the signed artifact; `safeStorage` round-trips under the real signature.

## C — Auto-update

**Value:** the ability to ship a fix. **Without it, a v0.1 crypto or data-loss bug strands every
user permanently.**

- `electron-updater` against GitHub Releases as the feed.
- **Simpler once the repo is public** ([07](./v0-1_07_public-repo-and-submission.md)) — no token
  distribution. Either sequence C after 07, or accept a token in the interim. This is open
  decision 3 in [`v0-1.md`](./v0-1.md).

**Acceptance:** an installed older build detects, downloads, and applies a newer release.
