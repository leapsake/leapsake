# Leapsake — Launch (v0.1 distribution + the release gate)

> **The plan for turning a working codebase into shipped apps.** Everything here is
> pre-v0.1 and on the critical path: store identity, packaging, signing, the automated
> release gate, and the repo going public. For *why* the testing tiers look the way they
> do, see [`testing/`](./testing/); for the crypto posture this plan must not break, see
> [`encryption/`](./encryption/) and [`product-truths.md`](./product-truths.md).
>
> **This is a plan, not a status board.** As increments land, record them in
> [`status.md`](./status.md) and keep this stable.
>
> Increments 2–3 and §2's hazard analysis assume *encryption follows custody*
> (`encryption/model.md` §7.2), which is built on both clients.
>
> **Increment 2 now lives in [`onboarding.md`](./onboarding.md)** (its Increments 1–2). It
> still gates Increment 4; the slot below explains what moved and what it inherited.

## 1. The decisions this plan encodes (settled 2026-07-21)

| Decision | Choice | Consequence |
|---|---|---|
| Developer account type | **Individual**, both stores | Cheapest start; legal name is the public seller name; Play's 12-tester/14-day wall applies |
| Eventual org move | **Yes, early** — via app transfer | Transfers preserve installs/reviews/bundle IDs, but **not keychain access** (§2) |
| Bundle IDs | `com.leapsake.app` · `com.leapsake.desktop` | Must change *before* first publish — permanent afterward. `.app` (not `.mobile`) is form-factor-neutral, so a future iPad/tvOS/watchOS target joins the same Apple record via Universal Purchase; it also survives an RN→native rewrite, since a bundle ID names the product, not the codebase. Electron stays a separate identity — Universal Purchase would require the Mac App Store and cost `electron-updater` (Increment 8) |
| macOS distribution | **Direct download**, notarized, not Mac App Store | No review latency for desktop; auto-update is ours to own; MAS sandbox pain avoided |
| Release gate | **Local script** over `pnpm test:all --strict` | Real keychain, $0, honors testing principle #6; hosted CI is an *additional* PR check |
| Repo visibility | **Public at (or shortly before) v0.1** | Unlocks free macOS Actions runners; requires the §7 pre-flight first |

## 2. The constraint that shapes everything: Team ID owns key custody

Individual-first is a sound bootstrap choice, but it carries one non-obvious cost that
must be designed around rather than discovered.

App transfer moves the listing, installs, reviews, ratings, and bundle ID. It does **not**
move key custody:

- **macOS** — `safe-storage-keystore.ts` stores a keychain item whose ACL is bound to the
  app's code signature. A Leapsake LLC Developer ID is a different signing principal; the
  existing item stops being readable.
- **iOS** — keychain access groups are prefixed with the Team ID
  (`$(AppIdentifierPrefix)com.leapsake.app`). New team, new prefix, existing items
  unreachable.

So on the day of the org move, **every user's enclave key becomes unreadable.** What that
costs depends entirely on the custody model — which is why this section used to be alarming
and now mostly isn't:

| The user is… | What the org move costs them |
|---|---|
| **Open** (no account — the common case at v0.1) | **nothing.** There are no keys to lose; the store is plaintext and simply opens |
| **Protected** (has an account) | one password entry at the recovery gate; the phrase is needed only if they have forgotten that too |

> **This is the single strongest practical argument for "encryption follows custody"**
> (`encryption/model.md` §7.2), and it was found here. Under the old default the org move
> dropped *every* user into a 24-word-phrase gate, for a phrase they had never been asked to
> save. Under the new one it is a login prompt for the users who have a login, and a no-op
> for everyone else.

Two things still follow, and both are increments below rather than footnotes:

1. **Custody must exist before real testers do** (Increment 2, plus the build order in
   [`status.md`](./status.md)). The goal is no longer "teach the phrase harder" — it is that
   an account holder has a password to type and an accountless user has nothing to lose.
2. **The recovery path must be verified end to end before shipping** (Increment 3), because
   the whole strategy leans on it — now across *two* doors.

Note this hazard is not unique to the transfer — OS reinstall, machine migration, or any
`safeStorage` failure triggers the same gate. The org move only makes it fire for everyone
at once, deterministically. Fixing it is worth doing regardless.

**Corollary: keep the org move early.** Blast radius scales with user count at transition.

## 3. Sequencing principle: start the long clocks first

Most of this plan is work you control. Two items are calendar time you cannot compress:

- **Apple Developer Program enrollment** — days to weeks.
- **Google Play production access** — a closed test with **≥12 testers opted in
  continuously for 14 days**, which applies to personal accounts and *only starts once a
  build is uploaded*.

That second one is the real critical path, and it inverts the obvious ordering: **mobile
packaging must come early, not last**, so the 14-day clock runs in the background while
desktop work proceeds. Desktop parallelizes completely — direct-download macOS has no
review latency at all, only notarization (minutes).

