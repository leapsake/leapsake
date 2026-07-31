# Leapsake — Status & Next Steps (the single oracle)

> **This is the one file that tracks status across every workstream.** Picking up work?
> Read this file for *what to do next*, then the relevant design doc for the *why*.
> The history of a **finished** increment lives in `git log` + the code's own doc-comments,
> not here. Design docs never restate status; this file never restates design.
>
> **Updated 2026-07-30.** Custody is finished on both clients: a fresh install mints no keys
> and writes a plaintext store, creating an account turns encryption on, and a lost keychain
> is answered by the password. Nothing in it blocks v0.1.
>
> **Next up is [`launch.md`](./launch.md)** — its Increment 1 owner decision (the version +
> build-number scheme) first, then the rest in its own order. Everything else in *What's next*
> is interleavable.
>
> **One exception since 2026-07-30:** [`onboarding.md`](./onboarding.md) Increments 1–2 now
> stand where `launch.md`'s Increment 2 did, and `launch.md` Increment 4 (the Play 14-day
> clock) is still sequenced after them. They are the one non-`launch.md` item on the critical
> path.

## Where things stand

| Workstream | State | What remains |
|---|---|---|
| **V1 desktop · V1.5 local CRM · V2 mobile** | shipped, feature-complete on both clients | — |
| **V3 · Encryption + sync** | Stages 1–2 (zero-knowledge sync, at-rest) done and verified over the wire and on-disk; **custody finished**; relay hardening through H3 | the *Encryption + sync* and *Relay* backlogs below. Stages 3–4 (sharing, SSR web) are post-launch. Design: [`encryption/`](./encryption/) |
| **V3 · Reconciliation** (dedup & merge) | A, B, and C's merge-on-join built; the review surface is detection-driven, not permanently advertised | C's bulk-import dedup, deferred until the importer exists. Design: [`packages/core/README.md`](../packages/core/README.md) |
| **Holidays** | shipped both clients — catalog, recurrence engine, synced observances, per-occurrence reminders | one distant, calendrical task: **re-derive the two lunisolar tables before ~2050** (they run to 2056; see `packages/holidays/src/catalog.ts`). Design: [`@leapsake/holidays`](../packages/holidays/README.md) |
| **Reminders** (Home surface) | the Reminder entity, Home on both clients, `@mentions` as two-way backlinks, four engine-owned `system` families, onboarding nudges | **reminder search** |
| **Onboarding** (first run) | three engine-owned first-run nudges ship on both clients; the Day-1 flow is **designed, not built** | all six increments in [`onboarding.md`](./onboarding.md) — 1–2 are the v0.1 line, 3–6 follow at any pace |
| **UI extraction** | done — [`@leapsake/ui`](../packages/ui/README.md) holds every presentational component, [`@leapsake/view-models`](../packages/view-models/README.md) the shared derivations | styling / the design system (below) |
| **Testing harness** | the tiered orchestration is built and self-documenting (`scripts/test-all.mjs`); the native tier is a terminal gate, proved RED and GREEN on both platforms | **E2E is the one blocked tier** — catalog drafted, pending owner sign-off. Design: [`testing/`](./testing/) |
| **Files / media** | nothing built | photos are the v0.2 headline; invariants pinned in [`files.md`](./files.md) |

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
> **1.** **`launch.md` Increment 1's last piece** — **an owner decision, not a task**: the
> version number and the build-number strategy. The machinery and the credential gitignores
> are built; it is due before Increment 4's first store upload, not before the v0.1 cut.
> Local custody (the block below) is **finished**, owes v0.1 nothing, and blocks nothing.
> **2.** **[`onboarding.md`](./onboarding.md) Increments 1–2** — the persistent nudge-decision
> table, then the account invitation. Increment 2 is what `launch.md` Increment 4's "don't put
> a build in real testers' hands first" rule actually requires, so it gates the Play clock.
> Increments 3–6 there do **not**.
> **3.** The rest of `launch.md` in its own numbered order, once 1 is settled.
> **4.** Everything else in this section — genuinely interleavable as capacity allows, no
> dependencies between them.
>
> Sections after *Pre-v0.1* are **not** a queue; they are staged buckets (v0.2, post-launch).

