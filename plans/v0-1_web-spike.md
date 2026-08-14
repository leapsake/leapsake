# Leapsake — Web client (`apps/web`)

> **Unbuilt work only.** The *design* for how a web client decrypts, renders, and shares
> is [`encryption/model.md`](./encryption/model.md) §9.2 (server-side decryption), §10 (the
> progressive-enhancement table), §11 (sharing), and §13 (the `KeyStore` port per client).
> The *findings* are in [`apps/web-spike/README.md`](../apps/web-spike/README.md), beside
> the code that produced them. Nothing here restates either. This doc holds what is **left
> to do**, and is deleted when the list empties.

**Done: Increments 1-4, 5a, 5b and 5c** *(→ 2026-08-13)* — read, write, both sharing flavors,
the browser data layer, the whole client-side login path, and that path in a Worker over a
persistent store, all answered yes, every one with **zero files changed under `packages/`**.
**Left: 5e then 5d, then Increment 6 (write up, tear down). Start at 5e** — 5c inverted that
order, and the section below says why. No stopping points remain; each of the two is droppable
on its own merits rather than collectively at risk.

## What 1-5c settled, so the rest does not re-derive it

Thirteen results in one line each; the evidence for every one is in the README.

- **A real browser is drivable** — the Claude-in-Chrome extension reads the browser the user
  already has open (headless still will not launch here). So the three checks owed before
  teardown, and 5d's offline reload, are not human-only work.
- **The browser data layer works and the port did not widen for it** — 12/12 on
  `runDriverContract`, `runMigrations` complete, from a 40-line driver. Engine ~55 ms, schema
  40-140 ms: as on the server, the KDF is the cold-start cost, not the database.
- **Cold store, warm key** — §9.2 as written, so the warm-decrypted-store trust claim it
  warned might be forced is not forced. `WEB_SPIKE_STORE=warm` still builds the other arm.
- **Argon2id is the whole login cost and it stalls whatever runs it** — ~386 ms on Node,
  **~450 ms in a visible browser tab and ~850 ms in a hidden one**, freezing the tab for
  essentially the whole duration. It is 85% of a browser cold start.
- **The client-side path works end to end and is not the expensive part.** A tab logs in,
  pulls 446 records, decrypts and applies them (~90 ms), and renders `PersonScreen` through
  the *same* adapter the SSR host uses, in ~1 s cold. Everything but the KDF is ~135 ms.
- **Cold store and incremental pull are mutually exclusive** — the relay is an append-only log
  with no compaction and a cold host must `pull(0)`. 5c's persistent client is the other arm,
  measured: a reload pulls **0 records** where the cold host re-pulls the whole history.
- **`SyncEngine` does not expose its high-water mark**, and the obvious substitute
  (`Date.now()`) silently drops writes. That is a **cold-store** want: a client with a durable
  store gets `sync()` and both marks from a `syncState` repo, as 5c does.
- **A Worker moves the whole stall off the page, and the split needs no package change** —
  `CoreApi` crossed the thread boundary behind a 40-line `Proxy`, the *same* screen file
  rendering against a real `core` on one page and a proxied one on the other. Argon2id still
  costs what it costs; the page's own worst unavailability went from ~800 ms to **8.4 ms**.
- **OPFS makes the schema a once-ever cost and the reload free** — `runMigrations` drops from
  20-43 ms per tab to "nothing to do", and `pull(cursor)` applies nothing. What it costs is the
  *cold* apply, 4-7× slower into OPFS than into `:memory:`.
- **OPFS SAHPool is one tab at a time.** Access handles are exclusive, so a second tab fails
  at install with `NoModificationAllowedError`. Opening a second tab is something users do, so
  a real client owes an answer (shared worker, leader election, or read-only fallback) — and
  5d is a PWA, which is precisely the thing someone opens twice.
- **The shared layer ports with no shim** — six-line adapter, loader/actions call-for-call,
  field readers verbatim, view models usable as a share payload; `@leapsake/crypto` (5.9 KiB
  gzip) and `@leapsake/ui` + React (112 KiB gzip) both compile to a browser target; contract
  and migrations run in a browser unmodified.
- **The no-JS floor has a three-item `packages/ui` backlog**, all product work:
  `GiftCaptureForm`, the `HolidaysSection` add-field, `RelationshipFields` on create — and
  5b showed all three are **live in a JS client from the same components**, so they are gaps
  in the floor rather than in the package.
