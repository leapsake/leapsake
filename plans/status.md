# Leapsake — Status & Next Steps (the single oracle)

> **This is the one file that tracks status across every workstream.** Picking up work?
> Read this file for *what to do next*, then the relevant design doc for the *why*.
> The history of a **finished** increment lives in `git log` + the code's own doc-comments,
> not here. Design docs never restate status; this file never restates design.
>
> **Updated 2026-07-26** — **The local-custody decision is made: encryption follows
> custody.** First launch will mint no keys and leave the store plaintext; creating an
> account (username + password) is the single act that turns encryption on, and the recovery
> phrase becomes its forgot-password backstop instead of a first-run ritual. The model is in
> [`encryption/model.md`](./encryption/model.md) §7.2–7.4, the key lifecycle in
> [`custody-sequence.md`](./encryption/custody-sequence.md) (Phase 0 now creates *nothing*;
> new Phase 0.5 creates everything), and the build order below. `local-custody-options.md`
> is **retired** — it existed to be decided, and it was; the reasoning that survives lives in
> `model.md`. Also: **the UI extraction is finished** — `@leapsake/ui` holds every
> presentational component the desktop renderer had, and the new `@leapsake/view-models` holds the
> derivations desktop and mobile each kept a copy of; rationale lives in the two package READMEs.

## Where things stand

- **V1 desktop + V1.5 local CRM** and **V2 mobile** (feature-complete vs. desktop, verified
  iOS + Android) — ✅ done. (Delivery history: `git log`; durable lessons:
  [`../AGENTS.md`](../AGENTS.md) and the package READMEs.)
- **V3 · Encryption + sync** — **Stages 1 (zero-knowledge sync) and 2 (at-rest) are done on
  both clients**, verified over the wire and on-disk. **The recovery-phrase increment is
  done** (24-word phrase recovers both loss events; UI verified on both clients) — though the
  phrase's *role* is under review, see *What's next* → *Local custody*. **Relay
  hardening: H3 done; only non-v0.1-blocking items remain** (see *What's next*). Stages 3–4
  (sharing, SSR web) are post-launch. Design: [`encryption/`](./encryption/).
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
> **1.** Local custody — *decide*, then build (below; blocks `launch.md` Increments 2–4).
> **2.** `launch.md` Increment 1's leftovers — trivial, unblocked, permanent-if-wrong (versions,
> credential gitignores). Can be done in parallel with 1.
> **3.** The rest of `launch.md` in its own numbered order, once 1 is resolved.
> **4.** Everything else in this section — genuinely interleavable as capacity allows, no
> dependencies between them.
>
> Sections after *Pre-v0.1* are **not** a queue; they are staged buckets (v0.2, post-launch).

**⇒ Local custody — decided 2026-07-26; now build it. It leads everything else.**

**The decision: encryption follows custody.** First launch mints no keys and writes a
plaintext store; creating an account (username + password) turns on encryption, mints the
recovery phrase, and converts the store. Full model: [`encryption/model.md`](./encryption/model.md)
§7.2 (states), §7.3 (lock/log out), §7.4 (per-user stores), §8.1 (the conversion pattern);
lifecycle in [`custody-sequence.md`](./encryption/custody-sequence.md) Phases 0 → 0.5 → 1.

**Why it leads:** it changes what a fresh install does with real data, and `launch.md`
Increments 2–4 are all consequences of it. It also **defuses `launch.md` §2's central
hazard** — the Team-ID change that would have dropped every user into `RecoveryGate` costs
an accountless user nothing (no keys to lose) and costs an account holder a password entry.

**Build order** — each slice is independently shippable:

1. **Don't create keys at first launch.** Both clients' boot paths
   (`apps/desktop/src/main/db/open.ts`, `apps/mobile/lib/core-context.tsx`) currently mint a
   db-key and call `ensureDeviceMasterKey` unconditionally. Make both conditional on an
   account existing, and open the store plaintext when none does. `createCore(driver,
   keySession?)` already accepts an absent key session, and `milestones-repo.ts` already
   stores plaintext without a cipher — so the keyless mode is a supported path, not new code.
   Keep the existing encrypted-store branches working untouched (dev installs are encrypted).
2. **Per-account store paths** (`stores/<accountId>/…` + the roster, `model.md` §7.4) —
   do it in the same pass as 1, while there is exactly one store to move. Cheap now,
   expensive later.
3. **The account-creation flow**: username + password → mint keys → convert the store
   (§8.1) → show the phrase once. Reachable from the Home invitation and from Settings; the
   two entry points run the *same* flow. Much of the surrounding machinery exists —
   `enableSync` already takes `username`/`relayUrl` as optional (local-before-relay
   accounts), `enableSync`/`joinAccount` already *is* sign-up/log-in, and the
   onboarding-nudge engine already computes the trigger signal.
4. **The password door on the db-key sidecar** — `seal(db-key, KEK)` beside the recovery
   one, consumed in the pre-database boot path on both platforms. This is the most delicate
   code in the app and it now has two doors to prove (see Increment 3 in `launch.md`).
5. **Lock** (`model.md` §7.3) — a real re-lock, not theater, plus the bounded session over
   the enclave cache. Prerequisite for the session dial and for "log out" to mean anything.

**Verify before relying on it:** that mobile's SQLCipher build opens a plaintext database
and runs the attach-and-copy conversion (`model.md` §8.1 — desktop is verified, mobile is
not). Use the in-app self-test. If it can't, slice 3's mobile half needs a different shape.

**Open sub-questions** (see also *Open questions* below): session lifetime, its Settings
dial, and the "never expires" warning; whether mobile unlocks by biometrics with a password
floor for true expiry; and the username-collision question when a local account binds a relay.

**Blocks:** `launch.md` Increments 2, 3, and therefore 4 (the first closed-test upload puts
real data in ≥12 testers' hands — do not ship custody churn to them afterwards).

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
- **Restore-from-file-backup flow — verify + document.** *(Sequenced after the custody work
  above, which gives the sidecar a second door.)* At-rest encryption made the local file
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
[`launch.md`](./launch.md). **Increment 1 is partly done already** — bundle IDs are
`com.leapsake.app`; the leftovers are trivial and unblocked by anything above (versions are
still `0.0.0` in all four `package.json`s, and `.gitignore` carries none of the credential
shapes Increments 4/7 introduce — `*.p12`, `AuthKey_*.p8`, `*.mobileprovision`, `*.jks`,
`*.keystore`, `credentials.json`). Do that now; **Increments 2–4 wait on the custody
decision.**

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
- **Mobile dev client:** `pnpm --filter @leapsake/mobile ios` (native SQLCipher build; Expo
  Go can't host it). `__DEV__` deep links: `leapsake://dev-selftest` (driver contract),
  `leapsake://dev-clear-dbkey` (simulate keychain loss).

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
- **Session lifetime and its dial** — default length, the Settings control, and what the
  "never expires" warning says. Bound to **Lock** (`model.md` §7.3).
- **Biometrics on mobile** — Face ID / Touch ID as the everyday unlock, with a true session
  expiry still demanding the password so the credential gets rehearsed.
- **Auto-purge an idle logged-in device?** The counterweight to "encrypted data sitting on a
  device indefinitely." Safe default plus a dial, or not worth the complexity — undecided.

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