**⇒ Local custody — decided 2026-07-26/27, built 2026-07-27/30 (slices 1–10). DONE on both
clients; it owes v0.1 nothing and blocks nothing.** What each slice did, and the traps it
found, are in `git log` and in the doc-comments of the files below — that is where they stay
current. What follows is only what a reader needs *now*.

**The decision:** Leapsake **encrypts once the user holds a secret that opens it, and not
before.** A fresh install mints no keys and writes a plaintext store; creating an account
(username + password) is the single act that turns encryption on; joining or recovering one
does the same on that device. A lost keychain is answered by the password, with the 24-word
phrase as the forgot-password fallback. The whole design is
[`encryption/model.md`](./encryption/model.md) §7, and §8.1 for converting a store — those two
sections are enough; you should not need another doc.

**Where custody lives, for a fresh reader:**

- **Which store, and is it encrypted** — [`@leapsake/store-layout`](../packages/store-layout/README.md):
  the roster, the per-account paths, and the pure `resolveActiveStore` that answers *Open or
  Protected* before anything is opened.
- **Opening it** — `apps/desktop/src/main/db/open.ts` and the mirrored branch in
  `apps/mobile/lib/core-context.tsx`, including the two unlock doors.
- **What the boot does about keys once the store is open** — `establishKeySession`
  (`packages/key-custody/src/boot.ts`): the master-key repair, the resume of a half-done
  repair, the key session, and the *Degraded* verdict when this device cannot prove the
  account's master key. Both clients and the desktop boot harness call this one function.
- **Turning encryption on** — `createLocalAccount` (`@leapsake/key-custody`) plus each
  client's converter and flow: `apps/desktop/src/main/db/convert-store.ts` +
  `create-account-flow.ts`; `apps/mobile/db/convert-store.ts`, wired inside
  `core-context.tsx`'s `createAccountHere`. On both clients the relay is **optional** at that
  call — with it the act also binds a relay, without it the account is local only.
- **Adopting an account another device created** — the join/recover counterpart, same
  sequence: `apps/desktop/src/main/db/adopt-account-flow.ts`, and on mobile the *same*
  `adoptStoreForAccount` that creation uses (`core-context.tsx`).
- **The doors** — `packages/crypto/src/{recovery,password-sidecar}.ts` for the primitives,
  `sealPasswordDoor` (`@leapsake/key-custody`) for the one place a door is sealed, and for
  where the bytes land: desktop's `main/db/sidecars.ts` (files beside the store) and mobile's
  `db/doors.ts` (`stores/<accountId>/doors.db`).
- **Leaving** — `lockThisDevice` (sign out) and `forget-account-flow.ts` on each client.

> **An install predating this work must be recreated.** `resolveActiveStore` is purely "does
> the roster hold an account?", and the only legitimate plaintext→encrypted conversions are
> the three that establish an account on this device. There is no compatibility path, by
> choice (see *Pre-v0.1 latitude* in [`product-truths.md`](./product-truths.md)).

> **`createCore(driver, keySession?)` no longer reads its key session.** `milestone.note` was
> layer 3's only consumer and was retired with migration 27, so no repo needs a key; the parameter and
> the clients' "rebuild the core around the adopted MK" plumbing are inert. Left in place on
> purpose — photos (v0.2) are layer 3's real consumer — but on desktop the rebuild is now
> redundant as well as inert, since the store swap re-opens and rebuilds the core anyway.
> **Simplify it whenever layer 3 next gets attention.**
**Explicitly v0.2, not v0.1** *(owner, 2026-07-27)*: **automatic** locking on idle and the
bounded session. The deliberate half (sign out) is cheap; a real session needs mid-session
re-lock in the desktop main process and mobile's bootstrap, and must not be theater since the
keychain still holds the db-key. Not a one-way door — it sits on the same password door.

#### Before you rely on it