- **The SSR host and the JS client want different adapters over the same screens.** The
  degenerate `href`-passthrough adapter is right for no-JS and wrong for a client-side app,
  where every link is a document navigation that discards the tab's key and store. Desktop's
  adapter (`href` → react-router `to`) is the shape a real web client needs.

## Decisions that still bind

The rest were consumed by 1-5a and now live in the code they shaped (`vite.config.ts`,
`bootstrap.ts`, the two drivers). These two still constrain unbuilt work:

- **`@sqlite.org/sqlite-wasm` for the browser database** — chosen, working since 5a, and as of
  5c **persistent**: `installOpfsSAHPoolVfs()` + `new poolUtil.OpfsSAHPoolDb(...)` needed no
  cross-origin isolation, exactly as the choice predicted (the older OPFS VFS needs
  `SharedArrayBuffer` and therefore COOP/COEP, which would poison the whole origin). What now
  binds 5d is the constraint that came with it: the pool is **worker-only and single-tab**.
  (`wa-sqlite`'s async-VFS pitch bought nothing because our port is already async; `sql.js` has
  no persistence story. Migration portability is no longer a prediction — `runMigrations` ran
  unmodified in 5a, and in 5c ran *once ever*.)
- **One origin, one module graph.** Vite in middleware mode already covers SSR pages, the
  client bundle, the `.wasm` and the service worker from a single origin, and `server.ts`
  reaches the app only through `ssrLoadModule` — load a module twice and the session store
  splits in half. New files in Increment 5 stay inside that graph.

Governance for anything new: `"version": "0.0.0"`, no `typecheck` script, excluded from
`oxlint` via `.oxlintrc.json` → `ignorePatterns`, and out of `vitest.config.ts` — verification
here is manual and in-browser.

## Increments 5e and 5d — the rest of the browser JS path, in that order

Spike-sized only if "can it work" is split from "is it usable." The lever the plan predicted
for 5c held exactly and is now a result rather than a bet: **the desktop main/renderer split is
isomorphic to the browser main-thread/Worker split**, and a path-addressed `postMessage` proxy
over `CoreApi` came to 40 lines that re-implement nothing.

5a, 5b and 5c are done. The driver is `apps/web-spike/src/wasm-sqlite-driver.ts` and the page
is `/driver-contract`; the main-thread client is `src/client/client-app.tsx` behind `/client`;
the Worker client is `src/client/core-worker.ts` + `core-proxy.ts` behind `/client-worker`,
with the relay forwarder they need in `src/relay-proxy.ts`. Every page prints its own numbers.

**The order is 5e then 5d, and 5c is what settled it.** The two were listed the other way
round on the assumption that a PWA is the bigger piece and custody a garnish. It is the
reverse: 5d's done-when is unreachable without 5e, because `bootstrap.ts` makes **two network
calls before it has a key** — `lookup(username)` for the account id and salt, then
`fetchBootstrap` for `wrap(MK, kek)`. Offline, both fail, so an offline reload holds a perfectly
good OPFS store and nothing that opens it. 5c is what made that concrete by making everything
*except* the key survive.

- **5e — browser key custody.** Half an hour, and after 5c the most valuable half-hour here.
  Offline access needs something persisted that unwraps the local database; desktop and mobile
  use an OS enclave via the `KeyStore` port and **the browser has no equivalent**. Probe the
  closest analogue: a **non-extractable** `AES-KW`/`AES-GCM` `CryptoKey` in IndexedDB
  (unextractable by JS, origin-bound) wrapping the master key — mint, wrap, reload, unwrap,
  decrypt a row. Success answers "what is the browser's `KeyStore`?", which §13 leaves open,
  and hands 5d a warm start that needs neither the network nor the KDF. Failure means PWA
  offline costs an Argon2id run on every cold start, which is a product decision, not an
  engineering one. 5c sharpened the stakes: the store, the schema and the sync cursor now all
  survive a reload, so **the key is the only thing that does not**, and the entire cost of a
  warm start is a KDF run whose result is deliberately thrown away.
- **5d — PWA.** Manifest plus a service worker caching shell, JS, and `.wasm`.
  `http://localhost` is a secure context, so no TLS. **Done when** DevTools-offline reload
  renders the person from the OPFS database. 5c did the data half already — the store, the
  schema and the cursor all survive — so what 5d adds is the *asset* half, plus one question it
  inherits: **the OPFS pool is single-tab**, and an installed PWA is exactly what gets opened
  twice. If 5e fails, 5d can still reach its done-when by caching the two login responses in
  the service worker — offline login then costs a full Argon2id every time, and it means
  `wrap(MK, kek)` sits in Cache Storage. That leaks nothing the relay does not already hold,
  but it is a decision to take deliberately rather than to back into for a green demo.

