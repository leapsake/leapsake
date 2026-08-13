# Leapsake — Web client (`apps/web`)

> **Unbuilt work only.** The *design* for how a web client decrypts, renders, and shares
> is [`encryption/model.md`](./encryption/model.md) §9.2 (server-side decryption), §10 (the
> progressive-enhancement table), §11 (sharing), and §13 (the `KeyStore` port per client).
> Nothing here restates it. This doc holds the **spike that proves it**, increment by
> increment, and is deleted when the list empties.

**State:** Increments 1, 2, 3 and 4 are **done** *(2026-08-12)*, and with them the primary
question, the CRUD question the owner sharpened it into, and both sharing flavors. A
person's page server-renders with JavaScript disabled; create / edit / delete all work with
JavaScript disabled and land on a second device through a real relay; and a capability link
decrypts in the browser from a key the server is observed never to receive, with the hosted
fallback a ten-line SSR route — all of it with **zero files changed under `packages/`**. The
adapter a no-JS client owes the shared UI is six lines. The findings live beside the code
that produced them, in [`apps/web-spike/README.md`](../apps/web-spike/README.md), until
Increment 6 folds them into this doc and deletes the app.

**Next: Increment 5.** Its 5a is the next real stopping point, and 5b-e are each
independently droppable.

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

### Increments 1 and 2 — done *(2026-08-12)*

The scaffold, the seeded relay account, and the no-JS SSR read path. Both done-whens were
met, including *zero files changed under `packages/`*. The answers are in
[`apps/web-spike/README.md`](../apps/web-spike/README.md); the record of what the
zero-edits constraint cost is `apps/web-spike/WANTED-CHANGES.md`. Four results change what
the increments below should expect, so they are repeated here rather than only there:

- **Argon2id dominates, and the store does not.** ~355 ms at every size, and it stalls the
  whole event loop. What needs to be warm is the *key*, not a decrypted store.
- **Cold-per-request with a warm key wins the §9.2 measurement** — 6.6 ms p50 at 100
  people, 36.8 ms at 1 000, against the ~150 ms rule below. **The decision is made: take
  cold.** No warm decrypted store, so the trust claim *Two design points* warned about is
  not forced. That section is kept for its second half, which the build confirmed.
- **`duplicates.findFor` is O(n²) on every person page** — 11.8 s of a 12.1 s request at
  10 000 people, against 0.8 ms for the other six loader calls combined. Not an SSR
  finding: desktop makes the same call on the same screen.
- **The relay's per-IP failed-login budget is confirmed wrong for an SSR host**, as
  predicted in *Known before starting*, and lifted with env vars rather than patched.

One caveat to carry: the JS-disabled half was verified by parsing the markup — the response
carries no `<script>` and no inline handler, so the DOM is identical either way — but **not
by driving Firefox**, which no headless browser in the dev shell would do. A manual
`javascript.enabled=false` load is still owed.

### Increment 3 — done *(2026-08-12)*

Create, edit and delete a person with JavaScript disabled, each one observed arriving on a
second device through a real relay. **Done-when met, automated as
`pnpm --filter @leapsake/web-spike roundtrip` (9/9), and still zero files changed under
`packages/`.** Full findings in [`apps/web-spike/README.md`](../apps/web-spike/README.md);
four results change what the increments below should expect, so they are repeated here.

- **The actions and the field readers ported verbatim**, one edit each: the readers take
  `URLSearchParams` where desktop passes `FormData`, and nothing else differs, because the
  desktop write path was **`FormData`-shaped rather than Electron-shaped**. `PersonForm`
  serves create and edit on two URLs because `FormShell` emits `<form method="post">` with
  no `action` — the shared-form property usually assumed lost without JavaScript.
- **`pushHwm = 0` is wrong and it compounds, which is the increment's real finding.** This
  doc prescribed `session.pushHwm = await engine.push(session.pushHwm)`. Because the relay
  is an **append-only log with no compaction** and a cold host must `pull(0)`, a session's
  first write re-pushes the whole store *permanently*: five logins-with-one-create took a
  128-record account to 793 records and its list page from 5.6 ms to 24.2 ms, against 135
  records and 5.0 ms once fixed. The fix needs no durable state — the mark is the cold
  store's own `MAX(updated_at)` after the pull — but **the obvious spelling of it,
  `Date.now()`, silently drops writes**, because `listChangedSince` is `updated_at > ?`
  strictly at millisecond resolution. Four writes in five pushed zero records behind a
  successful 303 before that was caught. `SyncEngine` should expose the mark; see
  `WANTED-CHANGES.md`.
- **Cold makes the round trip impossible to fake**, and confirms the prediction that
  inverted this doc's earlier text: every request re-pulls, so a write that was not pushed
  vanishes from the web client too, and staleness is a property of the warm arm only.
- **Relationships-on-create are inert without JavaScript** — a third entry for the no-JS
  inventory, alongside the holiday add-field and `GiftCaptureForm`, and the same verdict:
  the shape is product work. The pleasant surprise is `ChipTextField`, the most
  JavaScript-heavy field in the shared UI, which in `grammar="tags"` mode **degrades
  cleanly** because the visible input carries `name` itself.

