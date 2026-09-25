# Desktop packaging, signing, and auto-update

> **Deferred past v0.1**: the desktop app ships after the iOS record has moved to the company
> ([`shipping.md`](./shipping.md) → Part 2). This keeps its detail rather than being folded into
> [`v0-2.md`](./v0-2.md) because the sequencing below (A before B before C) is the whole value.
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

**Two settled choices this whole doc rests on**, recorded here because they are what A/B/C are
shaped around:

- **Direct download, notarized — not the Mac App Store.** No review latency on a desktop
  release, auto-update stays ours (C), and the MAS sandbox's costs are avoided. It is the reason
  B is `codesign`/`notarytool` rather than an App Store submission.
- **`com.leapsake.desktop` is a separate identity from mobile's `com.leapsake.app`**, and stays
  one. Sharing an identity would only pay off as Apple's Universal Purchase, which requires the
  Mac App Store — contradicting the choice above — and would cost `electron-updater`. Permanent
  after first publish, like mobile's.

⚠️ **Sequencing: B waits for the company, and that is deliberate.** The Developer ID cert could
be issued today, but it would be the **personal** one, and [`@leapsake/key-custody`](../packages/key-custody/README.md) →
*The signing identity owns the enclave key* says what that costs: `safeStorage`'s keychain item
has an ACL bound to the app's code signature, so re-signing under the company's Developer ID
later makes every existing enclave key unreadable and drops every authenticated user at the
recovery gate. Doing that to iOS once, at the transfer, is a priced and accepted cost
([`shipping.md`](./shipping.md) → *Part 2*). Doing it to desktop as well, when desktop has
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
- **Re-run D's E2E against the signed build.** This is where a Team-ID/keychain surprise
  surfaces, and you want it surfacing here rather than in a user's hands — see
  [`@leapsake/key-custody`](../packages/key-custody/README.md) for why signing identity and key
  custody are coupled.

**Acceptance:** downloaded DMG opens on a clean Mac with no Gatekeeper warning; E2E green against
the signed artifact; `safeStorage` round-trips under the real signature.

## C — Auto-update

**Value:** the ability to ship a fix. **Without it, a v0.1 crypto or data-loss bug strands every
user permanently.**

- `electron-updater` against GitHub Releases as the feed.
- The repo goes public before iOS GA ([`shipping.md`](./shipping.md) → Part 1, step 2), and
  desktop ships after it, so C never needs token distribution.

**Acceptance:** an installed older build detects, downloads, and applies a newer release.

## D — The desktop E2E harness

*Gated on A: the harness needs a packaged `.app` to launch. The gate policy it satisfies is
permanent and lives in [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *The E2E release gate*.*

**Value:** macOS earns its row in the gate's platform table the way iOS and Android already
have — automated proof a real user can complete the crucial journeys on the built app.

- Commit to **Playwright** (`_electron.launch()`), per the vendor-neutrality rule in
  [`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *The E2E release gate*.
- Implement catalog Flows **1, 2 and 4**, Flow 4's door acts included
  ([`testing/crucial-flows.md`](./testing/crucial-flows.md)) — the single-instance set. Flows
  1, 2 and 4 are one arc (Flow 4 converts the store Flow 2 filled).
- Add the minimal `data-testid` anchor set **as flows need them**, not upfront.
- Per-flow profile isolation via `--user-data-dir`. **Simulate keystore loss for Flow 4's door acts by
  deleting `keystore.json`** from the test profile — no `dev-clear-dbkey` route is needed on
  desktop, and therefore no test-only surface in production main. *(This is the one place
  desktop is cheaper than mobile, and it is worth not giving away.)*
- Add the macOS leg to the `e2e` tier in `scripts/test-all.mjs`, which is already `ready` and
  green on iOS + Android; this extends it rather than unblocking it. Once the tag-triggered
  pipeline exists, the leg is a `mac` cell gated by its per-cell readiness
  ([`fable-investigation/remote-releases.md`](./fable-investigation/remote-releases.md)).

**Hazards to design around**, both learned the expensive way on other tiers:

- **ABI flip** — `test:node` needs the Node ABI, `test:e2e` the Electron ABI. Tier ordering in
  the orchestrator must be deliberate and the rebuild idempotent; interrupting
  `ensure-sqlite-abi.mjs` deletes the binary outright.
- **Time-dependent Home** — the reminders and holidays engines mint `system` reminders by date.
  Assert on specific expected text, never on emptiness or counts.
- **Starting state is the harness's job, not a flow's.** The mobile arc ends on Flow 4 holding
  an account and keys, so it wipes the app from outside before every run; desktop's
  `--user-data-dir` isolation gives it this for free, but only if every flow gets a fresh one.
  See [`../apps/mobile/maestro/README.md`](../apps/mobile/maestro/README.md) → *What the app's
  own state looks like from here* for what it costs when this is not designed in.

**Acceptance:** `pnpm test:all` shows `e2e` PASS on macOS as well as iOS and Android; a
deliberately-broken build goes red.