**The conversion is built and gated, not merely verified.** Desktop's lives in
`apps/desktop/src/main/db/convert-store.ts` (8 tests against the real app schema); mobile's in
`apps/mobile/db/convert-store.ts`, exercised **on device** by
`apps/mobile/test/custody-selftest.ts`, which runs beside the driver contract under
`pnpm test:native` (**36 cases**, each positive paired with its negative, confirmed RED by
sabotage before being trusted GREEN). Both files' doc-comments carry the five invariants a
change to either must preserve — read them before touching the ATTACH.

**Onboarding** (the first-run experience — design decided 2026-07-30, nothing built yet).
Full plan + increments: [`onboarding.md`](./onboarding.md). What a reader needs here:

- **Increments 1–2 are the v0.1 line.** 1 is the persistent nudge-decision table (the
  `relationship_dismissals` pattern applied to the first-run nudges) plus honest
  *Not now* / *Don't ask again* actions on the three nudges that already ship. 2 is the
  account invitation — the Open→Protected prompt that closes the data-loss path and clears
  `launch.md` Increment 4's gate.
- **Increments 3–6** — Settings decomposition + an Account screen, the optional Day-1 flow
  itself, deferred-step re-prompts, and import as a flow step — are post-gate and can land at
  any pace.
- **Four owner decisions remain open** (`onboarding.md` §7): deferral intervals, whether the
  flow reminder fires at first launch or first entity, the per-step skip defaults, and where
  import sits.

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
  CardDAV surface and the importer increment. **It also unblocks a promise already made**:
  `model.md` §7.3.1 says Forget-account should offer an export first, and today desktop's
  hard-confirm can only tell the user to copy their `stores` folder — honest but poor — while
  mobile cannot say even that (no user-reachable filesystem). Wire the real offer when the
  exporter lands.
- **Restore-from-file-backup flow — verify + document.** Both doors are proved on desktop
  against a wiped keychain, on created, joined and recovered devices alike; what remains is
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
reason this sits in Increment 1. **Increments 2–4 do not wait on custody** — the at-rest build
is finished.

**Reconciliation** (quality; can land pre- or post-launch as capacity allows):
- **Fuzzy / typo-tolerant name matching** — the scorer's reserved `"low"` tier via
  `fastest-levenshtein` or `cmpstr`, entirely inside `duplicate-score.ts`'s `sameFoldedName`
  predicate — no caller/API change.
- **`libphonenumber-js` phone normalization** — E.164 canonicalization; its own increment.
- **Pets / generalized `mergeEntities`** — small follow-on; the reference graph is entity-typed.
- **Bulk-import dedup** — deferred until the importer exists (then mostly A+B reuse,
  honoring the `not_a_duplicate` memory).

**Client / UX** (sequenced *after* the encryption work above):
- **Mobile: the last-device Forget-account confirmation needs a `KeyboardAvoidingView`.** The
  keyboard covers "Delete all data"; the screen scrolls, so it is reachable by hand, but it is
  the one step of the custody cycle no automated flow can drive — dismissing the keyboard first
  does not help, because the layout reflows as it goes and the tap lands on whatever moved
  under it. Fix the screen before trying to make that cycle an E2E flow
  ([`apps/mobile/maestro/README.md`](../apps/mobile/maestro/README.md)).
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

**Holidays — doors deliberately left open** (none blocking; the design admits each additively,
which is why they were deferred rather than built — see
[`@leapsake/holidays`](../packages/holidays/README.md) for the mechanisms):
- **Holiday reminders with no Person attached** ("get a tree"). The bearer-type enum and the
  disjoint id namespaces admit `holiday` later with no schema change.
- **Aggregate / grouped reminders** — collapsing "40 Christmas cards" into one row. **The one
  non-reversible item here**: an aggregate is a different deterministic id, so migrating later
  loses completion state. Related: **synchronized load** — everyone's Christmas reminders come
  due at once, unlike birthdays. That half *is* reversible (ids key on occurrence + action, not
  surface date), so it can be tuned whenever it starts to hurt.
