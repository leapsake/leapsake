# Leapsake — Web client (`apps/web`)

> **Unbuilt work only.** The *design* for how a web client decrypts, renders, and shares
> is [`encryption/model.md`](./encryption/model.md) §9.2 (server-side decryption), §10 (the
> progressive-enhancement table), §11 (sharing), and §13 (the `KeyStore` port per client).
> Nothing here restates it. This doc holds the **spike that proves it**, increment by
> increment, and is deleted when the list empties.

**State:** nothing built. The design answers every case on paper; no line of it has been
run. This doc exists because the answer is cheap to prove *now* and expensive to discover
after v0.1 hardens the architecture.

**Scheduled pre-v0.1** *(owner, 2026-08-07)*, as a parallel track in [`v0-1.md`](./v0-1.md) —
independent of the launch prerequisite chain, and the natural filler whenever that chain is
waiting. The deciding argument was not the general one below but a specific one: two items in
*Known before starting* are **relay** changes, and the relay is the component hardening for v0.1.
Note that this schedules the **spike**, not the Stage 4 web app, which stays post-launch
([`encryption/README.md`](./encryption/README.md)).

## Why this is worth doing before v0.1

Three owner questions *(2026-08-02)*: can an authenticated sync user **view** their data
on the web; can they **share** part of it; and can both work **with JS**, **without JS**
(SSR — an accessibility and performance floor, strongly preferred), and **as a PWA**
(nice-to-have)? A web client is what makes Leapsake genuinely cross-platform and is the
render vehicle every URL-based share needs, so the cost of having foreclosed it is a
rewrite, not a feature.

Reading the code says we probably have not foreclosed it. Recorded here so the spike
starts from evidence rather than re-deriving it:

- **Zero `node:` imports across all 15 shared packages.** `@leapsake/crypto` is pure JS
  (`@noble/*`, `@scure/bip39`) and `HttpSyncTransport` takes an injectable `fetch`.
- **`SqliteDriver` is fully async** (`packages/data/src/driver.ts:9`) — six promise-returning
  methods. That is exactly the shape a wasm/OPFS or Worker-hosted database needs. A
  synchronous port would have been the expensive mistake.
- **The auth-verifier split is built, not just designed.** `deriveKeyMaterial`
  (`packages/crypto/src/kdf.ts:81`) runs one Argon2id pass and HKDF-splits it into `kek`
  and `authVerifier` under separate domain labels, so a browser can log in without the
  server ever being able to derive the encryption key.
- **The no-JS floor is already load-bearing in the shared UI.** `UiFormProps`
  (`packages/ui/src/web/adapter.tsx:24-31`) says the adapter *must* render a real `<form>`
  with `method`/`action` intact, "exactly the case where no adapter JavaScript runs and the
  browser posts the form itself," and `FormShell` (`patterns/FormShell.tsx:52`) already
  emits `<Form method="post">` with no `action` so it posts to the current URL.

So the spike's job is to convert "designed for it" into "observed working," and to
quantify three costs nobody has measured. **Deliverable is the answers**, not the code:
`apps/web-spike` is throwaway and is deleted at the end.

## Decisions already made, so the increments don't re-litigate them

- **Vite in middleware mode, not `tsx`.** Two blockers rule out the `apps/server` pattern:
  `packages/ui/src/web/primitives/Combobox.tsx:2` imports a CSS module and is on
  `PersonScreen`'s render path (via `HolidaysSection` → `MultiAddCombobox`), and `packages/*`
  write internal imports as `.js` specifiers pointing at `.ts`. Set
  `ssr.noExternal: [/^@leapsake\//]` — the same reasoning `apps/desktop/electron.vite.config.ts`
  records for its `externalizeDepsPlugin({ exclude })`. One origin then covers SSR pages, the
  relay proxy, the client bundle, the `.wasm`, and the service worker.
- **React `19.2.3` exactly** — the hoisted root pair, so no nested copy (AGENTS.md → *React
  version policy*).
- **`@sqlite.org/sqlite-wasm` for the browser database.** OPFS SAHPool needs no
  cross-origin isolation, where the older OPFS VFS needs `SharedArrayBuffer` and therefore
  COOP/COEP, which would poison the whole origin. `wa-sqlite`'s async-VFS pitch buys nothing
  because our port is already async; `sql.js` has no persistence story and so cannot answer
  the PWA question. Migrations are portable — `packages/data/src/migrations.ts` is plain DDL,
  no extensions or `RETURNING`; the only exotic statement is `PRAGMA user_version`.
