# Leapsake — The Crucial-Flow Catalog (the E2E keystone)

> **Signed off** *(owner, 2026-08-28 — the rung grading; the catalog itself has been the
> reference since Flows 1-5 were written against it)*. First drafted 2026-07-18; **rewritten
> 2026-07-28** against the *encryption follows custody* model. The single, *tool-agnostic* list of user journeys that
> **every platform's E2E harness implements against the built app**. It is the analog, one tier
> up, of the driver-contract keystone — authored once in plain language so Maestro (mobile),
> Playwright/Electron (desktop), and any future harness encode the *same* journeys and can't
> drift. Keeping it separate from any one tool is the core anti-lock-in move
> ([`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) → *The E2E release gate*).
>
> Read [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) → *The E2E release gate*
> for the gate policy this implements. This file is design, not a status board — when a harness
> lands a flow, record that in [`status.md`](../status.md), keep this stable.

## What this is (and is not)

Each flow asserts on **what's on screen** (principle #3) and drives the **built app** through
its real boundary (principle #4) — never the app's internals, never a mocked engine. The catalog is
**deliberately small**: the driver-contract keystone already proves the engine seam and the
~37 desktop integration suites prove the shared repo/service logic, so E2E only needs to prove
the journeys those tiers *can't* — the ones that only exist once real UI, real OS key storage,
and (for sync) two real devices are wired together. A simulator/emulator/VM is the accepted
approximation ([`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) → *The E2E release gate*).

**This catalog is authored against the app as actually built.** Two consequences a harness
author will otherwise get wrong:

> **There is no per-launch passphrase wall, and a fresh install has no secrets at all.**
> Under *encryption follows custody* ([`../encryption/model.md`](../encryption/model.md) §7.2),
> a first launch is **Unauthenticated**: it mints no keys, leaves the OS key store empty, and opens a
> **plaintext** store. **Creating an account — username + password — is the single act that
> turns encryption on**, converting the store as it goes and showing the 24-word recovery
> phrase once. A device *joining* an existing account starts Unauthenticated too, and the join converts
> it before any account data arrives (§7.1) — see Flow 6. So the journey to
> exercise is not "set a passphrase, lock, unlock" — it is **Unauthenticated → account → Authenticated**
> (Flow 4), plus the two doors that reopen an Authenticated store when the OS key store is lost
> (Flow 7).

> **The recovery phrase is shown once and is never re-viewable.** There is no
> "reveal my phrase" surface in Settings — an account holder who loses the phrase rotates to a
> new one behind re-auth (a later increment), and no flow may assume the phrase can be re-read
> after account creation. **Every flow that needs the phrase must capture it at the moment it
> is shown** (Flow 4 or Flow 6) — and, because a capture cannot leave the flow that made it
> (see the ⚠️ under the matrix), **must itself be the flow that reaches that moment**. This is
> the single most likely way to write a flow that passes today and rots tomorrow.

## Asserting on custody: the one deliberate exception to "assert on screen"

Custody's defining properties are **invisible**. "The store is ciphertext", "the key store is
empty", "the plaintext original is gone" cannot be read off any screen, and a flow that only
checks the UI would pass against an app that encrypted nothing. So the custody flows (1, 4, 6,
7) are permitted a **bounded set of out-of-band assertions against the test profile on disk**:

| Check | How | Meaning |
|---|---|---|
| Store custody | first 16 bytes are SQLite's `SQLite format 3\0` magic, or are not | plaintext vs. encrypted — the same test the app's own `storeFileState` makes |
| Key material | count/keys of the profile's OS key store (desktop `keystore.json`; mobile the secure store) | Unauthenticated holds **zero**; Authenticated holds the db-key, enclave secret, recovery key, device id |
| Store location | the store's path within the profile | `stores/local/` when Unauthenticated, `stores/<accountId>/` when Authenticated |
| Roster | desktop a plain JSON file under `userData`; **mobile the `roster` table in `leapsake-roster.db`** | zero accounts when Unauthenticated, exactly one after creation |
| Doors | desktop the `<db>.recovery` **and** `<db>.password` files; **mobile the two `kind` rows (`password`, `recovery`) in `stores/<accountId>/doors.db`** | the two doors Flow 7 exercises exist |

⚠️ **The last two rows are shaped differently on each client, and this table used to state only
the desktop shape** *(corrected 2026-09-09)*. Both clients are right; they simply store the same
facts differently, and a harness author who goes looking for mobile `.recovery` files finds
nothing and concludes the door is missing.

**Rules, so this stays an exception and not a habit.** These are *file existence and shape*
checks only — never open the store, never decrypt, never call into app code. They are permitted
only in the flows named above, and only **in addition to** an on-screen assertion, never instead
of one. Every other flow asserts purely on visible text.

### Where these run on mobile — the harness, not the app

