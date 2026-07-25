# Leapsake — Status & Next Steps (the single oracle)

> **This is the one file that tracks status across every workstream.** Picking up work?
> Read this file for *what to do next*, then the relevant design doc for the *why*.
> The history of a **finished** increment lives in `git log` + the code's own doc-comments,
> not here. Design docs never restate status; this file never restates design.
>
> **Updated 2026-07-20** — **Holidays shipped on both clients** — a `@leapsake/holidays` catalog +
> recurrence engine, three synced tables (holidays / observances / hidden_holidays), the `/holidays`
> browse + an autocomplete for authoring observances from either end, engine wiring to `system`
> reminders, global search, and a per-observance schedule editor. Delivery detail in `git log`. See
> *What's next* for what remains.

## Where things stand

- **V1 desktop + V1.5 local CRM** and **V2 mobile** (feature-complete vs. desktop, verified
  iOS + Android) — ✅ done. (Delivery history: `git log`; durable lessons:
  [`../AGENTS.md`](../AGENTS.md) and the package READMEs.)
- **V3 · Encryption + sync** — **Stages 1 (zero-knowledge sync) and 2 (at-rest) are done on
  both clients**, verified over the wire and on-disk. **The recovery-phrase increment is
  done** (24-word phrase recovers both loss events; UI verified on both clients). **Relay
  hardening: H3 done; only non-v0.1-blocking items remain** (see *What's next*). Stages 3–4
  (sharing, SSR web) are post-launch. Design: [`encryption/`](./encryption/).
- **V3 · Reconciliation (dedup & merge)** — Increments A, B, and C's merge-on-join are
  built; only C's bulk-import dedup remains (deferred until the importer exists). The
  review surface is now **detection-driven rather than permanently advertised**: the old
  unconditional "Review duplicates" link on People & Pets is gone, replaced by a
  count-stating link that appears only when pairs are outstanding; saving a person that
  matches an existing one lands on a **scoped** review (`/duplicates?for=<id>`) that is
  always skippable; both people in a pair carry a banner on their own page; a fourth
  `system` reminder family puts a summary nudge on Home; and finishing an import routes to
  the review when the commit left pairs behind. Design:
  [`packages/core/README.md`](../packages/core/README.md).
- **Files / media** — nothing built; design invariants pinned in [`files.md`](./files.md).
  Photos are the v0.2 headline (first consumer of that design).
- **Holidays** — **built on desktop, end to end.** `@leapsake/holidays` owns the catalog and the
  recurrence engine (fixed / nth-weekday / computed / offset / precomputed-table behind one
  `occurrencesFor`); migration 22 adds three synced tables; the bundled catalog seeds itself
  through the sync merge path, gated on a device-local `CATALOG_VERSION`; `/holidays` browses it
  and an **autocomplete** answers "who do you celebrate with?" — mirrored by a Holidays section on
  Person and Pet screens, so an observance is authorable from either end; and the reminder engine grew a
  parallel `holidays` port that mints one `system` reminder per (observance × occurrence × enabled
  rule), keyed on the occurrence **date** so a lunisolar holiday falling twice in one Gregorian
  year doesn't collapse. Design: [`holidays/research.md`](./holidays/research.md) (§4's four open
  questions are now settled there). Holidays are also **searchable** (their own result type, on the
  `tag` precedent), and each observance has its own **reminder-schedule editor** — needed because
  observance defaults ship with every action off. The two lunisolar tables are now **derived and
  cross-checked** (Hanukkah from the arithmetic Hebrew calendar; Lunar New Year from true new moons
  in UTC+8 with the leap-month rule), each verified against a second independent implementation and
  against published dates for years already past, and both run to **2056**. **Nothing outstanding.**
- **Reminders (home-screen surface)** — a user-generated, syncable Reminder entity (freeform
  title/body, reversible completion, inline `#tags`, **due dates**), the **landing / Home screen on
  both clients** (People & Pets at `/people`; inline `#tags` link to their tag page and a tag's page
  lists its reminders). **Now populated by automation:** an `@leapsake/reminders` **birthday engine**
  emits `source: "system"` reminders (reconciled on boot/focus *and* every milestone / person write),
  and **`@mentions`** are a synced two-way backlink (a reminder's mention links to the person/pet; an
  entity's page lists the reminders that mention it — birthday reminders link their own subject).
  System reminders are engine-owned, so their text is **non-editable** (completing/deleting still
  work). **The compose surface is complete** (an `@`-triggered People/Pets picker + a `#`-triggered tag
  typeahead, folded into one `MentionTextField` per client), and **per-milestone staggered schedules are
  now wired into the engine** — one `system` reminder per enabled rule, offset by `offsetDays`,
  action-phrased, and **onboarding nudges** now fill a brand-new user's empty Home (CTA-wired on
  both clients). Remaining: reminder search.