Two things were deliberately not done, as planned: the holiday add-field and
`GiftCaptureForm` stayed out of scope (both need `packages/` edits), and
`duplicates.findFor` was ported into the create redirect rather than fixed — so the
quadratic call is now on the write path too, priced and left alone.

### Increment 4 — done *(2026-08-12)*

Both §11 flavors, made and viewed, contrasted on one page. **Done-when met, automated as
`pnpm --filter @leapsake/web-spike share` (13/13), and still zero files changed under
`packages/`.** The optional quarter-hour was taken. Full findings in
[`apps/web-spike/README.md`](../apps/web-spike/README.md); four results change what
Increment 5 should expect, so they are repeated here.

- **The capability link's key is observed never to reach the server**, and the demonstration
  is the request line the host printed for a request made with the whole link:
  `sent /share/43282163…#vJjX-SJG…` → `received /share/43282163…`, serving 840 B of
  ciphertext and 0 B of plaintext. Confirmed flatly, as predicted: **capability links are
  structurally incompatible with the no-JS floor** — no server can render what no server
  receives — and the hosted fallback really is a ten-line route whose only load-bearing line
  is `openHostedShare`.
- **The shared crypto compiles to a browser target, and so does the shared UI** — the early
  warning this increment was asked to buy, both green. `@leapsake/crypto` + `@leapsake/bytes`
  bundle to **5.9 KiB gzip with no shim, no polyfill and no config**. Adding React and
  `RelationshipScreen` takes it to **111.9 KiB gzip**, of which the shared UI is 16 KiB and
  **zod — pulled in unavoidably by `@leapsake/schema` — is 160 KiB pre-minify**. The framework
  and the validator are the weight; the code Increment 5 wants to reuse is nearly free.
- **A shared screen is reusable unauthenticated, and it renders too much.** The payload needed
  no share format at all (`views.relationship()` returns exactly the screen's props, sealed
  verbatim), but the screen still emits "Edit roles", "Delete" and "Add milestone" to a
  stranger, plus the relationship's internal id. Same verdict as the two `packages/` entries
  before it: small mechanism, product decision — §11's other three modes will all need it.
