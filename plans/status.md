# Leapsake — Status & Next Steps (the single oracle)

> **This is the one file that tracks status across every workstream.** Picking up work?
> Read this file for *what to do next*, then the relevant design doc for the *why*.
> The history of a **finished** increment lives in `git log` + the code's own doc-comments,
> not here. Design docs never restate status; this file never restates design.
>
> **Updated 2026-07-28** — **"Encryption follows custody" is now the shipped behavior on both
> clients.** First launch mints **no keys** and leaves the store plaintext; creating an
> account (username + password) is the single act that turns encryption on, converting the
> store as it goes; and a lost keychain is answered by **the password**, with the 24-word
> phrase as the forgot-password fallback. **Slices 1–6 of the custody build are done** —
> joining or recovering an account now converts that device's store too, so **no path leaves
> real user data in a plaintext file any more**. **Slice 7 (sign out + forget account) is
> built on desktop and verified over CDP; mobile is the remaining half.** See the block
> below under *What's next* → **Local custody**. The model is
> [`encryption/model.md`](./encryption/model.md) §7.
>
> Also standing: the encryption docs are **consolidated to four** (`custody-sequence.md` folded
> into `model.md` §7.5, `local-custody-options.md` retired), and **the UI extraction is
> finished** — `@leapsake/ui` holds every presentational component the desktop renderer had,
> `@leapsake/view-models` the derivations both clients duplicated; rationale in those READMEs.

## Where things stand

- **V1 desktop + V1.5 local CRM** and **V2 mobile** (feature-complete vs. desktop, verified
  iOS + Android) — ✅ done. (Delivery history: `git log`; durable lessons:
  [`../AGENTS.md`](../AGENTS.md) and the package READMEs.)