**Four of the five rows are built** *(iOS, 2026-09-09)*. They live in
[`scripts/lib/custody-assertions.mjs`](../../scripts/lib/custody-assertions.mjs) as two pure
functions over the app's SQLite directory — `custodyUnauthenticated` for Flow 1,
`custodyAuthenticated` for Flow 4 — attached to those flows in
[`scripts/test-e2e.mjs`](../../scripts/test-e2e.mjs) and run by the harness the moment a flow
goes green on screen. A green run prints `✓ out-of-band custody: asserted on disk`.

- **The harness already had the container**, which is what made this cheap:
  `scripts/lib/mobile-harness.mjs` → `iosContainer` calls `xcrun simctl get_app_container
  <device> com.leapsake.app data`, and everything except the key store sits under
  `Documents/SQLite/` beneath it. **`wipe` and `appDataRoot` share that one call on purpose** —
  the directory a run erases is the directory its assertions then read.
- **No in-app inspection screen, and that is permanent.** "Never call into app code" is the whole
  point: a dev screen reporting *"I am encrypted"* is the app testifying about itself, which is
  the weaker evidence and the one an encrypting-nothing build would still pass. Read the files.
- ⚠️ **The key-store row is deferred, and it is a decision rather than an oversight**
  *(2026-09-09)*. `xcrun simctl keychain` offers `add-cert`, `add-root-cert` and `reset` and has
  **no read verb** — which is why `wipe` resets the whole keychain rather than inspecting it —
  and the one surface that would answer it is the one refused above. What stands in for it:
  Flow 1's on-screen absence of "Unlock your data", and Flow 4's **ciphertext store**, which a
  build that minted no keys could not produce. Revisit if a read verb appears, or if the harness
  gains a host-side keychain reader. The harness prints the deferral on every run
  (`KEY_STORE_NOTE`) so it stays visible rather than merely absent.
- **Android does not assert.** Its `wipe` is `adb shell pm clear`, which hands back no container
  path, so `androidDriver` has no `appDataRoot` and the run prints `⚠ out-of-band custody: not
  asserted on Android`. Reported, never silently skipped — and not a red, since a platform that
  cannot answer is not a defect in the build. v0.1 is iOS alone
  ([`../shipping.md`](../shipping.md) → *Part 2*).
- **"Gone" must mean the file, not the directory.** After a conversion or a Forget, `stores/local/`
  and the old `stores/<accountId>/` remain as **empty directories** while their `.db` files are
  deleted. An assertion written as "the directory does not exist" goes red against a correct app.
  There is a unit test whose whole job is to stop someone "fixing" this.
- **Assert on rows, not on a doors file.** `doors.ts` and `roster-storage.ts` both run
  `CREATE TABLE IF NOT EXISTS` on *every* open, read included, so an empty `door` or `roster`
  table is a state a correct app reaches.

**The negative cases are the deliverable.** An assertion that never fires looks exactly like one
that passes, and none of these can go red on a working simulator — so
`scripts/lib/custody-assertions.test.mjs` builds fixture trees per test (`mkdtemp`, torn down
after) and proves each check catches its own failure: a plaintext account store (the
encrypting-nothing build), a surviving `stores/local/leapsake.db`, a roster naming none or two
accounts, a doors table missing `recovery`. It also asserts the checks **create nothing** — a
bare `new DatabaseSync(path)` creates the file, so a check asking "does the roster exist?" could
otherwise answer by planting one.

## The selector problem (must resolve before the first harness)

Today the app has **almost no stable test anchors** — a repo-wide scan finds only the dev
self-test's `driver-selftest-status` / `dev-clear-dbkey-*` `testID`s and **zero** `data-testid`
on desktop. Principle #3 (assert on visible text) is the default and covers most assertions, but
a few assertion points are text-ambiguous (empty-state vs. loading, the phrase display, sync
status), and keying those on incidental copy makes flows brittle.

**Recommendation (for sign-off):** default to visible text; add a *minimal, named* set of stable
anchors for the ambiguous points only, following the existing `driver-selftest-status` precedent
— **`testID` on React Native, `data-testid` on the desktop DOM, identical token strings across
both clients** so one catalog line targets both. The proposed minimal set (add as flows are
implemented, not upfront):

| Anchor token | Marks | Used by | Built |
|---|---|---|---|
| `home-empty` | Reminders/Home empty-state reached, boot done | Flow 1 | — |
| `home-ready` | Home rendered with content | Flows 5, 6 | — |
| `sync-status` | sync state text (its label = `off`/`syncing`/`synced`/`error`) | Flow 6 | — |
| `recovery-phrase` | the one-time 24-word phrase display (label = the words) | Flows 4, 6, 7 | **not built — and not needed**, see below |
| `recovery-gate` | the at-rest boot gate is up | Flow 7 | mobile, 7c |
| `recovery-secret` | the box around the gate's secret field, whichever door is showing | Flow 7 | mobile, 7c |
| `recovery-submit` | the gate's **Unlock** button | Flow 7 | mobile, 7c |