**What 5 still owes the measurement table** (the server-side half is all in `src/measure.ts`,
one file to delete; the browser numbers are printed by the pages that produced them):
**Argon2id on a worker in a *visible* tab** — 5c measured it five times in a hidden one and got
1 083-3 417 ms, which is unusable, because a backgrounded renderer de-prioritizes its workers
at least as hard as its main thread. And **the device recorded — a phone is the case that
matters**, since every number so far is one laptop. 5b and 5c delivered the rest: the
main-thread KDF, pull + decrypt + apply in the browser against the same account the Node column
was measured on, and the cold-versus-persistent store comparison.

### The CORS gap — proxied in 5b, but the real change is unchanged

`src/relay-proxy.ts` forwards `/relay/*` → `RELAY_URL/*` from the spike's own origin, and it
needed **zero transport changes**: `http-transport.ts` concatenates URLs rather than calling
`new URL(base)`, so a relative `baseUrl: "/relay"` resolves against the page origin — and
same-origin means no preflight, which matters because the `Authorization` header would
otherwise force an `OPTIONS` the relay 404s. Proxying beat patching `apps/server` because the
relay is the thing hardening, and a reverted CORS patch is exactly the kind of change that
survives revert by accident.

**The caveat belongs in the findings, not buried here:** the proxy sees
`Authorization: Bearer <accountId>.<b64(authVerifier)>`. The verifier is an independent HKDF
branch, so it reveals nothing about the KEK and **confidentiality genuinely survives** — but
the proxy could impersonate the account to read and write ciphertext, an availability and
integrity trust dependency production must not have. So the real conclusion is that
**the relay needs CORS + `OPTIONS` before any browser client can exist** (~6 lines behind a
`RELAY_CORS_ORIGINS` env var). Do not let the proxy launder that into "no relay change needed."

## Increment 6 — write the findings, tear the spike down

This doc is rewritten into **answers rather than narrative**, sourced from
[`apps/web-spike/README.md`](../apps/web-spike/README.md) and
[`WANTED-CHANGES.md`](../apps/web-spike/WANTED-CHANGES.md): the three owner questions of
2026-08-02 (view / share / with-JS-without-JS-as-PWA) resolved in three sentences; the
measurement table; the required **relay** and **shared-package** changes; the no-JS
inventory; the two sharing flavors; and the open questions that survived. Then delete
`apps/web-spike` and revert the `.oxlintrc.json` line.

Three things belong in the write-up that are not in the README, because they are changes to
*designs* rather than findings about code:

- **§9.2 should say the `authVerifier` is wrapped under the session key.** Relay sessions are
  per-process, so a restart forces a re-login and the host must hold a standing relay
  credential; in the clear beside the wrapped master key it partly defeats the split. One
  line, and the model does not currently spell it out.
- **§9.2's cold-vs-warm question is answered** — cold, with the numbers.
- **The relay's compaction gap** (below) is the one change that is neither optional nor
  cosmetic for an SSR host.

**Four checks are owed before the teardown**, the first three the same shape — things verified
by construction or by a stand-in rather than by driving the real thing. 5a found they need not
be manual: the Claude-in-Chrome extension drives the browser the user already has open, which
is how `/driver-contract` was read. Two of them do need a human: the Firefox one, because
`javascript.enabled=false` is a Firefox preference, and the fourth, because an agent-driven tab
is always `hidden` — and 5c found that neither `requestAnimationFrame` nor `setInterval`
survives that, so a visible tab is the one thing the extension route cannot supply.

1. Load `http://localhost:5180` in Firefox with `javascript.enabled=false` and walk
   create/edit/delete by hand — and while there, open a **hosted** share link, which is the
   same check for Increment 4's no-JS half.
2. Open a **capability** link in a real browser. Increment 4 built the client for a browser
   target and then executed it against a DOM stub with the fragment supplied by hand, so what
   is unexercised is the browser's own URL handling — precisely the half the zero-knowledge
   claim rests on. Watch the network panel: the request must show the path without the `#`.
3. Converge one real desktop build against the spike's relay account, since Increment 3's peer
   is the desktop *data path* (`joinAccount` + `runAccountSync`) rather than Electron.
4. **Click `/client-worker` once with the window in front**, and read the two lines the
   measurement table is missing: Argon2id on a worker, and the frame meter. 5c measured the
   KDF five times in a hidden tab and got 1 083-3 417 ms against 5b's one visible reading of
   449 ms, so nothing there is comparable. Cheapest during 5e or 5d, both of which end at a
   human reloading a real browser anyway. The page prints the visible-tab line only when the
   tab stayed visible throughout, so its presence is the evidence rather than the tester's word.