- **Getting the master key server-side is four calls, not `joinAccount`.**
  `transport.lookup(username)` → `deriveKeyMaterial(password, kdfSalt)` →
  `transport.fetchBootstrap({accountId, authVerifier})` → `unwrapKey(wrappedMasterKey, kek)`.
  `joinAccount` (`packages/key-custody/src/session.ts:736`) needs a `KeyStore`, writes
  `account`/`device`/`key_wrap` rows, and refuses if an account row exists — all wrong for a
  stateless renderer.
- **Copy the driver, don't export one.** `packages/data` ships zero drivers by design;
  every app owns its own. Copy `apps/server/test/node-sqlite-driver.ts` (37 lines).
- **Governance:** `"version": "0.0.0"` or `pnpm test:versions` fails; **no** `typecheck`
  script (`pnpm -r typecheck` only sees apps that define one — and record in the findings
  that the spike was never typechecked); add `apps/web-spike/**` to `ignorePatterns` in
  `.oxlintrc.json`; leave it out of `vitest.config.ts`'s explicit include list, because
  verification here is manual and in-browser.

## The increments

Ordered so the highest-information work comes first. **Each is independently droppable** —
see *Stopping points*.

### Increment 1 — scaffold and a seeded dev account

`package.json`, `tsconfig.json`, `vite.config.ts`, `src/server.ts` (a `switch` on
method+pathname, mirroring `apps/server/src/relay.ts:436`), the copied driver, and
`scripts/seed.ts`.

The seed chain is `apps/server/test/relay.test.ts:476` (`enableAndRegister`) with a
`createCore` write phase bolted on: `runMigrations` → `createInMemoryKeyStore()` →
`ensureDeviceMasterKey` → `enableSync({…, platform: "web"})`
(`packages/key-custody/src/session.ts:447`, **password ≥ 12**) → `registerAccountWithRelay`
(`packages/core/src/sync.ts:221`) → `seedHolidayCatalog` → `createCore(driver)` writes, with
`--rows N` for 100/1k/10k → `createSyncEngine({transport, masterKey, repos: syncableRepos(driver)}).push(0)`.

**Seed the holiday catalog.** It is the bulk of a fresh account's log, and leaving it out
would make every pull measurement a lie.

Run the relay as `RELAY_DB=:memory: RELAY_BOOTSTRAP_RATE_LIMIT_MAX=100000 RELAY_RATE_LIMIT_MAX=100000 pnpm server`.
That is not only a dev convenience — **it is the first finding**. `/accounts/session` and
`/accounts/bootstrap` share a 10-per-60s *per-IP* failed-login budget, and an SSR host logs
in from one IP on behalf of every user, so a per-IP budget is structurally wrong for a web
client. Relay sessions are also in-memory per process, so a relay restart forces a re-login
— which means the SSR session store must keep the `authVerifier`, not only the master key.

**Done when** the seed prints an accountId and a second process, given only username and
password, can `pull(0)` and see the rows. **Over two hours means the spike is mis-scoped.**

### Increment 2 — the SSR read path with JS disabled *(the primary question)*

`src/ui-adapter.tsx`, `src/gifts-ports-ssr.ts`, `src/render.tsx`, `src/session.ts`,
`src/hydrate.ts`, `src/routes/{login,people,person}.tsx`.

The `UiAdapter` is six lines — `Link` → `<a href>`, `Form` → `<form method action>`. **That
it is six lines is the finding.** `PersonScreen` throws without `MessagesProvider`,
`UiProvider`, and `GiftsPortsProvider`; make the SSR gift ports **throw** on every method,
because nothing should invoke a port during render and a throwing stub is an assertion.
Serve with `Cache-Control: private, no-store` (§9.2 asks for it; it is a header).

The loader is a near-mechanical port: `apps/desktop/src/renderer/src/router.tsx:237`
`personLoader` is seven parallel `window.api.*` calls, and `window.api` mirrors `CoreApi`, so
each becomes the same call on `core` — `views.person`, `reminders.mentioning`,
`holidays.listForBearer`, `gifts.suggestions.listForRecipient`, `gifts.ideas.list`,
`gifts.given.listForRecipient`, `duplicates.findFor`. Prop wiring copies
`apps/desktop/src/renderer/src/screens/PersonView.tsx`, with both callbacks as no-ops.

**There is no shared people-list screen** — it lives only in the desktop renderer. Use
`core.views.entityList()` and render a bare `<ul>` of `<a href>`. Building a shared list
screen is product work, not spike work.