```
Track P (paperwork)   ├─ Apple enroll ──────┐         ┌─ iOS submit ─┐
                      └─ Play enroll ─┐     │         │              │
Track M (mobile)              Inc 4 ──┴─ 14-day closed test ─────────┴─ Inc 11
Track D (desktop)     Inc 5 ─ Inc 6 ─ Inc 7 ─ Inc 8 ─ Inc 9 ─ Inc 10
Prerequisites         Inc 1 ─ Inc 2 ─ Inc 3 ─┘ (gate everything user-facing)
```

---

## 4. Track P — Accounts (start immediately, ~0 active effort)

Not an increment; it blocks Increments 7 and 11 and nothing before them.

- **Apple Developer Program** — individual, $99/yr. Accept that your legal name is the
  public seller name. Needed for Developer ID (desktop notarization) *and* iOS.
- **Google Play Console** — personal, $25 one-time.
- **Reserve "Leapsake"** on both stores as soon as the accounts exist. Names are
  first-come-first-served.
- ⚠️ **Reserve only what you will ship.** Apple's transfer criteria require an app to have
  **at least one version released** to be transferable. A reserved-but-never-shipped record
  can't move to the org account — you'd have to free the name and re-reserve it, with a race
  window in between.

---

## 5. The increments

Each is independently shippable: it lands, it has standalone value, and nothing is
half-built if the next one is deferred.

### Increment 1 — Store identity + repo hygiene

**Value:** closes the only permanent, free-to-fix decision on the board.

- Pick the real `version` (currently `0.0.0`) and the versioning scheme for both clients.
  The *mechanism* is built — `scripts/set-version.mjs` writes every manifest and gates
  agreement as the `test:versions` tier — so this is now purely the decision. Two parts to
  it: the number, and a **build-number strategy** (`ios.buildNumber` / `android.versionCode`,
  which exist nowhere yet; EAS can auto-increment them in Increment 4). The real deadline is
  **Increment 4's first store upload**, not the v0.1.0 cut: store version strings are
  permanent and monotonic per store record, and stores reject non-numeric strings, so
  `0.0.0` and `0.1.0-dev` are both unusable there.
- ✅ **Done:** the credential shapes Increments 4/7 introduce (`*.p12`, `AuthKey_*.p8`,
  `*.mobileprovision`, `*.jks`, `*.keystore`, `credentials.json`) are gitignored at the root,
  preemptively — cheaper than a history rewrite, and the history goes public in Increment 10.

**Acceptance:** fresh dev install on **iOS and Android** under `com.leapsake.app` (desktop is
a separate identity, `com.leapsake.desktop`, set in Increment 5 — see the identity table in
§1); `git status` clean.
**Note:** the new ID is a new app identity, so existing dev installs hold orphaned data under
the old one — uninstall them and rebuild the dev client before running `pnpm test:native`.
`scheme: "leapsake"` is unchanged, so the `leapsake://` deep links still route.

### Increment 2 — The account invitation on Home → **moved to [`onboarding.md`](./onboarding.md)**

> **Superseded 2026-07-30.** This was scoped as a single nudge. Designing it surfaced enough
> product (per-step outcomes, a persistent record of what the user already answered) that it
> became its own workstream. It now lives in [`onboarding.md`](./onboarding.md) as that plan's
> **Increments 1–2**, which are a drop-in for the gate this slot held.

**Value, unchanged:** gets users from Open to Protected — which is what closes the data-loss
path, rather than teaching a phrase to guard it. It is still a **hard prerequisite of
Increment 4**, for the reason stated there: closed testers are real users with real data.

Three things settled here that `onboarding.md` inherits rather than re-decides:

- **Copy must promise access, not safety** (`encryption/model.md` §7.2.1). A local account
  does *not* protect against a dead SSD, and users will hear that it does unless the wording
  is precise. (The draft's "It's free" was cut — nothing is paid yet.)
- **A nudge, never a wall** — a forced setup at first run violates the layperson/no-hoops
  principle in [`product-truths.md`](./product-truths.md) and `encryption/model.md` §1, and
  would forfeit the zero-setup first run that is the point of the Open state.
- **"Dismissing it re-surfaces later"** was this increment's acceptance criterion and the
  thing the reminder engine could not actually do — its prune is a permanent tombstone. That
  is what reminder snooze in `onboarding.md` Increment 1 exists to fix.

**Acceptance:** as written in `onboarding.md` Increment 2.

### Increment 3 — Verify + document restore-from-backup

> **Grew with the custody decision:** the at-rest sidecar now has **two doors** (password
> and phrase), so each needs its own end-to-end restore proof *and* its own negative case.
>
> ✅ **Both doors are built** (custody slice 5) and proved on desktop against a wiped
> keychain, including the negatives and the check that a password unlock leaves the recovery
> sidecar byte-identical. What is left here is the part that machine could not prove: the
> same exercise on a **fresh machine**, from copied files, and writing it up as the answer.

**Value:** the answer to "how do I back up Leapsake?", which local-only users — the majority
at v0.1, since sync requires self-hosting — currently do not have. **Hard prerequisite of
the individual-first strategy** (§2).

Confirm the intended story end to end on a fresh machine, per custody state:

- **Open store** — copy `leapsake.db`, boot, read the data. No ceremony, no keys.
- **Protected store, password door** — copy the store + sidecars, boot, pass the gate with
  the password.
- **Protected store, phrase door** — same, with the recovery phrase; then confirm it forces
  setting a new password afterwards.
- **Negative cases** — wrong password and wrong phrase both rejected, neither corrupting.

Then write it up as *the* backup answer, including the honest limit: an account protects
**access**, a backup protects against **losing the device**.

**Acceptance:** a documented, reproducible restore on a clean macOS user account covering
all four cases above. If any door does **not** work, this becomes a build increment and
everything downstream waits — which is exactly why it runs early and cheap.

### Increment 4 — Mobile EAS pipeline + first closed-test upload

**Value:** starts the 14-day Play clock. Ships nothing to the public, unblocks everything.

- Create `eas.json` with build profiles (dev / preview / production) — none exists today.
- Android signing (Play App Signing; keep the upload key out of the repo).
- First production-profile Android build → **closed testing track**, recruit ≥12 testers.
- iOS build profile in the same pass; TestFlight upload once Apple enrollment clears.

**Sequenced after 1–3 deliberately:** closed testers are real users with real data. Do not
put a build in their hands before the recovery nudge and a verified restore path.

**Acceptance:** reproducible signed builds from a clean checkout; Android build live in
closed testing with the tester count met and the 14-day clock running.

### Increment 5 — Desktop packaging (unsigned)

**Value:** first real `.app` — a distributable artifact where none exists.

- Add electron-builder (or Forge) producing a macOS `.app` + DMG/zip from `out/`.
- Wire `better-sqlite3-multiple-ciphers` native-module packaging for the Electron ABI —
  this is where `scripts/ensure-sqlite-abi.mjs` and asar unpacking must agree.
  (An N-API fork release would delete this whole constraint — see
  [`sqlite-abi-napi.md`](./sqlite-abi-napi.md).)
- Bundle ID `com.leapsake.desktop`; app icon; category; version from Increment 1.

**Acceptance:** `.app` launches on a clean macOS user account, creates its DB, migrates,
and reaches Home. Native SQLite loads from the packaged bundle.
**Risk:** native-module packaging is the classic Electron failure and the reason this is its
own increment rather than a step inside signing.

### Increment 6 — Desktop E2E harness + single-instance flows

**Value:** the first automated proof a real user can complete the crucial journeys — and the
substance of the release gate.

- Commit to **Playwright** (`_electron.launch()`), per
  [`strategy.md`](./testing/strategy.md#vendor-neutrality-two-layers-kept-apart).
- Target the **packaged artifact** from Increment 5, not `out/` — this is why packaging
  comes first and why no harness rework is needed later.
- Implement catalog Flows **1–5, 7b, 7c** ([`crucial-flows.md`](./testing/crucial-flows.md)) —
  the single-instance set. Flows 1–4 are one arc (Flow 4 converts the store Flows 1–3 filled).
- Add the minimal `data-testid` anchor set *as flows need them*, not upfront.
- Per-flow profile isolation via `--user-data-dir`; simulate keystore loss for 7b/7c by
  **deleting `keystore.json`** from the test profile — no `dev-clear-dbkey` route needed on
  desktop, and no test-only surface in production main.
- Flip the `e2e` tier in `scripts/test-all.mjs` from `blocked` to `ready`.

**Hazards to design around:**
- **ABI flip** — `test:node` needs the Node ABI, `test:e2e` the Electron ABI. Tier ordering
  in the orchestrator must be deliberate and the rebuild idempotent (interrupting
  `ensure-sqlite-abi.mjs` deletes the binary).
- **Time-dependent Home** — the reminders/holidays engines mint `system` reminders by date.
  Assert on specific expected text, never on emptiness or counts.

**Acceptance:** `pnpm test:all` shows `e2e` PASS on macOS; a deliberately-broken build goes
red.

### Increment 7 — Signing + notarization

**Value:** an artifact a stranger can actually install. **Blocked on Apple enrollment.**

- Developer ID Application cert; hardened runtime; entitlements.
- Notarization + stapling in the build pipeline.
- **Re-run Increment 6's E2E against the signed build.** This is where a Team-ID/keychain
  surprise surfaces, and you want it surfacing here rather than in a user's hands.

**Acceptance:** downloaded DMG opens on a clean Mac with no Gatekeeper warning; E2E green
against the signed artifact; `safeStorage` round-trips under the real signature.

### Increment 8 — Auto-update

**Value:** the ability to ship a fix. Without it, a v0.1 crypto or data-loss bug strands
every user permanently.

- `electron-updater` against GitHub Releases as the feed.
- **Simpler once the repo is public** (Increment 10) — no token distribution. Either
  sequence it after 10, or accept a token in the interim.

**Acceptance:** an installed older build detects, downloads, and applies a newer release.

### Increment 9 — Local release gate

**Value:** makes the trophy binding rather than advisory.

A release script that runs `pnpm test:all --strict` and **refuses to package, notarize, or
publish** on any red *or blocked* tier. Thin caller of existing scripts — no logic lives in
the gate, which is what keeps testing principle #6 (vendor neutrality) intact.

**Acceptance:** the release command aborts on an induced test failure and on a blocked tier;
succeeds only on a full green.

### Increment 10 — Public repo

**Value:** transparency for a privacy product; free macOS Actions runners.

Pre-flight, in order (git history is public *forever* — this precedes the flip):
- Confirm `apps/server/test/fixtures/localhost-test-only.key` is a throwaway self-signed
  localhost cert (the name says so; verify).
- Run a proper secret scan over full history (gitleaks/trufflehog). Filename-level scanning
  is already clean.
- **Decide on `encryption/security-findings.md`.** It is an adversarial review with open
  HIGH findings (H1 — the relay as a standing offline password-cracking oracle — plus open
  M1/M2/M4). **Recommendation: publish it.** Transparency is on-brand, H1's deferral is
  already a documented deliberate trade-off, and self-hosters deserve to know what they are
  accepting. Quietly deleting it before going public would be worse on every axis. But close
  anything in its "suggested fix order" marked pre-v0.1 first — an acknowledged-and-unfixed
  finding reads very differently from a fixed one.
- After flipping: a GitHub Actions workflow for **PR checks only**, calling the same scripts.
  The *release* gate stays local — hosted runners can't provide a real unlocked keychain, and
  mocking it would gut Flows 1, 4, 6, and 7.

**Acceptance:** repo public with a clean history scan; Actions green on a PR.

### Increment 11 — Mobile submission

**Value:** shipped mobile apps. **Blocked on Track P + Increment 4's 14-day window.**

- iOS: TestFlight → App Store review.
- Android: apply for production access once the closed-test criteria are met; promote.

**Acceptance:** both apps installable by the public.

---

## 6. Deferred / decide-before-committing

- **Two-instance E2E (Flows 6, 7a).** [`crucial-flows.md`](./testing/crucial-flows.md) gates
  these for v0.1: two app instances plus an ephemeral relay. On desktop this is tractable
  (separate `--user-data-dir`s, local `@leapsake/server`). Own increment after 9.
- **Windows / Linux.** Out of scope, matching the E2E host policy — blocked, not waived.
  Windows code-signing certs carry their own procurement latency and, for OV/EV, hardware
  token logistics.

## 7. Open decisions for owner sign-off

1. **How much of the E2E catalog gates v0.1, really?**
   [`strategy.md` §3](./testing/strategy.md#3-native-platform-e2e-the-release-gate-policy)
   currently requires the **full catalog green on iOS + Android + macOS**. Taken literally
   that is plausibly the single largest chunk of remaining work — larger than all of
   distribution. Options: (a) honor it fully; (b) amend the policy to *full catalog on macOS
   + the existing driver self-test plus a smoke subset on mobile* for v0.1, with the full
   mobile catalog as a fast-follow. **Leaning (b)** — but it is a deliberate amendment to a
   written gate, so it needs your call rather than a quiet reinterpretation.
2. **Flows 6/7a in the v0.1 gate or fast-follow?** Follows from (1).
3. **Auto-update before or after going public?** Public-first is simpler; interim tokens
   work if you want updates sooner.
4. **Play closed-test tester recruitment** — 12 real humans for 14 continuous days is a real
   logistics task for a solo bootstrapper. Worth starting the list now.

## 8. What this plan does *not* change

The pre-v0.1 items already in [`status.md`](./status.md) — vCard export, CK revocation/GC,
background-fetch sync, relay disposability, reminder search — are untouched by this plan and
can interleave as capacity allows. (The **local-custody decision** is the one exception added
since: it does not change this plan's shape, but it holds Increments 2–4 — see the banner at
the top. **Onboarding** is the second: it took Increment 2's content out to
[`onboarding.md`](./onboarding.md) but left the sequencing intact — Increment 4 still waits on
it, and nothing else here moved.) The **lunisolar holiday tables** were on this list as the one
launch-blocking exception; they closed on 2026-07-23 (derived, cross-checked, extended to 2056).
