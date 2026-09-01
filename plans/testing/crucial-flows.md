# Leapsake — The Crucial-Flow Catalog (the E2E keystone)

> **Draft for owner sign-off** (first drafted 2026-07-18; **rewritten 2026-07-28** against the
> *encryption follows custody* model). The single, *tool-agnostic* list of user journeys that
> **every platform's E2E harness implements against the built app**. It is the analog, one tier
> up, of the driver-contract keystone — authored once in plain language so Maestro (mobile),
> Playwright/Electron (desktop), and any future harness encode the *same* journeys and can't
> drift. Keeping it separate from any one tool is the core anti-lock-in move
> ([`../v0-1_06_e2e-and-release-gate.md`](../v0-1_06_e2e-and-release-gate.md) → *The release-gate policy*).
>
> Read [`../v0-1_06_e2e-and-release-gate.md`](../v0-1_06_e2e-and-release-gate.md) → *The release-gate policy*
> for the gate policy this implements. This file is design, not a status board — when a harness
> lands a flow, record that in [`status.md`](../status.md), keep this stable.

## What this is (and is not)

Each flow asserts on **what's on screen** (principle #3) and drives the **built app** through
its real boundary (principle #4) — never the app's internals, never a mocked engine. The catalog is
**deliberately small**: the driver-contract keystone already proves the engine seam and the
~37 desktop integration suites prove the shared repo/service logic, so E2E only needs to prove
the journeys those tiers *can't* — the ones that only exist once real UI, real OS key storage,
and (for sync) two real devices are wired together. A simulator/emulator/VM is the accepted
approximation ([`../v0-1_06_e2e-and-release-gate.md`](../v0-1_06_e2e-and-release-gate.md) → *The release-gate policy*).

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
> is shown** (Flow 4 or Flow 6) and carry it forward. This is the single most likely way to
> write a flow that passes today and rots tomorrow.

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
| Roster | `accounts.json` | zero accounts when Unauthenticated, exactly one after creation |
| Sidecar | `<db>.recovery` **and** `<db>.password` presence | the two doors Flow 7 exercises exist |

**Rules, so this stays an exception and not a habit.** These are *file existence and shape*
checks only — never open the store, never decrypt, never call into app code. They are permitted
only in the flows named above, and only **in addition to** an on-screen assertion, never instead
of one. Every other flow asserts purely on visible text.

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

| Anchor token | Marks | Used by |
|---|---|---|
| `home-empty` | Reminders/Home empty-state reached, boot done | Flow 1 |
| `home-ready` | Home rendered with content | Flows 5, 6 |
| `sync-status` | sync state text (its label = `off`/`syncing`/`synced`/`error`) | Flow 6 |
| `recovery-phrase` | the one-time 24-word phrase display (label = the words) | Flows 4, 6, 7 |
| `recovery-gate` | the at-rest boot gate is up | Flow 7 |

The gate hosts two doors (password, phrase); one anchor covers it and the flows target each door
by its visible label. Keep this list *small and shared*; everything else asserts on real
on-screen labels ("People & Pets", "Factory reset", "Save your recovery phrase", "Unlock", the
person's name, the milestone note).

---

## Core catalog — the v0.1 release gate

Seven flows (Flow 7 has three variants). Each must run **automated and green** on **iOS +
Android + macOS** before v0.1
([`../v0-1_06_e2e-and-release-gate.md`](../v0-1_06_e2e-and-release-gate.md) → *The release-gate policy*). Windows/Linux implement the *same* list later, no changes. Columns:
**Devices** (single vs. the two-instance sync pair), and **Uniquely exercises** (why E2E — the
surface no lower tier reaches).

### Flow 1 — First run reaches a usable empty state, and mints nothing

- **Intent:** a fresh install boots all the way to a usable screen with no data, no account,
  and **no key material anywhere** — no crash, no stuck gate, no ceremony.
- **Preconditions:** clean install: empty OS key store, no store file, no roster.
- **Steps:** launch the built app; wait for boot to settle.
- **Assert (on screen):** ⚠️ *corrected 2026-08-28 — Home is **not** empty on a first run:
  the reminders engine mints the `add-first-person` onboarding nudge whenever the store holds
  no entities, so `01-first-run.yaml` asserts that nudge's own text instead, which is both
  true of the build and stronger (it proves the engine reconciled). The gate's title is also
  "Unlock your data", not the wording below.* The Reminders/Home screen is reached;
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
  store holds **zero** Leapsake entries; the roster holds zero accounts; no `.recovery` sidecar.
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
  now holds the db-key, enclave secret, recovery key and device id; the `.recovery` sidecar
  exists.
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
  [`../v0-1_06_e2e-and-release-gate.md`](../v0-1_06_e2e-and-release-gate.md) → *The release-gate policy*); Device A holds data (run Flows 2–3 first) and is still **Unauthenticated**.
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

**Every variant depends on a phrase captured during Flow 4 or Flow 6.** There is no
reveal-in-Settings to fall back on.

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
  gate appears (`recovery-gate`, "Restore access to your data"); enter the phrase → **Unlock**.
- **Assert:** the app opens to the existing data; a wrong phrase re-enables the form with an
  error and leaves the sidecar intact (a second attempt with the right phrase still works —
  assert that, or the "corrupts nothing" claim is untested).
- **Devices:** single.
- **Uniquely exercises:** the boot-time gate and the `.recovery` sidecar unwrap — the local-only
  backup story. No lower tier boots through this gate.

**7c — At-rest local recovery, password door.**
- **Steps:** the same key-store reset, answered with the **account password** instead of the
  phrase.
- **Assert:** the app opens to the existing data; a wrong password re-enables the form with an
  error and consumes nothing; afterwards the *phrase* door still works (the doors are
  independent — prove it, since a shared-state bug here is invisible until someone needs the
  second door).
- **Devices:** single.
- **Uniquely exercises:** the password sidecar in the pre-database boot path. This is the door
  that makes an org-move Team-ID change cost one password entry instead of a phrase hunt
  ([`../../packages/key-custody/README.md`](../../packages/key-custody/README.md)), and it is the most delicate code in the app: it runs
  before the database opens, so a bug is not a failed query but an app that cannot start.
- **Note:** this variant covers the automated half of [`../v0-1_06_e2e-and-release-gate.md`](../v0-1_06_e2e-and-release-gate.md)
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
| 1 First run (Unauthenticated, mints nothing) | **beta** (screen) · rc (out-of-band) | gate | gate | gate | later | 1 | fresh profile per run; asserts the key store is empty |
| 2 Person + relationship | **beta** | gate | gate | gate | later | 1 | — |
| 3 Milestone | **beta** | gate | gate | gate | later | 1 | relaunch to prove persistence |
| 4 Create an account | **beta** (screen) · rc (out-of-band) | gate | gate | gate | later | 1 | must run on a store **with** data; the phrase capture 7b needs is **not yet built** — see below |
| 5 Reminder @/# round-trip | **beta** | gate | gate | gate | later | 1 | drives the compose pickers |
| 6 Enable sync + pair | with sync (v0.2) | gate | gate | gate | later | **2** | needs a relay + two instances; Flow 4's assertions apply to A |
| 7a Cross-device recovery | with sync (v0.2) | gate | gate | gate | later | 2 | includes wrong-phrase negative |
| 7b At-rest, phrase door | **rc** | gate | gate | gate | later | 1 | key-store reset: delete `keystore.json` / `dev-clear-dbkey`. **Carries the phrase-capture cost** |
| 7c At-rest, password door | **rc** | gate | gate | gate | later | 1 | same reset, password answer; prove both doors independent |

**"Gates at"** is the release rung by which a flow must be green, per
[`../v0-1_06_e2e-and-release-gate.md`](../v0-1_06_e2e-and-release-gate.md) → §C's rung table
*(settled 2026-08-28 — [`../v0-1.md`](../v0-1.md) → open decision 1)*. It grades
*when*, never *whether*: every core flow still gates v0.1, and `rc` is inside v0.1. Flows 6/7a are
the exception and leave v0.1 entirely, per open decision 2.

⚠️ **The phrase capture is the one unbuilt prerequisite in this table** *(checked 2026-08-28)*.
Every variant of Flow 7 "depends on a phrase captured during Flow 4 or Flow 6", and Flow 4 as
built does **not** capture it — it asserts the grid has a 24th word and no 25th, which is all
the `beta` bar asks. The reveal renders the words as 24 separately-numbered `Text` nodes, so
capture means 24 `copyTextFrom` calls stitched together, or a new surface exposing the phrase
as one string, which the no-new-app-surface rule would have to be argued past. **Price it into
7b, not into Flow 4.** 7c escapes it entirely: the password door is answered with the password
Flow 4 already typed, and both `dev-clear-dbkey` and the `RecoveryGate` are already built — it
needs three `testID`s on the gate and a flow. **If only one door can be afforded at `rc`, 7c is
the cheaper one and 7b is the one that covers the harder case.**

**The column reads as a ratchet on data loss.** A flow gates at the rung by which its failure
would start costing someone something they cannot retype — which is why the *screen* halves of
1 and 4 gate at `beta` (they prove the app does not drop data in ordinary use) while their
out-of-band halves and both doors of 7 wait for `rc` (they prove data comes *back*, which only
matters once someone is relying on it). Beta may be buggy; stable v0.1 may not lose data.

"gate" = must be green before v0.1 on that platform ([`../v0-1_06_e2e-and-release-gate.md`](../v0-1_06_e2e-and-release-gate.md) → *The release-gate policy*: iOS + Android + macOS).
Windows/Linux run the identical list once a host exists (deferred, blocked-not-waived).

## Open decisions for owner sign-off

1. **Catalog membership.** Confirm the seven core flows; decide which (if any) **extended** flows
   are promoted into the v0.1 gate (leaning: promote desktop **contact-import drop**, and
   **factory reset** now that it shares the reopen-in-place path with Flow 4).
2. **Selector convention.** Approve the minimal stable-anchor set + the shared `testID` /
   `data-testid` token scheme (above), or mandate pure visible-text assertions.
3. **The out-of-band custody assertions.** Approve the bounded file/key-store checks in the table
   above, or rule that E2E asserts only on screen — in which case say explicitly which lower tier
   owns "the store is actually ciphertext", because today no tier proves it against the built app.
4. **Flow-5 inclusion.** Confirm the reminder/mention/tag round-trip — the newest, most UI-heavy
   untested surface. Trim if reminders are not yet launch-critical.
5. **Two-instance harness shape.** How Flows 6/7a run two instances locally: two emulators/sims,
   or one device + a headless second core. The one real infrastructure question the sync flows
   raise; settle before implementing them (Flows 1–5, 7b, 7c are single-instance and land first).
6. **Relay for E2E.** Which relay the sync flows point at (an ephemeral local `@leapsake/server`
   boot per run is the vendor-neutral default; confirm).

## Recommended implementation order

Single-instance flows first (they need no relay and no second device), on the cheapest host:

1. **Flows 1–5 + 7b, 7c on macOS (Playwright/Electron)** — fully local and unblocked; the
   password door is built. Proves the catalog and the harness before any two-instance work. Take
   **1 → 4** as a single arc: Flow 4 needs Flows 1–3's data, and together they are the whole
   custody story.
2. **The same flows on Android, then iOS** — reusing the Maestro harness that already runs the
   driver self-test.
3. **Flows 6 + 7a (two-instance sync/recovery)** last on each platform — they carry the relay +
   second-device infrastructure, so land them once the single-instance catalog is green.

Closing Flows 1–7 on macOS + Android + iOS **is** the v0.1 E2E gate.