**Done when** `curl /people/<id>` and Firefox with `javascript.enabled=false` both show the
person's name, contact methods, relationships, timeline, tags, and mentioned-in reminders —
**with zero files changed under `packages/`**. Keep a running `WANTED-CHANGES.md` of every
moment you were tempted to edit a shared package; that list is a large share of the findings'
value.

### Increment 3 — the SSR write path with JS disabled

`src/routes/person-edit.tsx`, `src/routes/person-delete.tsx`, `src/form-data.ts` (body →
`URLSearchParams`, plus verbatim ports of `readPersonInput`/`readGender`/`readTags` from
`router.tsx:73-98`). `PersonForm` already wraps `FormShell`, and `ConfirmDelete` gives a
second data point on hidden fields for about twenty minutes' work.

POST: parse → `core.people.update(id, input, tags)` (`router.tsx:1188`) →
`session.pushHwm = await engine.push(session.pushHwm)` → `303`.

**Done when**, with JS disabled, editing a name returns a 303, shows the new name, and
**then arrives in the desktop app running against the same relay account**. A local write
that never leaves is not an answer; the full `seal` → relay → `open` → LWW merge round trip
is. Note as you go that the write lands in the warm per-session store, so a second session
sees it only after its next pull — the SSR analogue of desktop's revalidator, with no
equivalent yet.

### Increment 4 — sharing, both flavors contrasted

`src/shares.ts` (a `Map`), `src/routes/share-new.tsx`, `src/routes/share-view.tsx`,
`src/client/share.ts`, `src/routes/hosted-view.tsx`.

Capability link: `ck = generateKey()`, `blob = seal(utf8ToBytes(JSON.stringify(payload)), ck)`,
link is `/share/<id>#<base64url(ck)>`. `bytesToBase64` emits **standard** base64 — convert to
base64url yourself. The client half is ~15 lines: read `location.hash`, decode, `open(blob, ck)`,
`JSON.parse`, write to the DOM. **Bundle it through Vite here** — it proves `@leapsake/crypto`
compiles to a browser target, which is a five-minute early warning on Increment 5's biggest
assumption. The hosted flavor is ~10 lines: the server keeps the `ck` and SSR-renders.

**Done when** the capability link decrypts in-browser and the server's request log for
`/share/:id` contains **no fragment** — paste that log line into the findings as the
demonstration — and the hosted link renders identically with JS on and off.

**Expect to confirm, and state flatly:** capability links are *structurally* incompatible
with no-JS, because the key never reaches the server. That is why §11 lists two flavors. The
spike's job is to show the cost is real and small, and that the hosted fallback is a ten-line
route.

*Optional quarter-hour, outsized value:* render the shared payload through
`RelationshipScreen` (zero callback props, fully SSR-clean) to test whether shared screens are
reusable in an **unauthenticated** context.

### Increment 5 — the browser JS path

Spike-sized only if "can it work" is split from "is it usable." The lever: **the desktop
main/renderer split is isomorphic to the browser main-thread/Worker split.**
`window.api.people.get(id)` is `ipcRenderer.invoke`; a path-addressed `postMessage` proxy over
`CoreApi` is ~40 lines. This re-hosts `core` behind a different RPC — it re-implements nothing.

Vite needs `optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] }`; the package resolves its
`.wasm` relative to `import.meta.url` and pre-bundling breaks that.

- **5a — the wasm driver and the contract.** Run `runDriverContract` from
  `@leapsake/data/testing` **in the browser**, exactly as mobile runs it on a simulator — copy
  `apps/mobile/test/driver-contract-selftest.ts` and its `createCollectingTestApi`. No vitest
  browser mode; the contract is framework-agnostic by design for precisely this. Gotcha:
  `DriverFactory` is synchronous but `sqlite3InitModule()` is async, so await the module once
  at page top level and let the factory synchronously do `new sqlite3.oo1.DB(":memory:")` —
  the same trick the mobile factory uses. **Done when the page reports 12/12 and
  `runMigrations` completes.** Green means the browser data layer is proven and the rest is
  plumbing; red is a precise, cheap answer.
- **5b — client login, pull, decrypt** on the main thread with `:memory:`. Freeze the tab;
  prove the capability first. Same four calls as the server, then `runMigrations` →
  `createSyncEngine(...).pull(0)` → `createCore` → render `PersonScreen` with the *same*
  `ui-adapter.tsx`.