- **User-defined holidays authoring UI.** The schema has been capable from day one; expected
  <1% of users.
- **Religions / Nationalities fields** as bulk-assignment accelerators, with the inference
  constraints the package README pins.
- **Observed-date shifting** (holiday falls Saturday → observed Friday). Matters for "office
  closed", barely for gifting. Leaning skip; noted, not solved.
- **Per-user greeting overlay** — "Happy Christmas" for a British user. An overlay, never an
  edit to a read-only catalog row.
- **Events** — user-defined, separate-but-related to Milestones and Holidays. Much further out.
  The distinction that motivates it: *"my family does a thing on August 3rd"* (an Event) vs.
  *"my family observes an obscure holiday on August 3rd"* (a user-defined Holiday).
- **@-mentioning holidays.** Not free (the `mentions` table references entity UUIDs; holiday
  identity is slug-based) and not a priority. The better shape for the underlying idea is
  natural-language date detection — "on Christmas" fills the due date.

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
- **Driving the desktop app without a harness** — the only way to prove a *user-visible*
  desktop change until the E2E tier exists, and how every custody slice was verified. Add `--remote-debugging-port=9333` to the command above, then talk CDP to the
  renderer: `curl -s localhost:9333/json` gives the page's `webSocketDebuggerUrl`, and
  `Runtime.evaluate` over that socket runs anything in the renderer — `window.api.*`,
  `window.sync.*`, `window.boot.*`, or DOM clicks. Node 22+ has a built-in `WebSocket`, so
  the driver is ~40 lines and needs no dependency. Pair it with **out-of-band assertions on
  the profile directory** — the store's first 16 bytes (`SQLite format 3\0` or not),
  `keystore.json`'s key list, `accounts.json`, the sidecars — since custody's defining
  properties are invisible on screen. React inputs need the native value setter plus an
  `input` event to register; `location.reload()` picks up an HMR'd renderer change without
  restarting the app. Deleting `keystore.json` between launches simulates keychain loss.
  Three things that will otherwise cost you an hour each: **`electron-vite dev` only HMRs the
  renderer**, so a change under `packages/` needs the dev server restarted before an extra
  instance picks it up (check with `grep` against `apps/desktop/out/main/index.js`); deleting
  `keystore.json` takes this device's **master key** as well as its db-key, which the boot path
  repairs from whichever door you then unlock with, so such a profile exercises the repair
  rather than merely the gate; and **deleting only `device-id` and `enclave`** from that file
  leaves the db-key alive, which is the one route to the *Degraded* state (no gate is raised,
  so nothing can repair it). A `pkill -9` of the Electron child can take `out/` with it and
  leave the dev server serving nothing; restart the dev server if a launch produces no output
  at all.
- **Mobile dev client:** `pnpm --filter @leapsake/mobile ios` (native SQLCipher build; Expo
  Go can't host it). `__DEV__` deep links: `leapsake://dev-selftest` (driver contract +
  custody suite), `leapsake://dev-clear-dbkey` (simulate keychain loss — three scopes: the
  db-key alone raises the gate, **everything** reaches the master-key repair, and **device
  identity** keeps the db-key and so reaches the *Degraded* state). Editing a self-test
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

**Custody** (live — the build is finished, but these are not decided):
- **Username collision when a local account binds a relay.** A locally-chosen username may
  already exist on the relay (it answers `409`). Two cases hide behind one error and want
  different UX: *"this is me, I made a second account by accident and want them merged"* vs.
  *"different person, I just need a different handle."* Renaming is the easy half and should
  ship with relay binding. Merging is the hard half — note that the machinery partly exists
  (`reconcileOnJoin` surfaces overlapping people after a join and deliberately does **not**
  auto-merge, leaving it to the duplicate-review surface), so "join the existing account and
  review the duplicates" may be the whole answer for v0.1. Decide before relay binding ships.
  **Weightier since 2026-07-29**: a local-only account is now one tap away on
  *both* clients, so the population that could later want to bind one to a relay is no
  longer desktop-only — while binding itself remains unbuilt on either client.
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
