# Leapsake — Status & Next Steps (the single oracle)

> **This is the one file that tracks status across every workstream.** Picking up work?
> Read this file for *what to do next*, then the relevant design doc for the *why*.
> Detailed narratives of **finished** increments live in [`shipped.md`](./shipped.md)
> (the archive) — don't load it unless you need the history of a specific increment.
> Design docs never restate status; this file never restates design.
>
> **Updated 2026-07-05** (docs restructured: shipped narratives moved to `shipped.md`;
> product-posture decisions + the auth-hardening decision recorded; `files.md` added).

## Where things stand

- **V1 desktop + V1.5 local CRM** and **V2 mobile** (feature-complete vs. desktop, verified
  iOS + Android) — ✅ done. (Delivery history: git + [`shipped.md`](./shipped.md); durable
  lessons: [`../AGENTS.md`](../AGENTS.md) and the package READMEs.)
- **V3 · Encryption + sync** — **Stages 1 (zero-knowledge sync) and 2 (at-rest) are done on
  both clients**, verified over the wire and on-disk. **The recovery-phrase increment is
  done** (24-word phrase recovers both loss events; UI verified on both clients). **Relay
  hardening is in progress** (see *What's next*). Stages 3–4 (sharing, SSR web) are
  post-launch. Design: [`encryption/`](./encryption/).
- **V3 · Reconciliation (dedup & merge)** — Increments A, B, and C's merge-on-join are
  built; only C's bulk-import dedup remains (deferred until the importer exists). Design:
  [`packages/core/README.md`](../packages/core/README.md).
- **Files / media** — nothing built; design invariants pinned in [`files.md`](./files.md).
  Photos are the v0.2 headline (first consumer of that design).

## Product posture (decided 2026-07-05)

These four decisions shape sequencing below; the accessibility principle behind them is in
[`encryption/model.md`](./encryption/model.md) §1.

- **Laypeople first, power users under the hood.** Defaults must work for someone who has
  never heard of a key or a relay; every stronger-or-different choice is a visible-but-
  optional dial, never a prerequisite.
- **v0.1 ships without a hosted relay.** Multi-device sync users self-host `apps/server`
  (single-device use needs no server at all and stays the layperson-complete path). The
  design still optimizes the layperson flow so nothing needs reworking when the hosted
  relay arrives.
- **Storage/hosting strategy is incremental and reversible:** self-hosted relay (v0.1) →
  official paid hosted relay → user-customizable/BYO storage. Mantra: *simplicity and
  security first, followed closely by total customizability.*
- **v0.2 = photo management**, built as the first consumer of the file-type-agnostic
  encrypted-blob design ([`files.md`](./files.md)) so video/documents/audio later reuse the
  same pattern.

---

## What's next

> **v0.1 launch line.** The web app is post-launch, and it's the render vehicle for every
> URL-based share — so capability links and Stage 3 sharing defer with it. Mobile + desktop
> + the (self-hosted) blind relay are judged enough for v0.1 person-data management.

### Pre-v0.1 (toward initial launch)

**Encryption + sync:**

- **Relay hardening.** Landed: recovery-endpoint throttle, proxy-aware client IP, the
  bootstrap online-guessing throttle (H2), convergence-DoS hardening (M3), **H3's
  short-lived session tokens**, and **H3 TLS — fully done** (2026-07-05): both the
  Caddy-in-front (Option A) and in-process (Option B) TLS paths ship, plus the esbuild
  single-file bundle, `apps/server/Dockerfile`, root `docker-compose.yml`, the README
  Deploy section, and a plain-HTTP-with-no-TLS-and-no-proxy startup warning. **H3 is
  complete for v0.1.** Details in [`shipped.md`](./shipped.md); findings backlog in
  [`encryption/security-findings.md`](./encryption/security-findings.md). Remaining, in order:
  1. **Shared cross-process rate-limit counter** — today's limiters *and* session store are
     in-memory, per-process; a multi-node relay collapses them (one shared follow-up).
  2. **H1 — decided 2026-07-05: OPAQUE, gated on the hosted-relay era** (not v0.1). The
     decision + rationale (why OPAQUE over a 1Password-style Secret Key, where passkeys fit)
     is recorded in [`encryption/sync.md`](./encryption/sync.md) §4 *Auth-hardening decision*.
     v0.1 self-host posture: current verifier scheme + H3, plus an honest note in the
     self-hosting docs that a relay operator could attempt offline guesses against a weak
     password — use a strong one.
- **Recovery-phrase unification (one account, one phrase).** Today a password-joined device
  reveals its *own* first-launch phrase, which cannot recover the account — a layperson trap
  (every device should show the same phrase, matching the mental model). Direction: sync
  `wrap(accountRecoveryKey, MK)` as a `key_wrap` row so any device holding MK can reveal the
  account phrase, then have password-join **adopt** the account recovery key for its local
  sidecar too (the cross-device *recovery* flow already does exactly this adoption — join
  should match it). Circular wrapping of two random keys is sound (MK compromise is already
  total); re-verify at build time.
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
- ✅ **Done (2026-07-05):** `apps/server/Dockerfile` (a single bundled file, zero runtime
  `node_modules`), root `docker-compose.yml` (relay + Caddy auto-TLS), and the deploy doc
  (README → Deploy) — the TLS-in-front path that pairs with H3.
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
- **Home screen** — a task/reminder surface (upcoming birthdays/holidays + user- &
  Leapsake-defined tasks) on the existing desktop + mobile clients. Doubles as the first-run
  **sync-onboarding** entry point ("Already using Leapsake on another device?"). (New
  workstream; design TBD.)

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