- **Testing harness** — the tiered `pnpm test` orchestration is built: `scripts/test-all.mjs`
  runs each trophy tier (static · lint · typecheck · unit+integration · driver-coverage gate)
  and the **mobile native tier on both platforms** — per-platform `native-android` /
  `native-ios` rows (`ready`); the still-**blocked** E2E tier is reported as ⏳ (never silently
  skipped), as is any native platform whose device isn't booted. `pnpm test` = fast local suite
  (skips the device tiers via a `device: true` marker); `pnpm test:all` = everything reachable.
  The **driver-coverage forcer** gates the desktop driver file at 100% (a new driver path fails
  until a contract case covers it). **Step 3b + the step-9 iOS half are done:** `pnpm test:native`
  (`scripts/test-native.mjs`) is split into a platform-agnostic core + `android`/`ios` drivers;
  it auto-detects each booted device (or `--platform=ios|android`), loads the dev-client bundle
  (Android via an `adb` deep link; iOS via the `ios-prepare.yaml` dev-launcher reconnect, since
  the deep link is intercepted by a SpringBoard confirm on iOS), deep-links to the `__DEV__`
  self-test (`leapsake://dev-selftest`), and the **byte-identical** vendor-neutral Maestro flow
  (`apps/mobile/maestro/driver-selftest.yaml`) asserts the `driver-selftest-status` element's
  `PASS` label — non-zero exit on FAIL/ERROR. Runner exit codes 0/1/3 = PASS/FAIL/BLOCKED, which
  the orchestrator maps to the per-platform rows. Verified on Android **and** iOS (PASS + a
  deliberately-broken RED run; iOS also verified the un-booted-sim BLOCKED path). The script
  fails with the exact setup command if a device / dev build / Metro isn't prepared. Owner
  decisions landed: **Maestro** for mobile E2E, tiered+umbrella `pnpm test` shape. **The
  crucial-flow catalog is now drafted** ([`testing/crucial-flows.md`](./testing/crucial-flows.md),
  pending owner sign-off). Next E2E bricks: desktop macOS Playwright E2E → mobile E2E flows on the
  same harness → iOS E2E half. Design: [`testing/`](./testing/).

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
- **Restore-from-file-backup flow — verify + document.** At-rest encryption made the local
  file opaque to generic backup tools; the intended story is "copied `leapsake.db` +
  `leapsake.db.recovery` + the phrase on a fresh machine boots through `RecoveryGate`."
  Confirm it actually works end-to-end, then document it as *the* local backup answer
  (local-only users have no other one).
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
can't ship without distributable apps. (None yet.)

**Reconciliation** (quality; can land pre- or post-launch as capacity allows):
- **Fuzzy / typo-tolerant name matching** — the scorer's reserved `"low"` tier via
  `fastest-levenshtein` or `cmpstr`, entirely inside `duplicate-score.ts`'s `sameFoldedName`
  predicate — no caller/API change.
- **`libphonenumber-js` phone normalization** — E.164 canonicalization; its own increment.
- **Pets / generalized `mergeEntities`** — small follow-on; the reference graph is entity-typed.
- **Bulk-import dedup** — deferred until the importer exists (then mostly A+B reuse,
  honoring the `not_a_duplicate` memory).

**Client / UX** (sequenced *after* the encryption work above):
- **Reminders — remaining work.** The entity, Home promotion, automation (birthday + per-milestone
  staggered schedules + **holidays**), `@mentions`, the compose surface (`@`/`#` pickers), and
  onboarding-as-reminders are all done — see the *Where things stand* bullet, and the engine now
  carries a fourth family for the **duplicates nudge** (content-addressed on the outstanding pair
  set, so unlike onboarding it can legitimately re-appear). **Next: reminder
  search** (reminders join `SearchResultType` the way gift ideas did, matched on title + body);
  Leapsake-defined tasks extend the same engine later, keyed off `source` + trigger identity.
- **Holidays — done.** The lunisolar tables are sourced and extended to 2056 (`CATALOG_VERSION` 2).
  Every provisional date held up under verification — none were wrong — but they are now *derived*
  rather than remembered, and the horizon went from ~9 years to 30. Derivation and the two
  borderline Lunar New Year years are documented in `packages/holidays/src/catalog.ts`. The only
  future task is calendrical and distant: **extend both tables before ~2050**, re-deriving rather
  than extrapolating.

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