The gate hosts two doors (password, phrase); the flows pick a door by its visible label and the
switch links, and the three anchors above cover only what the labels cannot: a container with no
text of its own, a field that no selector can reach (`secureTextEntry` on one door has empty
accessibility text; `multiline` on the other is a `UITextView` that carries no identifier at all,
so the anchor goes on a wrapping element rather than the input), and a button whose label
(`Unlock`) is a prefix of the screen's own title (`Unlock your data`) and flips to `Checking…`
mid-submit. Keep this list *small and shared*; everything else asserts on real on-screen labels
("People & Pets", "Factory reset", "Save your recovery phrase", "Unlock", the person's name, the
milestone note).

⚠️ **`recovery-phrase` is not the escape hatch it looks like, and 7b shipped without it.**
Adding it — even with the whole phrase as its label, so one `copyTextFrom` captures it — does
**not** let one flow hand the words to another; the barrier is process isolation, not selector
cost. What settled it is that the alternative turned out to be free: a `repeat` of `copyTextFrom`
over the grid's own numbered `Text` nodes captured all 24 words in **4 seconds** on the first
attempt (2026-09-09). So the phrase is still never exposed as a single string anywhere in the
app, which is a property worth keeping rather than a cost avoided.

---

## Core catalog — the v0.1 release gate