- **5c — Worker and OPFS.** Move sqlite-wasm, `createCore`, `createSyncEngine`, and
  `deriveKeyMaterial` into the worker; the main thread keeps React and the RPC proxy. Switch to
  `installOpfsSAHPoolVfs()` + `new poolUtil.OpfsSAHPoolDb("/spike.db")`. **Done when** the page
  stays interactive through login and the full pull, and a reload does not re-pull.
- **5d — PWA.** Manifest plus a service worker caching shell, JS, and `.wasm`.
  `http://localhost` is a secure context, so no TLS. **Done when** DevTools-offline reload
  renders the person from the OPFS database.
- **5e — browser key custody.** Half an hour, and arguably the most valuable half-hour here.
  Offline access needs something persisted that unwraps the local database; desktop and mobile
  use an OS enclave via the `KeyStore` port and **the browser has no equivalent**. Probe the
  closest analogue: a **non-extractable** `AES-KW`/`AES-GCM` `CryptoKey` in IndexedDB
  (unextractable by JS, origin-bound) wrapping the master key — mint, wrap, reload, unwrap,
  decrypt a row. Success answers "what is the browser's `KeyStore`?", which §13 leaves open.
  Failure means PWA offline costs an Argon2id run on every cold start, which is a product
  decision, not an engineering one.

#### The CORS gap — proxy for the spike, but name the real change

The relay sends no CORS headers and handles no `OPTIONS`, so **a browser cannot call it
today**. For the spike, forward `/relay/*` → `RELAY_URL/*` from the spike's own origin (~20
lines). This needs **zero transport changes**: `http-transport.ts` builds every URL by string
concatenation (`${base}/accounts/session`, lines 224-381), never `new URL(base)`, so a relative
`baseUrl: "/relay"` resolves against the page origin — and same-origin means no preflight,
which matters because the `Authorization` header would otherwise force an `OPTIONS` the relay
404s. Proxying beats patching `apps/server` because the relay is the thing hardening, and a
reverted CORS patch is exactly the kind of change that survives revert by accident.

**The caveat belongs in the findings, not buried here:** the proxy sees
`Authorization: Bearer <accountId>.<b64(authVerifier)>`. The verifier is an independent HKDF
branch, so it reveals nothing about the KEK and **confidentiality genuinely survives** — but
the proxy could impersonate the account to read and write ciphertext, an availability and
integrity trust dependency production must not have. So the real conclusion is that
**the relay needs CORS + `OPTIONS` before any browser client can exist** (~6 lines behind a
`RELAY_CORS_ORIGINS` env var). Do not let the proxy launder that into "no relay change needed."

### Increment 6 — write the findings, tear the spike down

`plans/v0-1_web-spike.md` (this doc) is rewritten into the answers, structured as answers rather than
narrative: the three questions resolved in three sentences; the measurement table; the required
relay and shared-package changes; the no-JS section inventory below; the two sharing flavors;
and the open questions that survived. Then delete `apps/web-spike` and revert the
`.oxlintrc.json` line.

## Two design points the spike must not skip

**Implement the real split session key** (§9.2 Scenario 1), not a plaintext master-key map.
It is ~30 lines over the already-exported `generateKey`/`wrapKey`/`unwrapKey`: at login mint a
session key, store `wrap(MK, sk)` server-side, put `sk` in an `httpOnly` cookie, unwrap into
request-scoped memory per request. Build it because it surfaces two things a map would hide:

1. **The session store also needs the `authVerifier`** — to re-login after a relay restart and
   to refresh session tokens. Held in the clear beside the wrapped MK it partly defeats the
   split, since a store thief gets a standing relay credential and therefore all the ciphertext.
   Wrapping it under the same session key is one more line, and a genuine refinement §9.2 does
   not currently spell out.
2. **A warm decrypted store defeats the split entirely.** §9.2 promises the server holds
   nothing standing-decryptable at rest, but a warm per-session SQLite is a fully decrypted
   database in server memory that needs no cookie to read. §9.2's own next bullet —
   "memory-only, request-scoped, zeroized" — is the real constraint, and a warm cache violates
   the request-scoped half.

**Where the decrypted store lives is a measurement, not a preference.** Build warm-per-session
as the default with cold-per-request behind a flag, because the whole question is the ratio and
one implementation cannot give it. Cold is a fresh in-memory DB → migrate → `pull(0)` →
`createCore` → render → discard: maximum privacy, matching §9.2 as written. Warm is a map keyed
by session with an idle TTL, pulling the *delta* per request. One nearly-free optimization worth
measuring: `node:sqlite`'s `DatabaseSync` exposes `serialize()`/`deserialize()`, so the
migrations can run once at boot and be deserialized per hydrate.

