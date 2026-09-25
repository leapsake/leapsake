# Leapsake — The Crucial-Flow Catalog (the E2E keystone)

> The single, _tool-agnostic_ list of user journeys that **every platform's E2E harness
> implements against the built app**. It is the analog, one tier up, of the driver-contract
> keystone: authored once in plain language so Maestro (mobile), Playwright/Electron (desktop),
> and any future harness encode the _same_ journeys and cannot drift. Keeping it separate from
> any one tool is the core anti-lock-in move. The gate policy this implements, and the rung each
> flow is owed by, is [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) → _The E2E release gate_.
>
> **This file is design, not a status board.** Which flows a harness has landed is visible in
> the harness (`apps/mobile/maestro/e2e/`); how it drives them is
> [`apps/mobile/maestro/README.md`](../../apps/mobile/maestro/README.md). Keep this stable.

## What this is (and is not)

Each flow asserts on **what's on screen** and drives the **built app** through its real
boundary: never the app's internals, never a mocked engine. The catalog is **deliberately
small**: the driver-contract keystone proves the engine seam and the desktop integration suites
prove the shared repo/service logic, so E2E proves only what the rule below admits. A
simulator/emulator/VM is the accepted approximation.

## What earns a flow here

A flow is expensive: minutes per run, per platform, and a class of flake no lower tier has. So
a journey is **crucial** only when both hold:

1. **Its claim is about the seam between the app and the real runtime**: the OS key store, the
   native SQLite engine, a process relaunch, the app surviving its own store being replaced,
   the pre-database boot path, or (with sync) two real devices.
2. **If it broke, someone would lose data or could not open the app.**

And three rules for what a flow contains:

- **One happy path per seam.** Negative cases and branches go one tier down, where they cost
  milliseconds. A flow keeps a negative only when the rejection itself happens at the seam.
- **"No lower tier can reach it" is a reason to make it reachable, not to write a flow.**
  Extract the logic behind a port, test it there, and let the flow prove only the wiring.
  Otherwise every line written somewhere hard to test becomes E2E's to carry.
- **A flow that no runner runs is not a test.** Anything under `apps/mobile/maestro/` that
  `pnpm test:e2e` or `pnpm test:native` does not invoke is a scratch flow, and scratch flows
  are not committed.

Screen behaviour that fails neither test (a form's state rules, which query a screen calls,
navigation configuration) belongs in a hook test, an integration test, or a test over the
configuration. Checking it on a simulator once, with a scratch flow, is fine.

**This catalog is authored against the app as actually built.** Two consequences a harness
author will otherwise get wrong:

> **There is no per-launch passphrase wall, and a fresh install has no secrets at all.** Under
> _encryption follows custody_ ([`@leapsake/key-custody`](../../packages/key-custody/README.md))
> a first launch is **Unauthenticated**: it mints no keys, leaves the OS key store empty, and
> opens a **plaintext** store. **Creating an account, username + password, is the single act
> that turns encryption on**, converting the store as it goes and showing the 24-word recovery
> phrase once. So the journey to exercise is not "set a passphrase, lock, unlock" but
> **Unauthenticated → account → Authenticated** (Flow 4), plus the two doors that reopen an
> Authenticated store when the OS key store is lost (Flow 4's closing acts).

> **The recovery phrase is shown once and is never re-viewable.** There is no "reveal my phrase"
> surface; a holder who loses it rotates to a new one behind re-auth. **Every flow that needs
> the phrase must capture it at the moment it is shown**, and, because a capture cannot leave
> the flow that made it (see _The phrase-capture rule_ below), **must itself be the flow that
> reaches that moment**. This is the single most likely way to write a flow that passes today
> and rots tomorrow.

## Asserting on custody: the one deliberate exception to "assert on screen"

Custody's defining properties are **invisible**. "The store is ciphertext", "the key store is
empty", "the plaintext original is gone" cannot be read off any screen, and a flow that only
checks the UI would pass against an app that encrypted nothing. So the custody flows (1, 4, 6,
7) are permitted a **bounded set of out-of-band assertions against the test profile on disk**:

| Check          | How                                                                                                                                      | Meaning                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Store custody  | first 16 bytes are SQLite's `SQLite format 3\0` magic, or are not                                                                        | plaintext vs. encrypted, the same test the app's own `storeFileState` makes                                 |
| Key material   | count/keys of the profile's OS key store (desktop `keystore.json`; mobile the secure store)                                              | Unauthenticated holds **zero**; Authenticated holds the db-key, enclave secret, recovery key, device id     |
| Store location | the store's path within the profile                                                                                                      | `stores/local/` when Unauthenticated, `stores/<accountId>/` when Authenticated                              |
| Roster         | desktop a plain JSON file under `userData`; **mobile the `roster` table in `leapsake-roster.db`**                                        | zero accounts when Unauthenticated, exactly one after creation                                              |
| Doors          | desktop the `<db>.recovery` **and** `<db>.password` files; **mobile the two `kind` rows (`password`, `recovery`) in `stores/<accountId>/doors.db`** | the two doors Flow 4's closing acts exercise exist                                               |

The last two rows are shaped differently on each client. Both are right; they store the same
facts differently, and a harness author who goes looking for mobile `.recovery` files finds
nothing and concludes the door is missing.

**Rules, so this stays an exception and not a habit.** These are _file existence and shape_
checks only: never open the store, never decrypt, never call into app code. They are permitted
only in the flows named above, and only **in addition to** an on-screen assertion, never instead
of one. Every other flow asserts purely on visible text.

**The key-store row is a decided deferral on mobile.** `xcrun simctl keychain` has no read verb,
and the one surface that would answer it, an in-app inspection screen, is refused on principle: an
app reporting "I am encrypted" is the evidence an encrypting-nothing build would also produce.
What stands in for it is Flow 1's on-screen absence of the gate and Flow 4's **ciphertext
store**, which a build that minted no keys could not produce. Revisit if a read verb appears or
the harness gains a host-side keychain reader. The mobile implementation and its negative cases
are `scripts/lib/custody-assertions.mjs` and
[`apps/mobile/maestro/README.md`](../../apps/mobile/maestro/README.md) → _The out-of-band half_.

## Selectors: visible text by default, a minimal shared anchor set for the rest

Assert on visible text. A few assertion points are text-ambiguous (empty-state vs. loading, the
phrase display, a gate with no text of its own), and keying those on incidental copy makes flows
brittle, so those get a **minimal, named** set of stable anchors: **`testID` on React Native,
`data-testid` on the desktop DOM, identical token strings across both clients** so one catalog
line targets both. Add them as flows need them, not upfront.

| Anchor token      | Marks                                                            | Used by |
| ----------------- | ---------------------------------------------------------------- | ------- |
| `recovery-gate`   | the at-rest boot gate is up                                      | Flow 4  |
| `recovery-secret` | the box around the gate's secret field, whichever door is showing | Flow 4  |
| `recovery-submit` | the gate's **Unlock** button                                     | Flow 4  |

The gate hosts two doors (password, phrase); flows pick a door by its visible label and the
switch links, and the three anchors cover only what labels cannot: a container with no text, a
field no selector can reach (`secureTextEntry` on one door has empty accessibility text;
`multiline` on the other is a `UITextView` carrying no identifier, so the anchor goes on a
wrapper), and a button whose label (`Unlock`) is a prefix of the screen's title and flips to
`Checking…` mid-submit. **There is deliberately no `recovery-phrase` anchor**: the phrase is
never exposed as a single string anywhere in the app, and the flows read the 24 numbered words
instead. Keep the list small; everything else asserts on real labels ("People & Pets", "Factory
reset", "Save your recovery phrase", the person's name, the milestone label).

---

## Core catalog — the v0.1 release gate

Four flows; Flow 7a waits on sync. Each must run **automated and green** on a platform
before that platform's first release, at the rung CONTRIBUTING's rung table names. Columns:
**Devices** (single vs. the two-instance sync pair), and **Uniquely exercises** (why E2E: the
surface no lower tier reaches).

### Flow 1 — First run reaches a usable empty state, and mints nothing

- **Intent:** a fresh install boots all the way to a usable screen with no data, no account,
  and **no key material anywhere**: no crash, no stuck gate, no ceremony.
- **Preconditions:** clean install: empty OS key store, no store file, no roster.
- **Steps:** launch the built app; wait for boot to settle.
- **Assert (on screen):** Home is reached. Home is **not** empty on a first run: the reminders
  engine mints a getting-started nudge whenever the store holds no entities, so assert that
  nudge's own text, which is both true of the build and stronger (it proves the engine
  reconciled). The app's standing navigation offers a way to **People & Pets** and to
  **Settings**; assert **reachability**, not tab labels, since the shell's shape is the
  platform's own and is asserted elsewhere. No `recovery-gate`. Settings offers to create an
  account and shows **no** recovery-phrase surface.
- **Assert (out of band):** the store is **plaintext** and sits at `stores/local/`; the OS key
  store holds **zero** Leapsake entries; the roster holds zero accounts; neither door exists.
- **Devices:** single.
- **Uniquely exercises:** the Unauthenticated boot path, whose defining property is an
  _absence_ no lower tier can prove, because they all inject a fake key store. This is the flow
  that would catch a regression re-introducing first-launch key minting.

### Flow 2 — The everyday arc, across a relaunch (smoke)

- **Intent:** the write paths a human drives every day, proven to survive a real restart.
- **Preconditions:** Flow 1 state (or any booted app).
- **Steps:** add "Mary Bailey" and "George Bailey"; from Mary, add a relationship to George
  (pick a role); add a milestone to Mary with a year and a note ("Met at the Analytical Engine
  talk"); create a reminder whose body `@`-mentions Mary through the picker and types a
  `#birthday` tag; **relaunch the app**.
- **Assert:** after the relaunch, the reminder is on Home and its detail renders the `@Mary
  Bailey` mention and the `#birthday` tag; both people appear in **People & Pets**; Mary's page
  shows the relationship to George with its role, and the milestone's year; the note reads back
  out of the milestone's edit form (the person page never renders a note, and the edit form
  proves more: the value came out of storage and back into a field).
- **Devices:** single.
- **Uniquely exercises:** form → core → store → **relaunch** → read → render through the real
  UI in the production runtime, and the native text input the `@` splice drives. The backlink
  screens (Mary's mentions, the tag's page) are integration territory and are not re-proven here.
- **Note:** the milestone note is an ordinary **plaintext column**; the per-item content-key
  path has no domain-field consumer. Layer 3 returns with photos (v0.2) and gets its own flow
  then; do not read this flow as proving content-key encryption.

### Flow 4 — Create an account: the act that turns encryption on

- **Intent:** the custody keystone. An Unauthenticated store with real data becomes an
  Authenticated one, in place, without losing a row and without the app falling over as its own
  store is replaced underneath it.
- **Preconditions:** an Unauthenticated store **with data** (Flows 1–2). Converting an empty
  store proves nothing; the data is the point.
- **Steps:** Settings → create an account → username + password (≥12 chars) → submit. The
  24-word phrase is shown once: capture it, then tick **I've saved my recovery phrase** →
  **Done**. Then the two door acts, each starting from a simulated OS key-store reset that loses
  the db-key alone (desktop: delete it from `keystore.json`; mobile: the `dev-clear-dbkey`
  route) and a relaunch into the boot gate (`recovery-gate`, "Unlock your data"):
  1. **The password door:** enter the account password → **Unlock**.
  2. **The phrase door:** choose **Forgot your password?**, enter the captured phrase →
     **Unlock**. It runs second because the password unlock reseals the recovery door, so
     this act also proves the resealed door opens.
- **Assert (on screen):** the phrase renders as 24 numbered words; while it is up the app chrome
  is **not** reachable, so it cannot be dismissed by an accidental navigation; after **Done** the
  app **continues in place, no restart, no blank window**, and Mary plus her milestone from
  Flow 2 are still on screen and still readable; Settings now reports the account; the phrase
  is **not** offered anywhere again. After each door act, the gate is gone and Mary with her
  milestone is readable again.
- **Assert (out of band):** the store is now **ciphertext** at `stores/<accountId>/`; the
  Unauthenticated store at `stores/local/` is **gone** (the file; the directory may remain); the
  roster holds exactly one account; the OS key store now holds the db-key, enclave secret,
  recovery key and device id; both doors exist (see the custody table for each client's shape).
- **Devices:** single.
- **Uniquely exercises:** the plaintext→encrypted conversion of a _live_ store with real rows,
  driven through the real UI, plus the OS key store's transition from empty to populated. Both
  clients' converters are covered a tier down; what only E2E proves is that the **running app**
  survives its own store being swapped and remains usable immediately afterwards. The door acts
  add the one thing no lower tier boots through: the pre-database gate opening a real store in
  the real runtime, by each door. Their wrong-secret cases are one tier down
  (`packages/key-custody/test/unlock.test.ts`, `apps/mobile/lib/use-recovery-gate.test.ts`), and
  the recovery-door reseal rule is `apps/mobile/lib/open-active-store.test.ts`'s.

### Flow 7 — Cross-device recovery (forgot password)

The at-rest doors, once variants 7b and 7c, are Flow 4's closing acts. What remains here is the
door that needs a second device.

**7a.** Nothing in the build reaches this until the relay half of the clients returns in v0.2;
its steps are written against those flows.

- **Steps:** on a synced account, take the phrase captured there to a **fresh** Device C;
  choose recover-by-phrase; enter the words; set a new password.
- **Assert:** C reads the account's data after recovery, and is forced to set a new password in
  the process; the _wrong_ phrase is rejected with a visible error before anything is written.
- **Devices:** two (a synced account + a fresh device).
- **Uniquely exercises:** the relay recovery/password-reset path in the real runtime.

### The phrase-capture rule

Every flow that opens the phrase door needs words shown exactly once, on the reveal. **A flow
cannot hand them to another flow**: each flow is its own harness process, so captured text dies
with it, and the reveal's own **Copy** button does not bridge it either, because the driver's
paste replays its own captured text rather than reading the device pasteboard. **So the flow
that needs the words must be the flow that watched them appear**, which is why the doors are
Flow 4's acts rather than flows of their own. How the capture is done, and the driver quirks it
depends on, is [`apps/mobile/maestro/README.md`](../../apps/mobile/maestro/README.md) →
_Capturing a secret the app shows once_.

---

## Extended / candidate flows (not in the v0.1 gate unless promoted)

Each of these passes _What earns a flow here_, but promote **deliberately**. The tier stays
small, and promoting is a scope decision made in [`../shipping.md`](../shipping.md), not here.
Search and reminder completion do not belong here: a broken one loses no data, so they are
integration-tier work.

- **Contact import.** Desktop: drop a `.vcf` → review modal → import → people appear. Mobile:
  import from device contacts (`import.tsx`). Import is the one path that writes many records at
  once from data the app did not author, and its real data-fidelity bugs were found by importing
  hundreds of real contacts rather than by a test; the package coverage is good and was not what
  missed them. What is untested is the screen.
- **Factory reset.** Settings → **Factory reset** → type the confirm phrase → data cleared, the
  app returns **in place** to a first-run Unauthenticated state, key store emptied, roster
  cleared. Covered incidentally today by the mobile arc's `factory-reset` subflow rather than as
  a flow of its own.
- **Sign out → sign back in.** Sign out closes the store; signing back in with the password
  reopens it. The deliberate half of locking; the automatic/idle half is v0.2.
- **Rotate the recovery phrase** (once built). Re-auth → new phrase shown once → the old phrase
  no longer opens the store. Until each device re-adopts the new key, the old phrase still opens
  _that_ device's sidecar, so the assertion is per-device, not per-account.

---

## Per-platform × per-flow matrix

| Flow                                       | Gates at                            | macOS | Android | iOS  | Win/Linux | Devices | Harness notes                                                                          |
| ------------------------------------------ | ----------------------------------- | ----- | ------- | ---- | --------- | ------- | -------------------------------------------------------------------------------------- |
| 1 First run (Unauthenticated, mints nothing) | **beta** (screen) · rc (out-of-band) | gate  | gate    | gate | later     | 1       | fresh profile per run                                                                  |
| 2 Smoke, across a relaunch                 | **beta**                            | gate  | gate    | gate | later     | 1       | replaces Flows 2, 3 and 5 of the old arc                                               |
| 4 Create an account                        | **beta** (screen) · rc (out-of-band) | gate  | gate    | gate | later     | 1       | must run on a store **with** data; ends with both door acts                           |
| 7a Cross-device recovery                   | with sync (v0.2)                    | gate  | gate    | gate | later     | 2       | includes the wrong-phrase negative                                                     |

**"Gates at"** is the rung by which a flow must be green, per CONTRIBUTING's rung table. It
grades _when_, never _whether_: every core flow still gates v0.1, and `rc` is inside v0.1. The
column reads as a ratchet on data loss: every on-screen flow, Flow 4's door acts included, gates
at `beta`, since the runner runs the whole arc at every rung; the out-of-band halves of 1 and 4
wait for `rc`.

**"gate"** means green before **that platform's own first release**. ⚠️ **The platform column is
not the release schedule.** v0.1 is iOS alone; every macOS and Android "gate" is still owed, but
_when that platform ships_. Android's flows are byte-identical to iOS's and stay green in the
suite even though Android does not ship in v0.1, because they cost nothing and catch regressions
on the platform that does. Windows/Linux run the identical list once a host exists.

## Open

1. **Two-instance harness shape.** How Flows 6/7a run two instances locally: two emulators/sims,
   or one device + a headless second core. Settle it when sync returns; it travels with the
   merge-by-phrase decision in [`../shipping.md`](../shipping.md) → _Open_.
2. **Relay for E2E.** Which relay the sync flows point at (an ephemeral local `@leapsake/server`
   boot per run is the vendor-neutral default; confirm). Travels with 1.

## What is left to build against this catalog

- **The `rc` gate as a check, not a sentence:** the tag-triggered pipeline in
  [`../fable-investigation/remote-releases.md`](../fable-investigation/remote-releases.md)
  carries the catalog itself, which is what retires the `manual:` note on the iOS `rc` rung.
- **Flow 7a** with sync (v0.2). **macOS** when desktop ships:
  [`../desktop-packaging.md`](../desktop-packaging.md) → D.