- **V3 · Encryption + sync** — **Stages 1 (zero-knowledge sync) and 2 (at-rest) are done on
  both clients**, verified over the wire and on-disk. **The recovery-phrase increment is
  done** (24-word phrase recovers both loss events; UI verified on both clients). **Relay
  hardening: H3 done; only non-v0.1-blocking items remain** (see *What's next*). Stages 3–4
  (sharing, SSR web) are post-launch. Design: [`encryption/`](./encryption/).
  > ✅ **Custody was rebuilt 2026-07-27/28 and the boot path *is* the target model now.**
  > A fresh install is **Open**: no keys anywhere, a plaintext store at `stores/local/`.
  > Creating an account — **or joining/recovering one** — mints this device's db-key and
  > converts the store to `stores/<accountId>/`, and both unlock doors, password and phrase,
  > are built and proved on desktop for all three paths.
  > Slices 1–6 of the build order below are done; **slice 7 is next**. Any install predating
  > this must be recreated (pre-v0.1 latitude) — there is no compatibility path.
- **V3 · Reconciliation (dedup & merge)** — increments A, B, and C's merge-on-join are built,
  and the review surface is **detection-driven rather than permanently advertised** (links and
  banners appear only while pairs are outstanding; a `system` reminder nudges from Home). Only
  C's bulk-import dedup remains, deferred until the importer exists. Design:
  [`packages/core/README.md`](../packages/core/README.md).
- **Files / media** — nothing built; design invariants pinned in [`files.md`](./files.md).
  Photos are the v0.2 headline (first consumer of that design).
- **Holidays** — **shipped on both clients**: `@leapsake/holidays` owns the catalog and the
  recurrence engine, three synced tables carry observances, both ends author them, they are
  searchable, and the reminder engine mints `system` reminders per occurrence against a
  per-observance schedule. Design: [`holidays/research.md`](./holidays/research.md) (§4's four
  open questions are settled there). The two lunisolar tables are **derived and cross-checked**
  and run to **2056**; the only future task is calendrical and distant — **extend them before
  ~2050**, re-deriving rather than extrapolating (see `packages/holidays/src/catalog.ts`).
- **Reminders (home-screen surface)** — the syncable Reminder entity, the **Home screen on both
  clients**, `@mentions` as two-way backlinks, the `@`/`#` compose surface, and four families of
  engine-owned `system` reminders (birthdays, per-milestone staggered schedules, holidays, the
  duplicates nudge) plus onboarding nudges are all built. Remaining: **reminder search**.
- **UI extraction — done.** Two packages hold what the clients used to duplicate:
  [`@leapsake/ui`](../packages/ui/README.md) (every presentational component the desktop renderer
  had, no user-visible string in any of them, 197 tests) and
  [`@leapsake/view-models`](../packages/view-models/README.md) (the headless derivations both
  clients showed the same way, 21 tests). Rationale lives in those two READMEs. Leftovers below.
- **Testing harness** — the tiered `pnpm test` orchestration is built: `pnpm test` = fast local
  suite, `pnpm test:all` = everything reachable, with each tier a `pnpm test:*` script and
  **blocked** tiers reported as ⏳ rather than silently skipped. The **driver-coverage forcer**
  gates the desktop driver file at 100%. `pnpm test:native` drives the in-app self-test through
  Maestro on a booted Android emulator and/or iOS simulator — a terminal automated gate, verified
  RED and GREEN on both. E2E is the one **blocked** tier; its crucial-flow catalog is drafted
  ([`testing/crucial-flows.md`](./testing/crucial-flows.md), pending owner sign-off). Next bricks:
  desktop macOS Playwright E2E → mobile E2E flows on the same harness → iOS E2E half. Design:
  [`testing/`](./testing/).

## Product posture

The stable product truths — the launch-posture decisions and the canonical
user/client/account/sharing/encryption model — live in
[`product-truths.md`](./product-truths.md). This file never restates them; it only sequences
the work they imply.

---

## What's next

> **v0.1 launch line.** The web app is post-launch, and it's the render vehicle for every
> URL-based share — so capability links and Stage 3 sharing defer with it. Mobile + desktop
> + the (self-hosted) blind relay are judged enough for v0.1 person-data management.

### Pre-v0.1 (toward initial launch)

> **Order matters here.** Picking up work cold? Take them in this order:
> **1.** **Local custody — the block immediately below.** Slices 1–6 are **built**, and
> slice 7 is **built on desktop**; start at **slice 7's mobile half**. No longer blocks
> `launch.md` Increments 2–4.
> **2.** `launch.md` Increment 1's last piece — **an owner decision, not a task**: the version
> number and the build-number strategy. The machinery and the credential gitignores are built.
> Due before Increment 4's first store upload, not before the v0.1 cut.
> **3.** The rest of `launch.md` in its own numbered order, once 1 is built.
> **4.** Everything else in this section — genuinely interleavable as capacity allows, no
> dependencies between them.
>
> Sections after *Pre-v0.1* are **not** a queue; they are staged buckets (v0.2, post-launch).

**⇒ Local custody — decided 2026-07-26/27, built 2026-07-27/28. Slices 1–6 done; slice 7 done
on desktop, mobile next.**

> **Pre-v0.1 latitude** *(owner, 2026-07-27)*: **breaking changes that cost a new dev install
> are fine.** There are no real users, so a migration is only worth writing when it is
> genuinely cheaper than "delete the profile and relaunch". Prefer the simpler code.

*Starting cold? This block is written to be enough on its own. Read it, then
[`encryption/model.md`](./encryption/model.md) §7 (custody, end to end) and §8.1 (converting
a store). Those two are the whole design; you should not need another doc.*

#### The decision, in five lines

Leapsake **encrypts once the user holds a secret that opens it, and not before.**

- **First launch mints no keys at all** — no db-key, no master key, no recovery phrase, no
  sidecar. The OS keychain stays empty and the store is plaintext. (`model.md` §7.2, "Open")
- **Creating an account — username + password, both required — is the single act that turns
  encryption on**: it mints every key, converts the store to encrypted, and shows the
  recovery phrase once as the *forgot-password* backstop. (§7.2.1, "Protected")
- A device **joining or recovering an existing account** converts its store in the same act,
  so it is encrypted from byte one too. (§7.1, slice 6)
- **Why:** a key held only by the OS keychain guards little that platform disk encryption
  doesn't already cover, while creating a real data-loss path — lose the keychain, lose
  everything, with only an unsaved 24-word phrase as the way back.

**Why it led everything:** it changes what a fresh install does with real data. That at-rest
work is now finished, so `launch.md` Increments 2–4 are free to proceed. It also **defuses
`launch.md` §2's central hazard** — the Team-ID change on the org move, which would have dropped *every* user into a
recovery-phrase gate, now costs an accountless user nothing and an account holder one
password entry.

#### Where custody lives, for a fresh reader

- **Which store, and is it encrypted** — [`@leapsake/store-layout`](../packages/store-layout/README.md):
  the roster, the per-account paths, and the pure `resolveActiveStore` that answers *Open or
  Protected* before anything is opened.
- **Opening it** — `apps/desktop/src/main/db/open.ts` and the mirrored branch in
  `apps/mobile/lib/core-context.tsx`, including the two unlock doors.
- **Turning encryption on** — `createLocalAccount` (`@leapsake/key-custody`) plus each
  client's converter and flow: `apps/desktop/src/main/db/convert-store.ts` +
  `create-account-flow.ts`; `apps/mobile/db/convert-store.ts`, wired inside `core-context.tsx`.
- **Adopting an account someone else's device created** — the join/recover counterpart, same
  sequence: `apps/desktop/src/main/db/adopt-account-flow.ts` and mobile's `convertJoinedStore`
  in `core-context.tsx`.
- **The doors** — `packages/crypto/src/{recovery,password-sidecar}.ts` for the primitives,
  `sealPasswordDoor` (`@leapsake/key-custody`) for the one place a door is sealed, and each
  client's `sidecars.ts` for where the bytes land.

> **`createCore(driver, keySession?)` no longer reads its key session at all.** `milestone.note`
> was layer 3's only consumer and was retired in slice 3, so **no repo needs a key**. The
> parameter and the clients' "rebuild the core around the adopted MK on join" plumbing are
> therefore currently inert. Left in place on purpose — photos (v0.2) are layer 3's real
> consumer — and **still inert after slice 6**, which deliberately did not touch it *(owner,
> 2026-07-28: keep the diff off the two riskiest handlers)*. On desktop the rebuild is now
> genuinely redundant as well as inert: the store swap re-opens and rebuilds the core anyway.
> Simplify it whenever layer 3 next gets attention.

#### Build order — each slice independently shippable

**Slices 1–6 are built** (2026-07-27/28, both clients). What they did, in one line each:
first launch mints nothing and opens plaintext (1); stores live at per-account paths behind
an unencrypted roster (2); `milestone.note` stopped being a content-key consumer, so no repo
needs a key (3); account creation mints every key and converts the store (4); the
password opens the store at the pre-database layer, with the phrase demoted to the
forgot-password fallback (5); and joining or recovering an account converts that device's
store too, so no path leaves data plaintext (6). Slice 6 was verified over CDP on three
profiles against a live relay — a joined device and a recovered device each end up ciphertext
at `stores/<accountId>/` with the Open store gone, the roster naming the account, both
sidecars present, and a **wiped keychain opening from that device's own password**. The *how*
is in `git log` and the code's own doc-comments; what survives here is only what a future
reader would otherwise re-learn the hard way:

> - **Both boot paths read the recovery key; neither mints one.** A password unlock has no
>   recovery key — it stayed in the wiped keychain and nothing local recovers it — so minting
>   at boot would re-seal `<db>.recovery` under a fresh key and **silently invalidate the 24
>   words the user wrote down**. Creation, join, and recovery each establish it beforehand.
> - **There is no relaunch.** Account creation and factory reset re-open the store in place
>   (`openActiveStore` / `withStoreSwap`), matching mobile. `app.relaunch()` took the app away
>   while the one-time phrase was on screen, and under `electron-vite dev` it white-screens the
>   app, because electron-vite exits with its Electron child and takes the renderer dev server
>   with it.
> - **A `sealPasswordDoor` call must follow every password change**, on the device whose store
>   it is — each device seals its *own* db-key. The type system enforces it: `PasswordDoorWriter`
>   is a required parameter on every wrapper that establishes or rotates one.
> - **An install predating the custody work must be recreated.** `resolveActiveStore` is purely
>   "does the roster hold an account?", both boot branches *refuse* a store in the wrong custody
>   state, and the only legitimate plaintext→encrypted conversions are the three that establish
>   an account on this device: creation, join, recovery.
> - **Migration 27 could not preserve an encrypted `milestone.note`** and did not try — a dev
>   profile that wrote notes while holding a key has NULL there. Accepted under the latitude
>   above.
> - **Mobile's Settings flow has still never been driven in a running app.** Desktop's is
>   verified over CDP through account creation, join, recovery, both unlock doors, and
>   factory reset.
> - **A password door is sealed *before* the store it opens exists.** Core seals it from
>   inside `joinAccountViaRelay` / `createLocalAccount`, while the live path still names the
>   Open store that is about to be deleted — so a writer resolving `passwordSidecarPath(dbPath)`
>   at call time writes the door into the directory the flow then removes. Both flows instead
>   **capture the bytes and write them at the converted path**. `writeThisDevicePasswordDoor`
>   is for the steady state only; its doc comment says so.
> - **`sealPasswordDoorIfProtected` skips on "no db-key", not on "Open".** That is why slice 6
>   mints the db-key *before* the relay call rather than after — minting first is the whole
>   mechanism by which join and recover gained a real door with no change at those call sites.
>   `adopt-account-flow.ts` hard-fails if the door comes back unsealed, so a regression to the
>   skip cannot ship silently.
> - **Mobile's `enable` still has two gaps slice 6 fixed only for join/recover**: its converter
>   has no overwrite guard (a retry after a mid-flow crash copies into a populated encrypted
>   file), and it has no restore path if the conversion throws after `driver.close?.()`. Left
>   alone deliberately — it is a proven path — but worth a small follow-up.

7. **Sign out + Forget account** (§7.3) — **desktop built + CDP-verified 2026-07-28;
   ⇐ START HERE for the mobile half.** Sign out clears the two keystore secrets that open
   the store (`lockThisDevice`, `@leapsake/key-custody`) and re-opens, which drops the boot
   path into its existing unlock gate; Forget account (`forget-account-flow.ts`) removes the
   account's store directory, both doors, its roster entry, and those same keys, landing the
   device back in the Open state. The relay-backup check that words the last-device
   confirmation is `fetchRelayCapabilities` (`@leapsake/sync`), which answers `false` unless a
   relay explicitly says otherwise. Desktop was driven over CDP through the whole cycle: Open
   → create account → sign out (gate raised, wrong password refused) → password unlock → data
   intact → forget → plaintext Open store, roster empty → second account creates cleanly. The
   phrase door was driven live too. **What mobile still needs** is the mirror: `lockThisDevice`
   is client-agnostic and `forgetAccountOnThisDevice` is not (it is `node:fs` over
   `storeDir`), so mobile needs its own file half plus the Settings surface — which,
   per the note above, has still never been driven in a running app.

   > - **Sign out must clear the recovery key, not just the db-key.** `<db>.recovery` holds
   >   `seal(db-key, recoveryKey)` in plain view beside the store, so a recovery key left in
   >   the keychain reconstructs the db-key with **no user secret involved** — the file would
   >   look locked while anything holding the keychain still opened it. Both directions of
   >   this are pinned by sabotage-verified tests.
   > - **It must equally *not* clear `device-id` / `enclave`.** `ensureDeviceMasterKey` keys
   >   its lookup on the device id, so a fresh one finds no wrap row, **mints a new master
   >   key**, and orphans every content key wrapped under the old one. Signing out and back in
   >   has to be a no-op above the at-rest layer.
   > - **A password unlock cannot restore the recovery key** (it lived only in the cleared
   >   keychain, and minting one would invalidate the user's 24 words — see slice 5's note).
   >   So after sign-out-then-password-unlock, `sync:revealRecoveryPhrase` legitimately has
   >   nothing to show; its error now says so instead of telling an account holder to create
   >   an account. A *phrase* unlock does restore it. Slice 8 removes that surface anyway.
   > - **Forget removes the roster entry first, then the files.** The reverse strands a roster
   >   naming a store whose files are gone, which sends the Protected boot path off to create a
   >   fresh empty encrypted store — presenting the user an empty app under the account they
   >   thought they deleted. The chosen order's only failure mode is an inert ciphertext
   >   directory nothing can ever name again.
   > - **Forget is deliberately not `factoryResetFiles` with fewer arguments** — that erases
   >   the whole `stores/` tree, which on a device holding a second account would delete data
   >   the user never asked to lose.
   > - **`reopenActiveStore` now announces `boot:ready`.** Only `whenReady` used to, so a
   >   mid-session re-open left the renderer stuck on the gate forever. This is what makes
   >   sign out's return trip work at all.
   > - **The `/capabilities` endpoint is deliberately not built.** The protocol shape is still
   >   an owner decision (Open questions, below), so only the *client* half exists — and since
   >   silence means "no durable copy", the alarming last-device copy is what every user sees
   >   today, which is the correct default.
   > - **The export offer §7.3.1 asks for is not built** — there is no exporter yet (see
   >   *vCard/JSContact export*, below). The hard-confirm currently tells the user to copy
   >   their `stores` folder instead, which is honest but poor. Wire the real offer when the
   >   exporter lands.

8. **⇐ NEXT after mobile. Retire the Settings recovery-phrase reveal** *(owner, 2026-07-28)*. The phrase is to be
   **shown once at account creation and never again**; the only later route is a
   **re-auth-gated rotation** that mints a new phrase, shows it once, and retires the old. The
   Open half shipped (the section is hidden with no account, and the handler reads instead of
   minting); removing it for account holders was gated on the password door, which now exists.

> Two things to know before building the rotation:
> - **Rotation is never a recovery tool.** It needs the password, and the phrase exists for
>   when the password is gone. Its real job is compromise response ("my phrase leaked"), and
>   the copy should say so.
> - **"Invalidates the old phrase" is not yet true on a multi-device account.** One account has
>   one recovery key, but each device's `<db>.recovery` is sealed with that device's own
>   db-key, so a rotating device cannot re-seal its peers. The old phrase keeps opening *their*
>   files until each re-adopts — the per-device re-adopt-and-re-seal work parked under *Device
>   management* (post-launch). Ship rotation scoped honestly, or after that.

**Explicitly v0.2, not v0.1** *(owner, 2026-07-27)*: **automatic** locking on idle and the
bounded session. The deliberate half (slice 7) is cheap; a real session needs mid-session
re-lock in the desktop main process and mobile's bootstrap, and must not be theater since the
keychain still holds the db-key. Not a one-way door — it sits on the same password door.

#### Before you rely on it

**The conversion is built and gated, not merely verified.** Desktop's lives in
`apps/desktop/src/main/db/convert-store.ts` (8 tests, against the real app schema); mobile's
in `apps/mobile/db/convert-store.ts`, exercised **on device** by
`apps/mobile/test/custody-selftest.ts`, which runs beside the driver contract under
`pnpm test:native` (20 cases total, each positive paired with its negative; confirmed RED by
sabotage before being trusted GREEN).

What that gate is protecting, in case you change the conversion:
- Neither engine's *native* shortcut is portable — desktop has `PRAGMA rekey` but **no**
  `sqlcipher_export`, SQLCipher the reverse — hence the ordinary-SQL ATTACH + copy on both.
- **Pin `PRAGMA cipher='sqlcipher'` before the ATTACH.** Load-bearing on **desktop only**; a
  verified no-op on mobile (SQLCipher has one cipher), kept for symmetry. Skip it on desktop
  and the file gets the default cipher, failing later with a misleading `file is not a
  database`.
- **Carry `user_version` across** — ATTACH does not, and losing it re-runs every migration
  against tables that already exist.
- **`ATTACH` never creates directories.** Desktop `mkdirSync`s; mobile opens the destination
  by name first, since expo-sqlite creates intermediate directories on open.

**No longer blocks `launch.md` Increments 2–4.** The at-rest half of custody is complete on
every path, so the first closed-test upload would not be putting testers' real data in a
plaintext file. Slices 7–8 are user-facing surface, not on-disk churn, and can land alongside
the distribution work rather than ahead of it.

**Encryption + sync:**

- **Relay hardening.** **H3 is complete for v0.1** — session tokens + both TLS paths
  (Option A Caddy-in-front, Option B in-process) — as are H2, M3, proxy-aware IP, and the
  recovery throttle. Delivery detail in `git log`; findings backlog in
  [`encryption/security-findings.md`](./encryption/security-findings.md). Remaining, in order:
  1. **Shared cross-process rate-limit counter** — today's limiters *and* session store are
     in-memory, per-process; a multi-node relay collapses them (one shared follow-up).
  2. **H1 — decided 2026-07-05: OPAQUE, gated on the hosted-relay era** (not v0.1). The
     decision + rationale (why OPAQUE over a 1Password-style Secret Key, where passkeys fit)
     is recorded in [`encryption/sync.md`](./encryption/sync.md) §4 *Auth-hardening decision*.
     v0.1 self-host posture: current verifier scheme + H3, plus an honest note in the
     self-hosting docs that a relay operator could attempt offline guesses against a weak
     password — use a strong one.
- **vCard/JSContact export** (import comes later with the bulk importer). The portability /
  exit-strategy answer: user-initiated, client-side (the client already holds plaintext),
  people + contact methods first. Cheap, and it doubles as groundwork for the future
  CardDAV surface and the importer increment.
- **Restore-from-file-backup flow — verify + document.** ⇐ **now unblocked** — slice 5 built
  the second door, and both are proved on desktop against a wiped keychain, on created,
  joined and recovered devices alike; what remains is
  the same exercise on a *fresh machine*, plus writing it up. At-rest encryption made the local file
  opaque to generic backup tools; the intended story is "copied `leapsake.db` +
  `leapsake.db.recovery` + the password (or phrase) on a fresh machine boots through
  `RecoveryGate`." Confirm it works end-to-end **per door**, then document it as *the* local
  backup answer. Note an **Open** store needs no ceremony at all — the file just opens — so
  this concerns account holders only. It is also the honest limit of a local password: an
  account protects **access**, a backup protects against **losing the device** — two
  different promises, and the account-creation copy must say so (`model.md` §7.2.1).
- **CK revocation / GC on entity delete** (sync-era cleanup; stops orphaned keys).
- **True background-fetch sync + a configurable sync-interval UI.**

**Relay packaging & durability** (self-host is the only v0.1 sync path, so it must be easy
and boring to run):
- **Packaging is done** — Dockerfile, `docker-compose.yml` + Caddy, README → Deploy.
- **Relay disposability** ([`encryption/sync.md`](./encryption/sync.md) §2): losing
  `relay.db` must never lose user data. Content already lives on devices; close the gap by
  having devices **self-heal the account row + recovery escrow** on sync, so a relay wipe
  costs one re-join at most. Also: the relay store's `ALTER TABLE` try/catch migration
  pattern (`apps/server/src/store.ts`) is fine for single-node SQLite; revisit if the store
  ever moves backends.

**Distribution (launch-gating)** — code signing, macOS notarization, auto-update; v0.1
can't ship without distributable apps. (None yet.) Plan + increments:
[`launch.md`](./launch.md). **Increment 1 is down to one owner decision** — the mobile bundle
IDs are `com.leapsake.app` (desktop's `com.leapsake.desktop` arrives with electron-builder in
Increment 5), the credential gitignores are in, and the version *machinery* is built:
`scripts/set-version.mjs <version>` writes all 18 manifests, `--check` runs as the
`test:versions` tier, and mobile's `expo.version` is derived from its `package.json` via
`app.config.ts` so it can no longer drift. **What's left is picking the scheme** — everything
is deliberately still `0.0.0`. Two constraints on that choice: it must be settled before
**Increment 4's first store upload**, not before the v0.1.0 cut, and it needs a build-number
strategy (`ios.buildNumber` / `android.versionCode` exist nowhere yet — EAS can auto-increment
them). Store version strings are permanent and monotonic per store record, which is the whole
reason this sits in Increment 1. **Increments 2–4 no longer wait on custody** — the at-rest
build finished with slice 6.

**Reconciliation** (quality; can land pre- or post-launch as capacity allows):
- **Fuzzy / typo-tolerant name matching** — the scorer's reserved `"low"` tier via
  `fastest-levenshtein` or `cmpstr`, entirely inside `duplicate-score.ts`'s `sameFoldedName`
  predicate — no caller/API change.
- **`libphonenumber-js` phone normalization** — E.164 canonicalization; its own increment.
- **Pets / generalized `mergeEntities`** — small follow-on; the reference graph is entity-typed.
- **Bulk-import dedup** — deferred until the importer exists (then mostly A+B reuse,
  honoring the `not_a_duplicate` memory).

**Client / UX** (sequenced *after* the encryption work above):
- **Reminder search** — reminders join `SearchResultType` the way gift ideas did, matched on
  title + body. The last piece of the reminders surface. (Leapsake-defined tasks extend the same
  engine later, keyed off `source` + trigger identity.)
- **Styling / the design system** — now that the extraction is done: `@leapsake/ui/tokens` grows
  real values and the components grow styles. Markup moved out of the renderer deliberately
  unstyled, so this is the first pass where appearance changes at all. Partly gated on the web
  framework, which also decides CSS Modules vs. `transpilePackages`.
- **i18n proper** — the catalog seam is built and no component holds a string; what's missing is
  a library, plus `@leapsake/schema`'s English label tables (`genderLabel`, `kindDefs`, the role
  labels), which mobile reads directly. A cross-client workstream, not a UI-package task.

