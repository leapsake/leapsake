# Leapsake — The Crucial-Flow Catalog (the E2E keystone)

> **Draft for owner sign-off (2026-07-18).** The single, *tool-agnostic* list of user
> journeys that **every platform's E2E harness implements against the built app**. It is the
> analog, one tier up, of the driver-contract keystone — authored once in plain language so
> Maestro (mobile), Playwright/Electron (desktop), and any future harness encode the *same*
> journeys and can't drift. Keeping it separate from any one tool is the core anti-lock-in move
> ([`strategy.md`](./strategy.md#vendor-neutrality-two-layers-kept-apart)).
>
> Read [`strategy.md` §3](./strategy.md#3-native-platform-e2e-the-release-gate-policy)
> for the gate policy this implements. This file is design, not a status board — when a harness
> lands a flow, record that in [`status.md`](../status.md), keep this stable.

## What this is (and is not)

Each flow asserts on **what's on screen** (principle #3) and drives the **built app** through
its real boundary (principle #4) — never the app's internals, never a mocked engine. The catalog is
**deliberately small**: the driver-contract keystone already proves the engine seam and the
~37 desktop integration suites prove the shared repo/service logic, so E2E only needs to prove
the journeys those tiers *can't* — the ones that only exist once real UI, real OS key storage,
and (for sync) two real devices are wired together. A simulator/emulator/VM is the accepted
approximation ([`strategy.md` §3](./strategy.md#3-native-platform-e2e-the-release-gate-policy)).

**This catalog is authored against the app as actually built**, which forced one substantive
correction to the earlier flow sketch:

> **There is no per-launch local passphrase to "lock/unlock."** The local database key lives in
> OS secure storage (macOS Keychain · iOS/Android secure store) and auto-opens the DB on every
> launch — first run included. A passphrase enters the product in exactly two places: **enabling
> sync** (register/join an account — wraps the master key under the password) and **recovery**
> (the 24-word phrase). So the strawman's flow #2 ("set a passphrase, lock, unlock") does not map
> to a real journey. The **key store** it meant to exercise is instead covered by Flow 5
> (enable-sync writes/reads the keystore) and Flow 6b (the at-rest `RecoveryGate`, which fires
> precisely when the OS key store was reset). Named here so no harness author re-invents a
> passphrase wall the app doesn't have.
>
> ⚠️ **This paragraph has a shelf life** (noted 2026-07-26). The custody decision in
> [`../encryption/model.md`](../encryption/model.md) §7.2–7.3 makes a **lock/unlock journey
> real** — for account holders — and adds two flows this catalog does not yet cover:
> **account creation** (plaintext store → encrypted, plus the phrase shown once) and **lock →
> password → unlock**. It also changes Flow 6's premise: an accountless user will have no
> phrase and no `RecoveryGate` at all. Revisit when the custody slices land
> ([`../status.md`](../status.md) → *Local custody*); until then the paragraph above is still
> accurate to the shipped app.

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
| `home-ready` | Home rendered with content | Flows 4, 5, 8 |
| `sync-status` | sync state text (its label = `off`/`syncing`/`synced`/`error`) | Flow 5 |
| `recovery-phrase` | the 24-word phrase display (label = the words) | Flow 6 |
| `recovery-gate` | the at-rest `RecoveryGate` screen is up | Flow 6b |

Keep this list *small and shared*; everything else asserts on real on-screen labels ("People &
Pets", "Factory reset", "Save your recovery phrase", the person's name, the milestone note).

---

## Core catalog — the v0.1 release gate

Six flows. Each must run **automated and green** on **iOS + Android + macOS** before v0.1
([`strategy.md` §3](./strategy.md#host-matrix-and-v01-scope)). Windows/Linux implement the *same* list later, no changes. Columns:
**Devices** (single vs. the two-instance sync pair), and **Uniquely exercises** (why E2E — the
surface no lower tier reaches).

### Flow 1 — First run reaches a usable empty state

- **Intent:** a fresh install boots all the way to a usable screen with no data — no crash, no
  stuck gate.
- **Preconditions:** clean install, empty OS secure store (no prior enclave key), no DB file.
- **Steps:** launch the built app; wait for boot to settle.
- **Assert:** the Reminders/Home screen is shown in its empty state (`home-empty`); the top nav
  offers **People & Pets** and **Settings**. No `RecoveryGate`.
- **Devices:** single.
- **Uniquely exercises:** the real boot chain end-to-end — OS secure-store *write* of a new
  enclave key, encrypted DB creation, migrations, and the at-rest open path — none of which the
  Node tiers run (they inject a temp-file driver).

### Flow 2 — Create a person and a relationship

- **Intent:** the core write path a human drives.
- **Preconditions:** Flow 1 state (or any booted app).
- **Steps:** add a person "Ada Lovelace"; add a second person "Augustus De Morgan"; from one
  person, add a relationship linking them (pick a role).
- **Assert:** both appear in **People & Pets**; opening Ada shows the relationship to Augustus
  with the chosen role rendered.
- **Devices:** single.
- **Uniquely exercises:** the renderer form → IPC/core → repo → encrypted write → re-read →
  render loop through the *real* UI (the whole renderer/component layer that has **no** test
  today at any tier).

### Flow 3 — Record a milestone

- **Intent:** the encrypted per-item content-key path, end to end, as a user sees it.
- **Preconditions:** at least one person (Flow 2).
- **Steps:** open a person; add a milestone with a date and a note ("Met at the Analytical
  Engine talk").
- **Assert:** the milestone and its note render on the person's timeline; relaunch (or navigate
  away and back) and the note still reads correctly.
- **Devices:** single.
- **Uniquely exercises:** the per-item content-key encrypt→store→fetch→decrypt→render path in
  the production runtime — the relaunch assertion proves the content key round-trips through real
  storage, not just an in-memory session.

### Flow 4 — Reminder with an `@mention` and a `#tag` (Home round-trip)

- **Intent:** the newest and most UI-dense surface — the Home screen plus the mention/tag
  authoring pickers and their two-way backlinks — which currently has **zero** automated
  coverage below E2E (the pure helpers are unit-tested in `packages/schema`, but
  `MentionTextField` / `ReminderForm` on both clients are not).
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

### Flow 5 — Enable sync and pair a second device

- **Intent:** the multi-device join that integration tests can only approximate (they wire two
  engines to one in-process relay; this drives two *real app instances* through the real UI and
  key store).
- **Preconditions:** a reachable relay (local/self-hosted — the execution layer is swappable,
  [`strategy.md` §3](./strategy.md#vendor-neutrality-two-layers-kept-apart)); Device A holds data (run Flows 2–3 first).
- **Steps:** **Device A** → Settings → **Set up or log in to sync** → register a username +
  password (≥12 chars). **Device B** (fresh install) → Settings → same entry → log in with that
  username + password.
- **Assert:** A's `sync-status` reaches `synced`; on **B**, the person and milestone A created
  appear on screen after convergence.
- **Devices:** **two instances** (two emulators/sims, or two macOS app instances with separate
  data dirs).
- **Uniquely exercises:** OS secure-store *and* relay together — register wraps the master key
  under the password and stores it; join unwraps it on a second device — plus real
  push/pull convergence over the wire. This is the flow the strawman's "key store" concern really
  lives in.

### Flow 6 — Recovery phrase (two variants)

The app has two distinct recovery journeys; **both** gate. They share the phrase but exercise
different entry points.

**6a — Cross-device recovery (forgot password).**
- **Steps:** on a synced account (Flow 5), reveal the 24-word phrase (Settings → **Recovery
  phrase** → **Save your recovery phrase**); on a **fresh** Device C, choose recover-by-phrase,
  enter the words, set a new password.
- **Assert:** C reads the account's data after recovery; the *wrong* phrase is rejected with a
  visible error (do not leave this negative case out — it's the one that proves the check is real).
- **Devices:** two (a synced account + a fresh device).
- **Uniquely exercises:** phrase reveal UI + the relay recovery/password-reset path in the real
  runtime.

**6b — At-rest local recovery (`RecoveryGate`).**
- **Steps:** on a device with data, reveal + record the phrase, then simulate an OS-key-store
  reset (the harness clears the enclave key — the `dev-clear-dbkey` route already exists for
  exactly this) and relaunch; the boot gate shows `RecoveryGate` ("Restore access to your data");
  enter the phrase → **Unlock**.
- **Assert:** the app opens to the existing data; a wrong phrase re-enables the form with an
  error.
- **Devices:** single.
- **Uniquely exercises:** the boot-time `RecoveryGate` and the `.recovery` sidecar unwrap — the
  local-only backup story (no lower tier boots through this gate). *This is the flow that
  substitutes for the strawman's "unlock" — it's the only real unlock the app has.*

---

## Extended / candidate flows (confirm or defer — not in the v0.1 gate unless promoted)

Strong E2E value and all currently untested at the UI level, but promote **deliberately** (the
tier stays small). Listed so the owner can pull any into the gate:

- **Contact import.** Desktop: drop a `.vcf` → review modal → import → people appear (exercises
  `DropImportProvider` + the review modal, untested UI over a well-tested package). Mobile:
  import from device contacts (`import.tsx`; `device-contacts` is unit-tested, the screen isn't).
  *Recommendation: promote at least the desktop drop path — it's a headline surface with a whole
  untested overlay.*
- **Factory reset.** Settings → **Factory reset** → type the confirm phrase → data cleared, app
  returns to the empty state (or re-onboards). Recent, untested at the UI level; also the natural
  teardown between other E2E runs.
- **Search.** Global search bar → type a person's name → result appears → navigate to them.
  Cheap, exercises the search service through the real UI.
- **Reminder completion / due date.** Complete a reminder (reversible) and set a due date;
  assert the state change on Home. Rounds out Flow 4's surface.

---

## Per-platform × per-flow matrix (the gate at a glance)

| Flow | macOS | Android | iOS | Win/Linux | Devices | Harness notes |
|---|---|---|---|---|---|---|
| 1 First run | gate | gate | gate | later | 1 | fresh install + empty keystore per run |
| 2 Person + relationship | gate | gate | gate | later | 1 | — |
| 3 Milestone | gate | gate | gate | later | 1 | relaunch to prove persistence |
| 4 Reminder @/# round-trip | gate | gate | gate | later | 1 | drives the compose pickers |
| 5 Enable sync + pair | gate | gate | gate | later | **2** | needs a relay + two instances |
| 6a Cross-device recovery | gate | gate | gate | later | 2 | includes wrong-phrase negative |
| 6b At-rest RecoveryGate | gate | gate | gate | later | 1 | uses `dev-clear-dbkey` to reset key |

"gate" = must be green before v0.1 on that platform ([`strategy.md` §3](./strategy.md#host-matrix-and-v01-scope): iOS + Android + macOS).
Windows/Linux run the identical list once a host exists (deferred, blocked-not-waived).

## Open decisions for owner sign-off

1. **Catalog membership.** Confirm the six core flows; decide which (if any) **extended** flows
   are promoted into the v0.1 gate (leaning: promote desktop **contact-import drop**).
2. **Selector convention.** Approve the minimal stable-anchor set + the shared `testID` /
   `data-testid` token scheme (above), or mandate pure visible-text assertions.
3. **Flow-4 inclusion.** Confirm adding the reminder/mention/tag round-trip — it's *not* in the
   strawman but it's the newest, most UI-heavy untested surface, so it earns strong E2E value.
   Trim if the owner considers reminders not yet launch-critical.
4. **Two-instance harness shape.** How Flows 5/6a run two instances locally: two emulators/sims,
   or one device + a headless second core. This is the one real infrastructure question the sync
   flows raise; settle before implementing them (Flows 1–4, 6b are single-instance and can land
   first).
5. **Relay for E2E.** Which relay the sync flows point at (an ephemeral local `@leapsake/server`
   boot per run is the vendor-neutral default; confirm).

## Recommended implementation order

Single-instance flows first (they need no relay and no second device), on the cheapest host:

1. **Flows 1–4 + 6b on macOS (Playwright/Electron)** — fully local, unblocked today. Proves the
   catalog and the harness before any two-instance work.
2. **The same flows on Android, then iOS** — reusing the Maestro harness that already runs the
   driver self-test.
3. **Flows 5 + 6a (two-instance sync/recovery)** last on each platform — they carry the relay +
   second-device infrastructure, so land them once the single-instance catalog is green.

Closing Flows 1–6 on macOS + Android + iOS **is** the v0.1 E2E gate.
