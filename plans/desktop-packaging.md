# Desktop packaging, signing, and auto-update

> **Deferred past v0.1** *(owner, 2026-08-26)* — the desktop app ships in a later release, so
> this is no longer a numbered gating doc and no longer holds a place in the v0.1 order. It
> keeps its detail rather than being folded into [`v0-2.md`](./v0-2.md) because the sequencing
> below (A before B before C) is the whole value, and it is still correct.
>
> **Delete this doc when the work lands.** The packaging configuration documents itself; the
> native-module constraint below is already recorded beside the code it constrains
> (`scripts/ensure-sqlite-abi.mjs`, [`../AGENTS.md`](../AGENTS.md), and [`v0-2.md`](./v0-2.md)).

**Where this plugs in:** `scripts/release/targets/mac.mjs`, a `blocked` stub today. Note what
that target does *not* need — **Xcode is not in this path at all.** The app is Electron, so
packaging is electron-builder and the Apple half is `codesign` → `xcrun notarytool submit
--wait` → `xcrun stapler staple` → `spctl -a -vvv -t exec`, all of which live in the Command
Line Tools. The App Store Connect API key the iOS target already uses authenticates
notarization too, so B below inherits a credential rather than introducing one.

Three stages of one job: turn `out/` into something a stranger can install and that can fix
itself later. Split into A/B/C because **A is the classic Electron failure** and deserves to fail
on its own, not inside a signing change.

**Prerequisite:** [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *Versioning and releases* for the
version and the versioning scheme; the desktop bundle ID (`com.leapsake.desktop`) is set here.

⚠️ **Sequencing: B waits for the company, and that is deliberate** *(owner, 2026-09-06)*. The
Developer ID cert could be issued today — Apple enrollment cleared 2026-08-19 — but it would be
the **personal** one, and [`@leapsake/key-custody`](../packages/key-custody/README.md) →
*The signing identity owns the enclave key* says what that costs: `safeStorage`'s keychain item
has an ACL bound to the app's code signature, so re-signing under the company's Developer ID
later makes every existing enclave key unreadable and drops every authenticated user at the
recovery gate. Doing that to iOS once, at the transfer, is a priced and accepted cost
([`v0-1.md`](./v0-1.md) → *The account sequence*). Doing it to desktop as well, when desktop has
not shipped and therefore has no users to strand, would be paying it for nothing.

**So: A can be built whenever. B signs under the company identity, after the transfer.** That is
also the owner's stated release order — iOS, then Android and macOS, then everything else — so
nothing is being delayed to obey this; it is why the order is right.

## A — Packaging (unsigned)

**Value:** first real `.app` — a distributable artifact where none exists.

- Add electron-builder (or Forge) producing a macOS `.app` + DMG/zip from `out/`.
- Wire `better-sqlite3-multiple-ciphers` native-module packaging for the Electron ABI. **This is
  where `scripts/ensure-sqlite-abi.mjs` and asar unpacking must agree.**
- Bundle ID `com.leapsake.desktop`; app icon; category; version from the release scripts
  ([`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *Versioning and releases*).

> An N-API fork release would delete this whole constraint — see
> [`v0-2.md`](./v0-2.md) → *The N-API exit*. Watch-item, blocked upstream; do not wait for it.

**Acceptance:** `.app` launches on a clean macOS user account, creates its DB, migrates, and
reaches Home. Native SQLite loads from the packaged bundle.

**Risk:** native-module packaging is the classic Electron failure and the reason this is its own
stage rather than a step inside signing.

## B — Signing + notarization

**Value:** an artifact a stranger can actually install. Waits on A, and on the company Developer
ID — see the sequencing warning above; signing this under the personal identity first is the one
mistake here that reaches users.

- Developer ID Application cert **from the company account**; hardened runtime; entitlements.
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