## Changes this spike has already justified

Not spike work — **product work it has found and priced**, listed so Increment 6 does not have
to rediscover it. Each is confirmed, none is built; the reasoning is in
[`WANTED-CHANGES.md`](../apps/web-spike/WANTED-CHANGES.md).

- **The relay needs CORS + `OPTIONS`** before any browser client can exist (~6 lines behind a
  `RELAY_CORS_ORIGINS` env var) — no longer a prediction: in 5b it is the one thing that stops
  a browser reaching the relay at all, and the spike only got past it by proxying.
- **The relay never compacts**, and `/sync/pull` has no pagination, so `pull(0)` returns every
  version ever pushed rather than the latest per row. Invisible to desktop and mobile, which
  pull incrementally from a durable cursor; **unavoidable for a cold-per-request host**, whose
  per-request cost then grows with the account's write *history*. Latest-per-row compaction (or
  a `pull` that collapses by row id) is the real answer.
- **The relay's per-IP failed-login budget is wrong for an SSR host** — one IP for every user,
  so ten users mistyping a password lock out the eleventh. Lifted with env vars, not patched.
- **A real SSR host needs a worker pool or a native Argon2 binding**; neither exists here.
- **`SyncEngine` should expose its high-water mark** (or offer a `pushChanged` needing no mark)
  — **for hosts with no durable store**, which 5c narrowed it to: a browser client with an OPFS
  database keeps `sync_state` like desktop and gets both marks from `sync()`.
- **`createCollectingTestApi` should live in `@leapsake/data/testing`** beside the contract it
  runs — mobile has it, and 5a needed it byte for byte.
- **`packages/data` ships no browser driver**, and by policy ships none, so the web client owns
  one like every other app.

## Open questions

- **Framework.** Deliberately open. Five increments of bare `node:http` + `renderToString`
  cost one regex and a hand-written loader/action pairing, and argue for nothing in
  particular. Pick one afterward.
- **Whether server-side Argon2id needs a native binding or a worker pool** — one of them is
  needed; *which* is open, and neither exists in the repo.
- **The browser's `KeyStore`** — §13 calls PWA custody "weak — IndexedDB, no enclave → passkey
  PRF is the right answer." 5e probes the cheaper non-extractable `CryptoKey`; passkey PRF
  stays the designed answer and is untested.
- **What a second tab does** *(Increment 5c)*. OPFS access handles are exclusive, so exactly one
  tab can hold the database; the second one fails at VFS install. The mechanisms are known
  (a `SharedWorker` owning the store, a `Web Locks` leader election, or a read-only fallback)
  and none is free — a `SharedWorker` is the natural fit and is one more thing to prove. The
  product question underneath it is what a *second* tab should even do, and it arrives with 5d.
- **Where a share lives** *(Increment 4)*. The spike's process `Map` decides nothing. A real
  share is a row — in the owner's encrypted store (syncs to their devices; the link dies when
  they are offline) or in a **new relay table** (always resolves; the relay grows a schema).
  §11 does not say, and the answer decides whether this is another relay change.
- **Revocation and expiry are unexercised** *(Increment 4)*. Two of §11's four modes are built.
  Both remaining ones are server-side gatekeeping of *delivery* and look cheap — but revocation
  is load-bearing, because a capability link **cannot be re-shown**, so revoke-and-re-share is
  the only way to correct a mis-sent one.
- **What a viewer of a shared screen sees** *(Increment 4)*. Unauthenticated,
  `RelationshipScreen` still offers Edit / Delete / Add-milestone and leaks the internal id.
  The mechanism is small (a `readOnly` prop, or a viewer capability); the product question —
  does a viewer see the timeline? the other partner's page? — is not, and every §11 mode needs
  the answer.
- **Whether the browser bundle's size matters** *(Increment 4)*. 112 KiB gzip for a read-only
  screen, **zod the second-largest piece**, reaching the browser unavoidably through
  `@leapsake/schema`. Only worth acting on if 5d makes the PWA real, and the fix is a
  shared-package shape change rather than a web one.
- **Media and the no-JS floor** — [`v0-2.md`](./v0-2.md) raises it: serving decrypted media to a
  no-JS browser means the render server transiently holds *file* keys. Out of scope here (no
  blobs exist yet), but these SSR measurements are the input to that decision.