- **A capability link cannot be re-shown**, and that is a product rule rather than a bug. The
  key exists in the host for the duration of the create request and a redirect could only
  carry it in a fragment the next server never sees, so the create *response* is its only
  appearance. That is what "the server cannot read it" means from the sharer's side, and
  whatever UI offers the choice has to say so.

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
relay and shared-package changes; the no-JS section inventory below (now five entries, with
Increment 3's form-level rows folded in); the two sharing flavors; and the open questions that
survived. Then delete `apps/web-spike` and revert the `.oxlintrc.json` line.

**Three** manual checks are owed before the teardown, all cheap and all the same shape —
things verified by construction or by a stand-in rather than by driving the real thing.

1. Load `http://localhost:5180` in Firefox with `javascript.enabled=false` and walk
   create/edit/delete by hand — and while there, open a **hosted** share link, which is the
   same check for Increment 4's no-JS half.
2. Open a **capability** link in a real browser. Increment 4 built the client for a browser
   target and then executed it against a DOM stub with the fragment supplied by hand, so what
   is unexercised is the browser's own URL handling — precisely the half the zero-knowledge
   claim rests on. Watch the network panel: the request must show the path without the `#`.
3. Converge one real desktop build against the spike's relay account, since Increment 3's peer
   is the desktop *data path* (`joinAccount` + `runAccountSync`) rather than Electron.

## Two design points — both settled by Increment 2

Kept because they are what the later increments and §9.2 inherit, not because they are still
open. The real split session key was built (`apps/web-spike/src/session.ts`) rather than
faked with a plaintext master-key map, and both things a map would have hidden showed up:

1. **The session store also needs the `authVerifier`**, to re-login after a relay restart —
   which makes it a standing relay credential. So it is **wrapped under the same session
   key**, one more line. **Confirmed, and a genuine refinement §9.2 does not currently spell
   out: it should.**
2. **A warm decrypted store would defeat the split entirely** — a fully decrypted database
   in server memory that needs no cookie to read, violating the request-scoped half of
   §9.2's "memory-only, request-scoped, zeroized". **Moot, because the measurement chose
   cold.**

**The decision rule was: cold's p50 under ~150 ms at realistic store size ⇒ take cold.**
Measured at 6.6 ms (100 people) and 36.8 ms (1 000), against 3.7 / 8.2 ms for the warm arm.
**Cold wins**, the §9.2 conflict evaporates, and the product-visible trust claim never has to
be made. What cold pays is a re-pull per request, decrypt-bound rather than network-bound; if
a 10 000-row store ever becomes real the answer is an incremental cursor, not a warm store.

Two mechanisms from this section survive into any real client: the boot-time schema template
(`node:sqlite`'s `serialize()`/`deserialize()` cut per-request setup from 7.9 ms to 0.1 ms),
and `WEB_SPIKE_STORE=warm`, which still builds the other arm should the owner want it.

## What to measure

Keep it all in one `src/measure.ts` so it is one file to read and one to delete. The
server-side half is **done**; the browser half is what Increment 5 still owes.

- ~~**Argon2id server-side**, and the blocking~~ — done: ~355 ms, stalling the whole event
  loop for essentially its full duration. A real SSR host needs a worker pool or a native
  binding, and neither exists in the repo.
- ~~**Pull + decrypt + apply** in Node~~ — done at 100/1k/10k, transport wrapped so
  decrypt+apply = total − transport. `/sync/pull` still has no LIMIT and no pagination, and
  `readBody` still accumulates the whole body into a string.
- **Argon2id in-browser**, main thread (5b) and worker (5c), with the device recorded — a phone
  is the case that matters.
- **Pull + decrypt + apply in the browser**, the same table, so the two sit side by side —
  that comparison is what says whether the client-side zero-knowledge path is viable.
- ~~**Peak RSS per warm session**~~ — **deliberately not measured.** It only decides
  something if warm is forced, and cold won. Still missing if the owner wants warm anyway;
  the trap when taking it is that a `:memory:` database's pages live in native memory, so
  `heapUsed` looks flat and lies — `rss` is the only faithful number.

## Known before starting

Things the spike should confirm and cost, not discover:

- **The relay needs CORS + `OPTIONS`** before any browser client exists.
- ~~**Per-IP rate limits are wrong for an SSR host**~~ — **confirmed, Increment 1.**
- **`/sync/pull` has no pagination**, and the whole body is buffered as a string — and
  Increment 3 adds the sharper half: **the relay never compacts.** `append` is a plain
  `INSERT` and `pull` is `WHERE seq > ?`, so `pull(0)` returns every version ever pushed,
  not the latest per row. Invisible to desktop and mobile, which pull incrementally from a
  durable cursor; unavoidable for a cold-per-request host, because a delta pull into an
  empty database yields an empty database. **Cold store and incremental pull are mutually
  exclusive**, which makes the SSR host the one client whose per-request cost grows with the
  account's write history rather than its row count. Increment 3's push-mark fix keeps that
  growth to one record per write instead of one store per login, but it does not remove it —
  latest-per-row compaction (or a `pull` that collapses by row id) is the real answer, and
  it is a **relay** change.
- **`packages/data` ships no browser driver** — and by policy ships none, so the web client owns
  one, like every other app.
- ~~**The no-JS section inventory for `PersonScreen`**~~ — **done, and it came out sharper
  than predicted.** Working: `ContactMethodsSection`, `RelationshipsSection`,
  `MilestonesSection`, `TagsSection`, `MentionedInSection` — 23 real `<a href>`s, because
  every mutation is navigation to a `/new`, `/edit`, or `/delete` route. `HolidaysSection`
  renders but is inert (the add-field is a Combobox); a `<form>` + `<select>` is a direct
  swap, since the addable list is already loaded. `GiftsSection` is the only genuinely inert
  one: `GiftCaptureForm` emits a bare `<form>` with **no `method`, no `action`, and no `name`
  on any field**, so a no-JS submit posts nothing, nowhere. The whole page carries exactly two
  `<button>`s, both inside it. That is the backlog a real web client works from.

## Stopping points

- ~~**After Increment 2**~~ — **reached, and not taken** *(owner, 2026-08-12)*. It was a clean
  yes with zero package edits; the call was to keep going through 3-5 anyway, because "a person's
  page renders" is not "a web client is possible" until the writes are proved too. Hence
  Increment 3's CRUD framing — which is now also done, and answered yes.
- **After Increment 5a** — the next real one: you know whether the browser data layer is
  possible, for a couple of hours, before committing to the rest of Increment 5.
- Increments 5b-e are each droppable without invalidating what came before — and 5a is now
  cheaper to reach than it was, because Increment 4 already proved the browser *build* works
  (`@leapsake/crypto` and `@leapsake/ui` both bundle), leaving 5a to answer only the
  sqlite-wasm half.

## Open questions

- **Framework.** Deliberately still open, and Increment 2 did not settle it by accident — bare
  `node:http` + `renderToString` throughout. What that cost is now visible and small: path
  parameters are a regex and the loader/action pairing is hand-written. Pick one afterward.
- ~~**Whether the warm-store trust claim is acceptable**~~ — **moot.** Cold won the
  measurement, so the claim never has to be made.
- **Whether server-side Argon2id needs a native binding or a worker pool** — the measurement
  says one of them is needed; *which* is still open, and neither exists in the repo.
- **The browser's `KeyStore`** — §13 lists PWA custody as "weak — IndexedDB, no enclave →
  passkey PRF is the right custody answer." Increment 5e probes the cheaper non-extractable
  `CryptoKey` option; passkey PRF remains the designed answer and is untested.
- **Media and the no-JS floor** — [`v0-2.md`](./v0-2.md) already raises it: serving decrypted
  media to a no-JS browser means the render server transiently holds *file* keys, and whether
  media is exempt from the floor is undecided. Out of scope for this spike (no blobs exist yet),
  but the SSR measurements here are the input to that decision.