### v0.2 (first post-launch feature increment)

- **Photos** — the first consumer of [`files.md`](./files.md): the encrypted blob channel
  (separate from row sync), chunked + resumable transfer, client-computed encrypted
  thumbnails, the `BlobStore` port with the filesystem adapter first. Scope details and the
  invariants that must hold are in that doc.

### Post-launch (after the web app)

- **Web app — encryption Stage 4** (SSR split-session rendering + PWA; `model.md` §10): the
  no-JS accessibility floor and the gate for all URL-based sharing. Framework still open
  (Remix / Next.js / React Router). **Low retrofit risk** — the KEK layer makes the SSR
  session-key door additive, the auth-verifier split it needs is already built, and web is
  just another `core` consumer behind existing ports.
- **Capability-link sharing** (`model.md` §11): zero-knowledge public links (key in the
  `#fragment`, no `key_wrap` row). Needs the web app as render vehicle **and** a prior
  URL-formation decision (see Open questions).
- **Stage 3 — authenticated sharing** — account keypair + public-key directory (TOFU-vs-
  verify trust) + constrained principals (hosted links, Alexa, CardDAV). Kept entirely
  post-web. Needs an external crypto audit before public ship.
- **Hosted-relay gate** (before any official/paid relay stores other people's data):
  **OPAQUE** login (the H1 decision, `encryption/sync.md` §4), Tier-1 server-escrow
  recovery (email/password reset as an opt-in dial, `model.md` §5–6), quotas / registration-
  token enforcement, the shared rate-limit counter.
- **Custody doors, in preference order** (decided 2026-07-05, `encryption/sync.md` §4):
  **passkeys (WebAuthn PRF)** as an additional unlock door — supported, *not* the default
  (not yet universal enough); a 1Password-style **Secret Key is deliberately not planned as
  a default** — at most a much-later opt-in hardening after passkeys. Also: the
  high-entropy sync-code / QR-pairing door; username reconciliation across relays.
- **Device management** — per-device revocation and a master-key rotation mechanism (the
  lost-phone story). Grows in importance with photos (v0.2) — track before then.

---

## Dev harness (reusable for sync work)

- **Relay:** `cd apps/server && pnpm exec tsx src/index.ts` → `http://localhost:4000`. Store
  persists to `apps/server/relay.db` (`rm` it for a clean slate). Mobile sims point at it:
  **iOS `http://localhost:4000`; Android `http://10.0.2.2:4000`**.
- **Desktop device 1:** `pnpm --filter @leapsake/desktop dev`; userData
  `~/Library/Application Support/@leapsake/desktop` (the dev app, not the packaged `…/Leapsake`).
- **Extra desktop instances** (no single-instance lock): from repo root,
  `ELECTRON_RENDERER_URL=http://localhost:5173 "$(node -p 'require("electron")')" apps/desktop --user-data-dir=<fresh-dir>` —
  each distinct `--user-data-dir` is a separate "device".
- **Driving the desktop app without a harness** (how custody slices 4 and 5 were actually
  verified, and the only way to prove a *user-visible* desktop change until the E2E tier
  exists). Add `--remote-debugging-port=9333` to the command above, then talk CDP to the
  renderer: `curl -s localhost:9333/json` gives the page's `webSocketDebuggerUrl`, and
  `Runtime.evaluate` over that socket runs anything in the renderer — `window.api.*`,
  `window.sync.*`, `window.boot.*`, or DOM clicks. Node 22+ has a built-in `WebSocket`, so
  the driver is ~40 lines and needs no dependency. Pair it with **out-of-band assertions on
  the profile directory** — the store's first 16 bytes (`SQLite format 3\0` or not),
  `keystore.json`'s key list, `accounts.json`, the sidecars — since custody's defining
  properties are invisible on screen. React inputs need the native value setter plus an
  `input` event to register; `location.reload()` picks up an HMR'd renderer change without
  restarting the app. Deleting `keystore.json` between launches simulates keychain loss.
- **Mobile dev client:** `pnpm --filter @leapsake/mobile ios` (native SQLCipher build; Expo
  Go can't host it). `__DEV__` deep links: `leapsake://dev-selftest` (driver contract +
  custody suite), `leapsake://dev-clear-dbkey` (simulate keychain loss). Editing a self-test
  needs a bundle reload, not just the deep link — see
  [`apps/mobile/maestro/README.md`](../apps/mobile/maestro/README.md).

> ⚠️ **Running the desktop dev app flips the native SQLite binary to the Electron ABI.** The
> failure is delayed and misleading: a bare `require()` still succeeds, but the next `vitest`
> run dies with dozens of *"Worker exited unexpectedly"* rather than an ABI error. Restore the
> Node build by extracting the cached prebuild — **not** with `prebuild-install --force`,
> which can clear the cache before its own download is killed:
> ```
> cd node_modules/better-sqlite3-multiple-ciphers
> tar -xzf ~/.npm/_prebuilds/*better-sqlite3-multiple-ciphers-*-node-v137-darwin-arm64.tar.gz
> ```
> Already known for `build` and `check:bundle`; `dev` does it too (confirmed 2026-07-28).
> **Which ABI is installed is a file-size check**, since both builds share a name and the
> tarballs preserve mtimes: `2217120` bytes = Node, `2217808` = Electron.
>
> ⚠️ **In a sandboxed agent shell, `pnpm test` cannot finish** — `test:node` and
> `test:coverage` run `ensure-sqlite-abi.mjs`, whose `prebuild-install` needs network and is
> SIGKILLed, sometimes taking the binary with it. Restore with the `tar` above and run
> `pnpm exec vitest run` directly; the static tiers run via
> `node scripts/test-all.mjs --only=format,lint,typecheck,versions`. The script is correct —
> do not "fix" it. Also observed: the binary has flipped to the Electron ABI **without** the
> dev app being run in that session, so check the size before trusting a green run.

## Open questions

**Custody** (live — these sit alongside the build order above, not behind it):
- **Username collision when a local account binds a relay.** A locally-chosen username may
  already exist on the relay (it answers `409`). Two cases hide behind one error and want
  different UX: *"this is me, I made a second account by accident and want them merged"* vs.
  *"different person, I just need a different handle."* Renaming is the easy half and should
  ship with relay binding. Merging is the hard half — note that the machinery partly exists
  (`reconcileOnJoin` surfaces overlapping people after a join and deliberately does **not**
  auto-merge, leaving it to the duplicate-review surface), so "join the existing account and
  review the duplicates" may be the whole answer for v0.1. Decide before relay binding ships.
- **Relay backup capability** — the protocol shape for a relay advertising whether it keeps a
  durable copy (`model.md` §7.3.1). The **client half is built** (`fetchRelayCapabilities`,
  `@leapsake/sync`): it GETs `/capabilities`, reads a literal `durableBackup: true`, and
  falls back to "no" on anything else. What is undecided is the **server** side — the
  endpoint's shape, whether it carries more than one field, and whether it is authenticated —
  so no relay serves it and every user currently sees the last-device deletion warning. That
  default is the safe one, so this still does not block v0.1.
- *(Deferred with automatic locking, v0.2)* **session lifetime and its dial**; **biometrics
  on mobile** as the everyday unlock with a true expiry still demanding the password;
  **auto-purge of an idle logged-in device**.

**Encryption** (each tied to a not-yet-started stage):
- Asymmetric scheme (X25519/Ed25519) — reviewed when **Stage 3** needs it; plus an
  **external** crypto audit before public ship (the recorded review is an internal design
  audit).
- Public-key directory trust model (TOFU vs. verification) — **Stage 3**.
- Web framework — must support both SSR (no-JS) and a client-side decryption path in one
  app (`model.md` §10) — **Stage 4**.
- Share-URL formation — how the official/paid instance vs. self-hosted instances at
  arbitrary domains form & resolve share URLs, and how account identity / the public-key
  directory reconcile across relays and domains. Blocks **capability-link sharing**; tied
  to the **web app** + **Stage 3**.
- Metadata minimization — explicitly out of scope for V3; revisit before privacy-first
  marketing at scale, and again before v0.2 (blob sizes/counts reveal more about a photo
  library than text rows do — see `files.md`).
- Confidential-computing enclave for SSR — the **Stage 4** ceiling; only if server-side
  decryption trust ever needs hardening.

**Files / media** — build-time decisions (chunking format, content addressing vs. dedup,
where derived data is computed, media vs. the no-JS SSR floor) are listed in
[`files.md`](./files.md) §5.

**Reconciliation:**
- Survivorship granularity — v1 keeps the survivor's scalar fields wholesale; a per-field
  picker is deferred; revisit if users hit it.
- Concurrent merges — two devices merging overlapping pairs differently is an edge case
  (re-points + tombstones may diverge under LWW). Acceptable to defer; noted, not solved.