Seven flows (Flow 7 has three variants). Each must run **automated and green** on **iOS +
Android + macOS** before v0.1
([`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) → *The E2E release gate*). Windows/Linux implement the *same* list later, no changes. Columns:
**Devices** (single vs. the two-instance sync pair), and **Uniquely exercises** (why E2E — the
surface no lower tier reaches).

### Flow 1 — First run reaches a usable empty state, and mints nothing

- **Intent:** a fresh install boots all the way to a usable screen with no data, no account,
  and **no key material anywhere** — no crash, no stuck gate, no ceremony.
- **Preconditions:** clean install: empty OS key store, no store file, no roster.
- **Steps:** launch the built app; wait for boot to settle.
- **Assert (on screen):** ⚠️ *corrected 2026-08-28, amended 2026-09-10 — Home is **not** empty
  on a first run: the reminders engine mints a getting-started onboarding nudge whenever the
  store holds no entities, so `01-first-run.yaml` asserts that nudge's own text instead, which
  is both true of the build and stronger (it proves the engine reconciled). Which step that is
  changed on 2026-09-10 — `import-contacts` replaced `add-first-person` — and the flow's text
  moved with it; the reasoning did not. The gate's title is also "Unlock your data", not the
  wording below.* The Reminders/Home screen is reached;
  the app's standing navigation offers a way to **People & Pets** and to **Settings**. No
  `recovery-gate`. Settings offers to create an account and shows **no** recovery-phrase surface.
  > **Where those two live is per-platform, and deliberately so** *(amended 2026-08-17, mobile
  > navigation; revised 2026-09-01)*. Desktop keeps both in its top nav. Mobile's tab bar is Home,
  > Search, **People** and **Settings** — four destinations, no verb. Two things changed from the
  > 2026-08-17 wording: People & Pets is a tab again rather than a browse tile, and the fourth tab
  > is **Settings in both custody states**, so its label is no longer an assertion about whether
  > this device has an account (the account offer on the screen behind it still is). Creating
  > moved to a **➕ in each screen's own header**, so there is no New tab to look for. Assert
  > **reachability**, not tab labels; the shell's own shape is
  > `apps/mobile/maestro/global-nav.yaml`'s job, not this flow's.
- **Assert (out of band):** the store is **plaintext** and sits at `stores/local/`; the OS key
  store holds **zero** Leapsake entries; the roster holds zero accounts; neither door exists.
- **Devices:** single.
- **Uniquely exercises:** the Unauthenticated boot path, whose defining property is an *absence* — and an
  absence no lower tier can prove, because they all inject a fake key store. This is the flow
  that would catch a regression re-introducing first-launch key minting.

### Flow 2 — Create a person and a relationship

- **Intent:** the core write path a human drives.
- **Preconditions:** Flow 1 state (or any booted app).
- **Steps:** add a person "Ada Lovelace"; add a second person "Augustus De Morgan"; from one
  person, add a relationship linking them (pick a role).
- **Assert:** both appear in **People & Pets**; opening Ada shows the relationship to Augustus
  with the chosen role rendered.
- **Devices:** single.
- **Uniquely exercises:** the renderer form → IPC/core → repo → write → re-read → render loop
  through the *real* UI (the whole renderer/component layer that has **no** test today at any
  tier).

### Flow 3 — Record a milestone

- **Intent:** a rich write that must survive a real restart.
- **Preconditions:** at least one person (Flow 2).
- **Steps:** open a person; add a milestone with a date and a note ("Met at the Analytical
  Engine talk").
- **Assert:** the milestone renders on the person's timeline; relaunch (or navigate away and
  back) and it still reads correctly. ⚠️ *Corrected 2026-08-28: the person page never renders a
  milestone's **note** — a row is icon + label + date (`components/MilestonesSection.tsx`), and
  the note reaches the screen only for an `other` milestone, where it is the label. So
  `03-milestone.yaml` reads the note back out of the edit form, which proves more than the
  timeline could: the value came out of storage and back into a field.*
- **Devices:** single.
- **Uniquely exercises:** write→store→relaunch→read through real storage in the production
  runtime, rather than an in-memory session.
- **Note:** the note is an ordinary **plaintext column** — the per-item content-key path has no
  domain-field consumer today. Layer 3 returns with photos (v0.2) and gets its own flow then;
  do not write this flow as if it proves content-key encryption.

### Flow 4 — Create an account: the act that turns encryption on

- **Intent:** the custody keystone — an Unauthenticated store with real data becomes an Authenticated one,
  in place, without losing a row and without the app falling over as its own store is replaced
  underneath it.
- **Preconditions:** an Unauthenticated store **with data** (Flows 1–3). Converting an empty store proves
  nothing; the data is the point.
- **Steps:** Settings → create an account → username + password (≥12 chars) → submit. The
  24-word phrase is shown once; **capture it** (every later recovery flow depends on this
  capture — it cannot be re-read); tick **I've saved my recovery phrase** → **Done**.
- **Assert (on screen):** the phrase renders as 24 words (`recovery-phrase`); while it is up the
  app chrome is **not** reachable, so it cannot be dismissed by an accidental navigation; after
  **Done** the app **continues in place — no restart, no blank window** — and Ada plus her
  milestone from Flows 2–3 are still on screen and still readable; Settings now reports the
  account; the phrase is **not** offered anywhere again.
- **Assert (out of band):** the store is now **ciphertext** at `stores/<accountId>/`; the
  Unauthenticated store at `stores/local/` is **gone**; the roster holds exactly one account; the OS key store
  now holds the db-key, enclave secret, recovery key and device id; both doors exist (see the
  custody table for each client's shape).
- **Devices:** single.
- **Uniquely exercises:** the plaintext→encrypted conversion of a *live* store with real rows,
  driven through the real UI, plus the OS key store's transition from empty to populated. Both
  clients' converters are covered a tier down; what only E2E proves is that the **running app**
  survives its own store being swapped and remains usable immediately afterwards.
- **Harness note:** ~~Mobile today reaches account creation only through the relay-bound signup
  path~~ — **stale, corrected 2026-08-27.** Both clients now offer a local-only account with no
  relay: mobile renders `CreateAccount` outside the `multiDevice` gate
  (`apps/mobile/app/settings.tsx:118`), because the flag's line is the relay, not the login. The
  entry points have converged, so this flow runs the same way on both. The assertions above are
  unchanged, and the product gap this note used to record — a mobile-only user unable to encrypt
  at all under *encryption follows custody* — is closed.

### Flow 5 — Reminder with an `@mention` and a `#tag` (Home round-trip)

- **Intent:** the most UI-dense surface — the Home screen plus the mention/tag authoring pickers
  and their two-way backlinks — which has **zero** automated coverage below E2E (the pure
  helpers are unit-tested in `packages/schema`, but `MentionTextField` / `ReminderForm` on both
  clients are not).
- **Preconditions:** at least one person (Flow 2), e.g. Ada.
- **Steps:** create a reminder; in the body, trigger the `@` picker and mention Ada, and type a
  `#birthday` tag; save.
- **Assert:** (a) the reminder shows on Home (`home-ready`); (b) its `@Ada` renders as a link and
  opening it lands on Ada's page; (c) Ada's page lists the reminder under its mentions/backlink
  section; (d) the `#birthday` tag's page lists the reminder.
- **Devices:** single.
- **Uniquely exercises:** the mention/tag *compose* interaction (typeahead pickers, token
  insertion) and the synced backlink rendered on the entity page — interaction + cross-screen
  navigation that a repo test can't assert.

### Flow 6 — Enable sync and pair a second device

- **Intent:** the multi-device join that integration tests can only approximate (they wire two
  engines to one in-process relay; this drives two *real app instances* through the real UI and
  key store).
- **Preconditions:** a reachable relay (local/self-hosted — the execution layer is swappable,
  [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) → *The E2E release gate*); Device A holds data (run Flows 2–3 first) and is still **Unauthenticated**.
- **Steps:** **Device A** → Settings → **Set up or log in to sync** → register a username +
  password (≥12 chars); **capture the phrase** shown once. **Device B** (fresh install) →
  Settings → same entry → log in with that username + password.
- **Assert (on screen):** A's `sync-status` reaches `synced`; on **B**, the person and milestone
  A created appear on screen after convergence.
- **Assert (out of band):** enabling sync **is** account creation that also binds a relay, so
  **Flow 4's out-of-band assertions apply to Device A unchanged** — its store converted, its
  Unauthenticated store is gone, its roster and key store are populated. Device B should be the same:
  §7.1 requires a joining device to be encrypted at rest before any account data reaches it,
  which the join achieves by converting B's Unauthenticated store — so B ends with no plaintext store,
  a db-key, a roster entry and a password door.
  > **Closed by custody slice 6** (2026-07-30). This assertion was specified red while
  > `sync:join` adopted the account key without converting the store; the client adopt flows
  > (`adopt-account-flow.ts`, mobile's `adoptStoreForAccount`) now do both.
- **Devices:** **two instances** (two emulators/sims, or two macOS app instances with separate
  data dirs).
- **Uniquely exercises:** OS key store *and* relay together — register wraps the master key under
  the password and escrows it; join unwraps it on a second device and adopts the account's
  recovery key — plus real push/pull convergence over the wire.

### Flow 7 — The doors back in (three variants)

The phrase and the password are the two ways back into an Authenticated store; **all three variants
gate**. Every variant carries its **negative case** — a wrong secret must be rejected visibly
and must corrupt nothing. Leaving the negatives out is how a door that never actually checks
anything ships green.

**Every variant that opens the phrase door depends on a phrase captured during Flow 4 or
Flow 6.** There is no reveal-in-Settings to fall back on, and — the part that decides these
flows' shape — **a capture cannot cross from one flow to another**; see the phrase-capture note
under the matrix. So a flow that needs the words must be the flow that watched them appear.

**7a — Cross-device recovery (forgot password).**
- **Steps:** on a synced account (Flow 6), take the phrase captured there to a **fresh** Device
  C; choose recover-by-phrase; enter the words; set a new password.
- **Assert:** C reads the account's data after recovery, and is forced to set a new password in
  the process; the *wrong* phrase is rejected with a visible error before anything is written.
- **Devices:** two (a synced account + a fresh device).
- **Uniquely exercises:** the relay recovery/password-reset path in the real runtime.

**7b — At-rest local recovery, phrase door.**
- **Steps:** on an Authenticated device with data, simulate an OS key-store reset (desktop: delete
  `keystore.json` from the profile; mobile: the `dev-clear-dbkey` route) and relaunch; the boot
  gate appears (`recovery-gate`, "Unlock your data"); choose **Forgot your password?**; enter the
  phrase → **Unlock**.
- **Assert:** the app opens to the existing data; a wrong phrase re-enables the form with an
  error and leaves the sidecar intact (a second attempt with the right phrase still works —
  assert that, or the "corrupts nothing" claim is untested).
- **Also 7b's, moved from 7c** *(2026-09-09)*: **the right phrase still opens the store after a
  password unlock has happened.** It sits here because it needs the words, and the words cannot
  leave the flow that watched them appear — so it is 7b that has to create its own account.
- **Devices:** single.
- **Uniquely exercises:** the boot-time gate and the `.recovery` sidecar unwrap — the local-only
  backup story. No lower tier boots through this gate.
- ✅ **Built** *(iOS, 2026-09-09)* — `apps/mobile/maestro/e2e/07b-phrase-door.yaml`, last in the
  `test:e2e` arc, 4m45s. Self-contained exactly as required: factory-reset, seed
  a person, create an account, capture the phrase from the reveal, then drive the door — all in
  one flow file, because that is what puts the reveal and the door in one `maestro test` process.
  It carries every assertion above, including the clause moved from 7c.
- **The doors are asymmetric in cost, and the flow is budgeted for it.** 7b pays two Argon2id
  passes (its own store conversion, 53s, and the one password unlock the moved clause needs,
  26s); the phrase door itself answers **sub-second in both directions**, right or wrong, because
  it unwraps raw key material and derives nothing.

**7c — At-rest local recovery, password door.**
- **Steps:** the same key-store reset, answered with the **account password** instead of the
  phrase.
- **Assert:** the app opens to the existing data; a wrong password re-enables the form with an
  error and consumes nothing; afterwards the *phrase* door is still **offered** and its sidecar
  still **reads** — a well-formed but wrong phrase must be rejected by the sidecar's own MAC,
  with the phrase door's own error, not by the codec and not by "that door is not available".
  The doors are independent and a shared-state bug here is invisible until someone needs the
  second door, so this is asserted right after the act that would cause it: a password unlock is
  not read-only on the phrase sidecar — the boot path rewrites the recovery door on its way
  through, and `convergeRecoveryKey` writes it again.
- ⚠️ **What 7c does *not* assert, and where it went** *(2026-09-09)*: that the **right** phrase
  opens the store. That needs the 24 words, which no flow but the one that watched the reveal can
  have — so the clause moved to **7b**, whose shape is built around exactly that. This is a
  scheduled split, not a silent one; [`../shipping.md`](../shipping.md) → Part 1 carries it.
- **Devices:** single.
- **Uniquely exercises:** the password sidecar in the pre-database boot path. This is the door
  that makes an org-move Team-ID change cost one password entry instead of a phrase hunt
  ([`../../packages/key-custody/README.md`](../../packages/key-custody/README.md)), and it is the most delicate code in the app: it runs
  before the database opens, so a bug is not a failed query but an app that cannot start.
- **Note:** this variant covers the automated half of [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)
  Increment 3, whose manual half additionally documents restore-from-file-backup per door.

---

## Extended / candidate flows (confirm or defer — not in the v0.1 gate unless promoted)

Strong E2E value and all currently untested at the UI level, but promote **deliberately** (the
tier stays small). Listed so the owner can pull any into the gate:

- **Contact import.** Desktop: drop a `.vcf` → review modal → import → people appear (exercises
  `DropImportProvider` + the review modal, untested UI over a well-tested package). Mobile:
  import from device contacts (`import.tsx`; `device-contacts` is unit-tested, the screen isn't).
  *Recommendation: promote at least the desktop drop path — it's a headline surface with a whole
  untested overlay.*
- **Factory reset.** Settings → **Factory reset** → type the confirm phrase → data cleared, the
  app returns **in place** to a first-run Unauthenticated state (no restart), with the key store emptied and
  the roster cleared. Recent, untested at the UI level; also the natural teardown between other
  E2E runs, and it shares the reopen-in-place path with Flow 4 — a regression in one breaks both.
- **Search.** Global search bar → type a person's name → result appears → navigate to them.
  Cheap, exercises the search service through the real UI.
- **Reminder completion / due date.** Complete a reminder (reversible) and set a due date;
  assert the state change on Home. Rounds out Flow 5's surface.
- **Sign out → sign back in** (custody §7.3, once built). Sign out closes the store; signing back
  in with the password reopens it. The deliberate half of locking; the automatic/idle half is
  explicitly v0.2.
- **Rotate the recovery phrase** (once built). Re-auth → new phrase shown once → the old phrase
  no longer opens the store. Note the multi-device caveat before writing this flow: until each
  device re-adopts the new key, the old phrase still opens *that* device's sidecar, so the
  assertion is per-device, not per-account.

---

## Per-platform × per-flow matrix (the gate at a glance)

| Flow | Gates at | macOS | Android | iOS | Win/Linux | Devices | Harness notes |
|---|---|---|---|---|---|---|---|
| 1 First run (Unauthenticated, mints nothing) | **beta** (screen) · rc (out-of-band) | gate | gate | gate | later | 1 | fresh profile per run; out-of-band ✅ iOS 2026-09-09 (store custody, location, roster, doors — key store deferred) |
| 2 Person + relationship | **beta** | gate | gate | gate | later | 1 | — |
| 3 Milestone | **beta** | gate | gate | gate | later | 1 | relaunch to prove persistence |
| 4 Create an account | **beta** (screen) · rc (out-of-band) | gate | gate | gate | later | 1 | must run on a store **with** data; 7b makes its own account rather than reusing this one — see below; out-of-band ✅ iOS 2026-09-09 (same four rows) |
| 5 Reminder @/# round-trip | **beta** | gate | gate | gate | later | 1 | drives the compose pickers |
| 6 Enable sync + pair | with sync (v0.2) | gate | gate | gate | later | **2** | needs a relay + two instances; Flow 4's assertions apply to A |
| 7a Cross-device recovery | with sync (v0.2) | gate | gate | gate | later | 2 | includes wrong-phrase negative |
| 7b At-rest, phrase door | **rc** | gate | gate | gate | later | 1 | ✅ built (iOS, 2026-09-09); same reset, phrase answer. **Creates its own account** — the words cannot cross a flow boundary |
| 7c At-rest, password door | **rc** | gate | gate | gate | later | 1 | ✅ built (iOS, 2026-09-09); same reset, password answer; three Argon2id passes, so budget it like Flow 4 |

**"Gates at"** is the release rung by which a flow must be green, per
[`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) → *The E2E release gate*'s rung table
*(settled 2026-08-28 — [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) → *The E2E release gate*)*. It grades
*when*, never *whether*: every core flow still gates v0.1, and `rc` is inside v0.1. Flows 6/7a are
the exception and leave v0.1 entirely, per open decision 2.

✅ **The phrase capture is built, and it was never a cost — it is a constraint on shape**
*(rewritten 2026-09-09 while building 7c, and confirmed the same day by building 7b; the
2026-08-28 wording priced it wrongly)*. Every variant of Flow 7 that opens the phrase door needs words that are
shown exactly once, on Flow 4's reveal. **A flow cannot hand them to another flow:**

- `scripts/lib/mobile-harness.mjs` runs **`maestro test <file>` once per flow**, so `output.*`
  and `maestro.copiedText` die with each flow's process.
- The old wording priced the capture at "24 stitched `copyTextFrom` calls, or a new surface
  exposing the phrase as one string". Both are real ways to get the words *into a variable*, and
  **neither gets them out of the flow** — which is why adding the `recovery-phrase` anchor does
  not solve this either.
- The reveal's own **Copy** button does not bridge it. Maestro's `pasteText` replays *its own*
  `copiedText` via `inputText`; it never reads the device pasteboard (verified against
  `maestro-orchestra.jar`, Maestro 2.8.0).

**So the rule is: the flow that needs the words must be the flow that watched them appear.** 7b
therefore creates its own account rather than inheriting Flow 4's; that is its whole extra cost,
and it is a second store conversion, not a selector problem. **7c escapes it**: the password door
is answered with the password Flow 4 already typed, so 7c inherits Flow 4's end state directly.

**And the capture itself was cheap** *(measured 2026-09-09)*: a `repeat` of `copyTextFrom` over
the reveal's numbered `Text` nodes, accumulating into `output` through `evalScript`, took **4
seconds** for all 24 words with no scrolling and no new app surface. Two Maestro details are
load-bearing if this is ever rewritten — `repeat` has no loop index, so the counter lives in
`output`; and an `evalScript` must contain no `{` or `}`, or `${...}` interpolation truncates it
at the first brace.

✅ **Both at-rest doors are built** *(2026-09-09)* —
`apps/mobile/maestro/e2e/07c-password-door.yaml` (three `testID`s on the gate, after `04`) and
`07b-phrase-door.yaml` (self-contained, last in the arc). Between them they carry every assertion
the two catalog entries ask for, including the right-phrase clause 7c had to hand over. Three Argon2id
passes at ~25s each on the iOS simulator; 2m46s in total. The wrong *phrase* is rejected in
0.12s, because that door unwraps raw key material and derives nothing.

**They found four bugs between them**, all in the pre-database boot path this catalog calls
"the most delicate code in the app", and none of them visible on a screen that looked fine.
**7c's three, on its first green:** the gate never repainted while it derived (a microtask beat
React's commit, so the button read "Unlock" for the whole pass); the phrase field carried no
accessibility identifier for any driver to find (a `multiline` `TextInput` is a `UITextView` on
iOS); and **the phrase door could not be submitted at all**, its keyboard covering **Unlock**
with no way to dismiss it. **7b's one, and it is the one a user meets:** switching doors did not
retract the previous door's error, so the **password** door displayed "That recovery phrase
doesn't open this database." above an empty password field — naming the wrong door at the moment
someone is working out which one they can still answer. Each flow's own header carries the
detail. This is the strongest evidence to date for the rung table's claim that `rc`'s flows are
the ones that prove data comes *back*.

**The column reads as a ratchet on data loss.** A flow gates at the rung by which its failure
would start costing someone something they cannot retype — which is why the *screen* halves of
1 and 4 gate at `beta` (they prove the app does not drop data in ordinary use) while their
out-of-band halves and both doors of 7 wait for `rc` (they prove data comes *back*, which only
matters once someone is relying on it). Beta may be buggy; stable v0.1 may not lose data.

"gate" = must be green before **that platform's own first release**, at the rung the *Gates at*
column names ([`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) →
*The E2E release gate*). ⚠️ **The platform column is not the release schedule, and reading it
as one is the mistake this note exists to prevent.** v0.1 is **iOS alone** — macOS left on
2026-08-26, Android on 2026-09-06, both for reasons unrelated to testing
([`../shipping.md`](../shipping.md) → *Part 2*). Every "gate" above is still owed; it is
owed *when that platform ships*, not before v0.1. Windows/Linux run the identical list once a
host exists (deferred, blocked-not-waived).

**Android is the case worth stating explicitly, because it is counterintuitive**: its flows are
written and green today even though it does not ship in v0.1. Maestro flows are byte-identical
across the two mobile platforms, so they cost nothing to keep and they catch regressions in the
platform that *does* ship. Nothing is being removed from the suite.

## Open decisions — four settled, two left, and neither of the two is v0.1's

Most of this list was answered by building the flows rather than by a sign-off, which is the
usual and better way for a question like this to close.

1. ✅ **Catalog membership** — the seven core flows are confirmed; the rung table in
   [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) → *The E2E release gate* names each rung
   and what it is owed. **Factory reset** is covered incidentally rather than promoted:
   `maestro/subflows/factory-reset.yaml` drives the erase a user performs, as part of the arc.
   The **contact-import drop** leaning was a *desktop* recommendation and left v0.1 with desktop.
   > ⚠️ **Worth revisiting on mobile when the extended list is next opened.** Import is the one
   > path that writes many records at once from data the app did not author, and three real
   > data-fidelity bugs landed in it on 2026-09-06 — found by importing 490 real contacts, not by
   > a test. The unit coverage in `packages/vcard/test/` is good and was not what missed
   > them; what is untested is the screen. Not promoted here, because promoting it is a scope
   > decision and this file is not where scope is set.
2. ✅ **Selector convention** — settled by what shipped: the minimal `testID` anchor set, added
   as flows needed them. `PickerField`'s options grew ids when Gboard's suggestion strip proved
   `below:` was not a reliable separator
   ([`../../apps/mobile/maestro/README.md`](../../apps/mobile/maestro/README.md)).
3. ✅ **The out-of-band custody assertions** — approved, and **built on iOS for Flows 1 and 4**
   *(2026-09-09)*: store custody, store location, roster and doors. The fifth row, the key
   store, is a **decided deferral** rather than an open question — `simctl keychain` has no read
   verb and the surface that would answer it is refused on principle. See *Where these run on
   mobile*.
4. ✅ **Flow-5 inclusion** — confirmed and built. It is in the `beta` bar and green on both
   mobile platforms.
5. **Two-instance harness shape.** How Flows 6/7a run two instances locally: two emulators/sims,
   or one device + a headless second core. **Not v0.1's question** — both flows ship with sync
   (see item 4 above), so settle it when sync is turned on.
6. **Relay for E2E.** Which relay the sync flows point at (an ephemeral local `@leapsake/server`
   boot per run is the vendor-neutral default; confirm). Travels with 5.

## Implementation order — what happened, and what is left

⚠️ **This section used to recommend macOS/Playwright first, and it is worth seeing why that was
wrong rather than just deleting it.** The argument was "cheapest host, fully local, the password
door is already built" — all true, and all beside the point once desktop left v0.1 on 2026-08-26.
The order that actually holds is *the platform that ships first goes first*, and the owner's
release order is **iOS, then Android and macOS, then everything else** *(2026-09-06)*.

What happened instead, and it inverted every step:

1. ✅ **Flows 1–5 on the iOS simulator (Maestro)** *(2026-08-28)*, taking **1 → 4** as a single
   arc, because Flow 4 needs Flows 1–3's data and together they are the whole custody story.
   That much the old order got right.
2. ✅ **The same flows on Android** *(2026-08-28)*, byte-identical, reusing the Maestro harness
   that already ran the driver self-test. The cost was not the YAML — it was the environment:
   three harness bugs on the provisioning path and one real selector fix. See
   [`../../apps/mobile/maestro/README.md`](../../apps/mobile/maestro/README.md).
3. ✅ **Flows 7c and 7b — both at-rest doors** *(2026-09-09, the same day)*. `dev-clear-dbkey`
   and the `RecoveryGate` both already existed, so 7c cost three `testID`s and a flow, exactly as
   priced; it appends to the arc after `04`, inheriting its store, its data and its password.
   Building it settled 7b's shape — not a selector cost but a self-contained flow that creates
   its own account, because the words cannot cross a flow boundary (the ⚠️ above the matrix) —
   and 7b then went green as specified, taking 7c's right-phrase clause with it. **Between them
   they found four bugs in the gate**, all in the pre-database boot path and none visible from a
   passing screen.
4. **Flows 6 + 7a (two-instance sync/recovery)** last, and **not in v0.1 at all**. They carry
   the relay + second-device infrastructure, and the reasoning is settled rather than pending:
   **Flow 6 answers itself** — *enable sync and pair a second device* exercises relay sync, and
   v0.1 ships with `multiDevice` **off**, so a v0.1 user cannot reach that flow at all. Gating a
   release on a path the build does not expose, provable only by flipping a flag production does
   not set, would be theatre; Flow 6 belongs to the release that turns sync **on**, and until
   then the on-state's coverage is [`@leapsake/flags`](../../packages/flags/README.md)'s
   obligation rather than this gate's. **Flow 7a** (cross-device recovery) is the different case:
   it *is* reachable in v0.1 and merely expensive to automate, and what it proves overlaps the
   open merge-by-phrase decision — so decide 7a with that, not with 6.
5. **macOS (Playwright/Electron)** when desktop ships — [`../desktop-packaging.md`](../desktop-packaging.md)
   → A, which the harness needs a packaged `.app` from.

**So the remaining v0.1 E2E gate is one line of release plumbing**: turning `rc`'s catalog
requirement into a `requires:` check rather than a `manual:` sentence in
[`../../scripts/release/targets/ios.mjs`](../../scripts/release/targets/ios.mjs). **Every flow
the `rc` bar names is green on iOS, and so are four of the five custody rows** — the fifth, the
key store, is deferred with its reasons written down under *Where these run on mobile*.

> That one is step 3 of [`../shipping.md`](../shipping.md) → Part 1, the ordered list of
> everything blocking GA. The flow ids here are the stable ones and do not change with that
> doc's renumbering.