**The decision rule:** if cold's p50 is under ~150 ms at realistic store size, take cold — it is
simpler *and* the better privacy story, and the §9.2 conflict evaporates. If cold is seconds,
warm is forced, and the findings must say plainly that the SSR web app holds decrypted user data
in server memory for the session lifetime. That is a product-visible trust claim, not an
implementation detail.

## What to measure

Keep it all in one `src/measure.ts` so it is one file to read and one to delete.

- **Argon2id server-side**, around the `deriveKeyMaterial` call — and **the blocking**, via a
  `setInterval(…, 50)` event-loop lag probe recording max delay spanning a login. "Argon2 costs
  900 ms" is interesting; "Argon2 stalls every other in-flight request by 900 ms" is decisive,
  because it means a real SSR host needs a worker pool or a native Argon2 binding, and neither
  exists in the repo.
- **Argon2id in-browser**, main thread (5b) and worker (5c), with the device recorded — a phone
  is the case that matters.
- **Pull + decrypt + apply.** `pull` exposes no sub-timings, so wrap the *transport* (~10 lines)
  to record per-call ms, record counts, and wire bytes; **decrypt+apply = total − transport**.
  Report `rows | wire bytes | transport ms | decrypt+apply ms | ms per row` at 100/1k/10k in
  **both** Node and browser — that side-by-side says whether the client-side zero-knowledge path
  is viable. Note that `/sync/pull` has no LIMIT and no pagination and `readBody` accumulates the
  whole body into a string, so the 10k row is also a relay finding.
- **Peak RSS per warm session**, in-process rather than over HTTP, sampling after `global.gc()`
  at N = 1/5/10/25/50. **Trap:** a `:memory:` database's pages live in native memory, so
  `heapUsed` looks flat and lies — `rss` is the only faithful number.

## Known before starting

Things the spike should confirm and cost, not discover:

- **The relay needs CORS + `OPTIONS`** before any browser client exists.
- **Per-IP rate limits are wrong for an SSR host**, which logs in from one IP for all users.
- **`/sync/pull` has no pagination**, and the whole body is buffered as a string.
- **`packages/data` ships no browser driver** — and by policy ships none, so the web client owns
  one, like every other app.
- **The no-JS section inventory for `PersonScreen`.** Working today, because every mutation is
  expressed as navigation to a `/new`, `/edit`, or `/delete` route: `ContactMethodsSection`,
  `RelationshipsSection`, `MilestonesSection`, `TagsSection`, `MentionedInSection`. Needing JS:
  `GiftsSection` and `GiftIdeaRecipientsSection` (`useState` + `onClick`, and `useGiftsPorts()`
  throws without a provider) and `HolidaysSection` (Combobox + buttons). The spike should add a
  one-line verdict per JS-requiring section on whether a link/form rewrite is plausible — that
  list is the concrete backlog a real web client works from.

## Stopping points

- **After Increment 2** — you know whether a no-JS web read path exists. A clean yes with zero
  package edits is most of the value on offer.
- **After Increment 5a** — you know whether the browser data layer is possible, for a couple of
  hours, before committing to the rest of Increment 5.
- Increments 3, 4, and 5b-e are each droppable without invalidating what came before.

## Open questions

- **Framework.** Deliberately still open, and the spike must not settle it by accident — that is
  why it uses bare `node:http` + `renderToString` rather than Remix / Next.js / React Router. The
  spike measures what any framework would have to carry; pick one afterward.
- **Whether the warm-store trust claim is acceptable**, if the measurement forces warm. A product
  call, not an engineering one.
- **Whether server-side Argon2id needs a native binding or a worker pool**, which the event-loop
  measurement decides.
- **The browser's `KeyStore`** — §13 lists PWA custody as "weak — IndexedDB, no enclave →
  passkey PRF is the right custody answer." Increment 5e probes the cheaper non-extractable
  `CryptoKey` option; passkey PRF remains the designed answer and is untested.
- **Media and the no-JS floor** — [`v0-2.md`](./v0-2.md) already raises it: serving decrypted
  media to a no-JS browser means the render server transiently holds *file* keys, and whether
  media is exempt from the floor is undecided. Out of scope for this spike (no blobs exist yet),
  but the SSR measurements here are the input to that decision.
