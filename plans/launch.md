# Leapsake — Launch (v0.1 distribution + the release gate)

> **The plan for turning a working codebase into shipped apps.** Everything here is
> pre-v0.1 and on the critical path: store identity, packaging, signing, the automated
> release gate, and the repo going public. For *why* the testing tiers look the way they
> do, see [`testing/`](./testing/); for the crypto posture this plan must not break, see
> [`encryption/`](./encryption/) and [`product-truths.md`](./product-truths.md).
>
> **This is a plan, not a status board.** As increments land, record them in
> [`status.md`](./status.md) and keep this stable.

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

So on the day of the org move, **every user's enclave key becomes unreadable and they boot
into `RecoveryGate`.** That is survivable — it is exactly what `RecoveryGate` and the
24-word phrase exist for — but only if the phrase is *actually in the user's hands*.

Two things follow, and both are increments below rather than footnotes:

1. **The phrase must be nudged, not merely available** (Increment 2). Today reveal is
   on-demand only (`Settings.tsx:1021`), so a local-only user who never visits that section
   has nothing to type into the gate. Under individual-first that is a data-loss path, not
   an inconvenience.
2. **The recovery path must be verified end to end before shipping** (Increment 3), because
   the whole strategy leans on it.

Note this hazard is not unique to the transfer — OS reinstall, machine migration, or any
`safeStorage` failure triggers the same gate today. The org move only makes it fire for
everyone at once, deterministically. Fixing it is worth doing regardless.

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
- **Preemptively** gitignore the credential shapes Increments 4/7 will introduce: `*.p12`,
  `AuthKey_*.p8`, `*.mobileprovision`, `*.jks`, `*.keystore`, `credentials.json`. Cheaper
  than a history rewrite.

**Acceptance:** fresh dev install on both platforms under `com.leapsake.app`; `git status`
clean.
**Note:** the new ID is a new app identity, so existing dev installs hold orphaned data under
the old one — uninstall them and rebuild the dev client before running `pnpm test:native`.
`scheme: "leapsake"` is unchanged, so the `leapsake://` deep links still route.

### Increment 2 — Recovery-phrase onboarding nudge

**Value:** closes a data-loss path that exists *today*, independent of the org move.

Reveal is already available whether or not sync is on — the gap is purely that nothing
prompts. Use the **onboarding-as-reminders** surface that already ships and is CTA-wired on
both clients: a "Save your recovery phrase" onboarding reminder linking into the Settings
section.

**Design constraint:** a nudge, never a wall. A forced phrase-saving gate at first run
violates the layperson/no-hoops principle in
[`product-truths.md`](./product-truths.md) and `encryption/model.md` §1. Dismissible,
re-surfacing, satisfied when the phrase has been revealed.

**Acceptance:** a brand-new local-only profile sees the nudge on Home; revealing the phrase
clears it; it survives relaunch until satisfied. Both clients.

### Increment 3 — Verify + document restore-from-backup

**Value:** the answer to "how do I back up Leapsake?", which local-only users — the majority
at v0.1, since sync requires self-hosting — currently do not have. **Hard prerequisite of
the individual-first strategy** (§2).

Already on the pre-v0.1 list as "verify + document." Confirm the intended story end to end:
copy `leapsake.db` + `leapsake.db.recovery` to a fresh machine, boot, pass `RecoveryGate`
with the phrase, read the data. Then write it up as *the* backup answer.

**Acceptance:** a documented, reproducible restore on a clean macOS user account. Include
the negative case (wrong phrase rejected). If it does **not** work, this becomes a build
increment and everything downstream waits — which is exactly why it runs early and cheap.

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
- Implement catalog Flows **1, 2, 3, 4, 6b** ([`crucial-flows.md`](./testing/crucial-flows.md)).
- Add the minimal `data-testid` anchor set *as flows need them*, not upfront.
- Per-flow profile isolation via `--user-data-dir`; simulate keystore loss for 6b by
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
  mocking it would gut Flows 1, 5, and 6b.

**Acceptance:** repo public with a clean history scan; Actions green on a PR.

### Increment 11 — Mobile submission

**Value:** shipped mobile apps. **Blocked on Track P + Increment 4's 14-day window.**

- iOS: TestFlight → App Store review.
- Android: apply for production access once the closed-test criteria are met; promote.

**Acceptance:** both apps installable by the public.

---

## 6. Deferred / decide-before-committing

- **Two-instance E2E (Flows 5, 6a).** [`crucial-flows.md`](./testing/crucial-flows.md) gates
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
2. **Flows 5/6a in the v0.1 gate or fast-follow?** Follows from (1).
3. **Auto-update before or after going public?** Public-first is simpler; interim tokens
   work if you want updates sooner.
4. **Play closed-test tester recruitment** — 12 real humans for 14 continuous days is a real
   logistics task for a solo bootstrapper. Worth starting the list now.

## 8. What this plan does *not* change

The pre-v0.1 items already in [`status.md`](./status.md) — vCard export, CK revocation/GC,
background-fetch sync, relay disposability, reminder search — are untouched by this plan and
can interleave as capacity allows. The **lunisolar holiday tables** were on this list as the one
launch-blocking exception; they closed on 2026-07-23 (derived, cross-checked, extended to 2056).
