# Leapsake — Web client (`apps/web`)

> **Unbuilt work only.** The *design* for how a web client decrypts, renders, and shares
> is [`encryption/model.md`](./encryption/model.md) §9.2 (server-side decryption), §10 (the
> progressive-enhancement table), §11 (sharing), and §13 (the `KeyStore` port per client).
> The *findings* are in [`apps/web-spike/README.md`](../apps/web-spike/README.md), beside
> the code that produced them. Nothing here restates either. This doc holds what is **left
> to do**, and is deleted when the list empties.

**Done: Increments 1-5, all of them** *(→ 2026-08-14)* — read, write, both sharing flavors, the
browser data layer, the whole client-side login path, that path in a Worker over a persistent
store, a reload that needs neither the password nor the relay, and finally one that needs no
server either. Every question answered yes, every one with **zero files changed under
`packages/`**.
**Left: Increment 6 alone — write up, tear down.**

## What 1-5d settled, so the rest does not re-derive it

Twenty results in one line each; the evidence for every one is in the README.

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
- **OPFS SAHPool is one tab at a time, and a `Web Locks` election is the cheap answer.**
  Access handles are exclusive, so 5c's and 5e's second tab failed at install with
  `NoModificationAllowedError`. 5d turns that into a queue in ~40 lines: the second tab waits,
  and when the first closes it takes the store over by itself in **21.5 ms**, no reload. Two
  limits — it only binds *participating* clients (an older tab still holds the handles and the
  queue is blind to it, observed), and a queued tab does nothing, so a `SharedWorker` owning
  the store is still what would make two tabs live.
- **The shared layer ports with no shim** — six-line adapter, loader/actions call-for-call,
  field readers verbatim, view models usable as a share payload; `@leapsake/crypto` (5.9 KiB
  gzip) and `@leapsake/ui` + React (112 KiB gzip) both compile to a browser target; contract
  and migrations run in a browser unmodified.
- **The no-JS floor has a three-item `packages/ui` backlog**, all product work:
  `GiftCaptureForm`, the `HolidaysSection` add-field, `RelationshipFields` on create — and
  5b showed all three are **live in a JS client from the same components**, so they are gaps
  in the floor rather than in the package.
- **The browser's `KeyStore` is `@leapsake/crypto`'s `KeyStore`** — a non-extractable
  `AES-GCM` `CryptoKey` per secret in IndexedDB, implementing the port as written, ~60 lines,
  no widening. §13's PWA row can be answered rather than deferred: this is what custody *is*.
  What it is *worth* is narrower — it stops exfiltration, not same-origin use, so **passkey PRF
  stays the designed answer** and this is the floor rather than the ceiling.
- **A warm start costs 91 ms against a cold one's 5-6 s**, and the difference is entirely the
  KDF plus the pull. Custody was the last thing a reload had to redo; `resume` runs with `fetch`
  removed from the worker and opens a relay-produced record to prove the key is the account's.
- **The thread that owns the data cannot protect it**: `storage.persist()` is `[Exposed=Window]`,
  so the *page* must ask — and on `localhost` it is **refused**, leaving the OPFS store and the
  wrap both evictable. Still refused in 5d from a browser tab; what 5d settled is that the
  origin *qualifies* as an app (Chrome fired `beforeinstallprompt`, so manifest, icons and
  worker all pass), leaving one human click between here and the answer. The failure mode is
  mild either way: eviction costs one Argon2id and a re-pull, not an account.
- **The whole client runs with no server, and the last thing it needed was the page.** A
  manifest plus a service worker caching the shell, the modules and the `.wasm`: with the dev
  server **killed** (not DevTools-pretending — `navigator.onLine` stayed `true`), a reload
  resumes and renders the person in **69.3 ms** and **0 bytes cross the wire**, the browser
  itself labelling the navigation `deliveryType: "cache-storage"`. 5c and 5e had already made
  the data and the key survive; nothing in `packages/` had to learn that a network might be
  missing, because a resume never builds a transport.
- **A caching service worker and a `no-store` SSR host share an origin, and Cache Storage
  ignores the header.** `cache.put` stores a `private, no-store` response as happily as any
  other, so a "cache everything same-origin" worker would write rendered person pages to disk.
  The allowlist naming which URLs are *shell* is five lines and is the whole difference.
- **A service worker cannot live in the bundler's module graph.** It controls only URLs at or
  below the path it is served from, so it is served from the root and is the one untransformed
  file in the spike — the first deliberate exception to Increment 1's one-graph rule, and the
  reason every production bundler ships a service-worker special case.
- **Argon2id costs the same on a worker as on the main thread: ~435 ms.** Three visible-tab
  runs, 433.3 / 440.6 / 441.1 ms, against 5b's one visible main-thread reading of 449.4 ms —
  so 5c's alarming 1 083–3 417 ms was the *hidden tab*, not the thread, and the worker buys
  interactivity at no cost to the KDF. A visible-tab cold login is **859 ms** end to end
  (51% KDF) where the hidden-tab reading was 4 884–6 277 ms.
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
  `SharedArrayBuffer` and therefore COOP/COEP, which would poison the whole origin). The
  constraint that came with it — the pool is **worker-only and single-tab** — is answered
  rather than open: 5d queues the second tab on a `Web Lock` and hands the store over when the
  first closes. (`wa-sqlite`'s async-VFS pitch bought nothing because our port is already
  async; `sql.js` has no persistence story. Migration portability is no longer a prediction —
  `runMigrations` ran unmodified in 5a, and in 5c ran *once ever*.)
- **One origin, one module graph — with exactly one deliberate exception.** Vite in middleware
  mode covers SSR pages, the client bundle and the `.wasm` from a single origin, and
  `server.ts` reaches the app only through `ssrLoadModule` — load a module twice and the
  session store splits in half. The **service worker** cannot obey it: it controls only URLs at
  or below the path it is served from, so it is served from the root off disk and is the one
  file here that no bundler touches.

Governance for anything new: `"version": "0.0.0"`, no `typecheck` script, excluded from
`oxlint` via `.oxlintrc.json` → `ignorePatterns`, and out of `vitest.config.ts` — verification
here is manual and in-browser.

## Increment 5 — done, and where each half of it lives

The driver is `apps/web-spike/src/wasm-sqlite-driver.ts` and the page is `/driver-contract`;
the main-thread client is `src/client/client-app.tsx` behind `/client`; the Worker client is
`src/client/core-worker.ts` + `core-proxy.ts` behind `/client-worker`; custody is
`src/client/key-custody.ts` behind `/client-key`; the installed app is
`src/client/service-worker.js` + `src/routes/pwa.ts` behind `/client-pwa`, with the relay
forwarder they all need in `src/relay-proxy.ts`. Every page prints its own numbers.

**5e was moved ahead of 5d and that was right.** 5d's done-when was unreachable without it:
`bootstrap.ts` makes **two network calls before it has a key** — `lookup(username)` for the
account id and salt, then `fetchBootstrap` for `wrap(MK, kek)` — so an offline reload held a
perfectly good OPFS store and nothing that opened it. Because 5e went first, the service-worker
fallback its failure would have forced (caching the two login responses, putting
`wrap(MK, kek)` in Cache Storage) was never needed and was never built.

**The measurement table is complete but for one row: a phone.** Every number in this spike
is one laptop — MacBook Pro (Mac14,6), M2 Max, 32 GiB, macOS 26.5.1, Chrome 151 — and the
device that decides whether a browser client is usable is the one nobody has measured. 5d
collected the other two: Argon2id on a worker in a *visible* tab (~435 ms, three runs), and
the machine itself. The server-side half is all in `src/measure.ts`, one file to delete; the
browser numbers are printed by the pages that produced them.

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
- **§13's PWA row should be rewritten** from "weak — IndexedDB, no enclave → passkey PRF is the
  right answer" to the two-part answer 5e produced: the *port* is satisfied today by a
  non-extractable `CryptoKey` in IndexedDB, and passkey PRF is what adds user presence on top.
  The row currently reads as though nothing works until PRF does, and something does. 5d adds
  the durability half of the same row: both the key and the store sit on **evictable** storage
  until an origin Chrome considers installed asks for `persist()`, and eviction is a re-login
  rather than a data loss.
- **The relay's compaction gap** (below) is the one change that is neither optional nor
  cosmetic for an SSR host.

**Four checks are owed before the teardown**, the first three the same shape — things verified
by construction or by a stand-in rather than by driving the real thing. 5a found they need not
be manual: the Claude-in-Chrome extension drives the browser the user already has open, which
is how `/driver-contract` was read. Only the Firefox one plainly needs a human, because
`javascript.enabled=false` is a Firefox preference; the fourth needs one because clicking
through Chrome's install dialog is a native window the extension cannot reach.

*(The old fourth check — the visible-tab KDF — is **collected**: 5d's tab reported `visible`
throughout and read 433.3 / 440.6 / 441.1 ms. So "an agent-driven tab is always hidden" was
true of 5c's and 5e's sessions rather than of the route.)*

1. Load `http://localhost:5180` in Firefox with `javascript.enabled=false` and walk
   create/edit/delete by hand — and while there, open a **hosted** share link, which is the
   same check for Increment 4's no-JS half.
2. Open a **capability** link in a real browser. Increment 4 built the client for a browser
   target and then executed it against a DOM stub with the fragment supplied by hand, so what
   is unexercised is the browser's own URL handling — precisely the half the zero-knowledge
   claim rests on. Watch the network panel: the request must show the path without the `#`.
3. Converge one real desktop build against the spike's relay account, since Increment 3's peer
   is the desktop *data path* (`joinAccount` + `runAccountSync`) rather than Electron.
4. **Install `/client-pwa` and read one line.** The page's "Install this app" button is live —
   Chrome offered the prompt, so the manifest, the icons and the worker all qualify — and the
   `storage` line reports `persist()` and `display-mode` on every load. The question is whether
   an *installed* origin is granted durable storage where a `localhost` tab is refused; today
   both the OPFS database and the wrapped master key are evictable. One click, one reload, one
   line to copy into the findings — and if the answer is still "refused", that is the answer.

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
  one like every other app. **`packages/crypto` is the same story for `KeyStore`** — it ships
  the port and an in-memory adapter, and 5e's browser adapter (IndexedDB + a non-extractable
  `CryptoKey`) belongs to the web client for the same reason. Neither is a wanted change; both
  are noted so Increment 6 does not read "no package change" as "nothing to build".

## Open questions

- **Framework.** Deliberately open. Five increments of bare `node:http` + `renderToString`
  cost one regex and a hand-written loader/action pairing, and argue for nothing in
  particular. Pick one afterward.
- **Whether server-side Argon2id needs a native binding or a worker pool** — one of them is
  needed; *which* is open, and neither exists in the repo.
- **The browser's `KeyStore`** — *answered in part by 5e.* The port needs no change: a
  non-extractable `AES-GCM` `CryptoKey` per secret in IndexedDB implements `getSecret` /
  `setSecret` / `deleteSecret` as written, and a reload unwraps and decrypts with no password
  and no network. What stays open is the *strength*: it stops exfiltration but not same-origin
  use, so §13's **passkey PRF** — which adds a user-presence gesture an XSS cannot supply —
  remains the designed answer and remains untested.
- **What a second tab does** *(5c, half-answered by 5d)*. The **mechanical** half is settled: a
  `Web Locks` election is ~40 lines, the second tab queues instead of throwing, and it takes
  the store over in 21.5 ms when the first closes. Two things stay open. A queued tab **does
  nothing**, and a `SharedWorker` owning the store — which would make both live — is still
  unproven; and the election binds only clients that participate, so it is a convention inside
  one app rather than a guarantee. The product question underneath is unchanged: what *should*
  a second tab of a personal CRM do?
- **Whether the SSR client and the PWA should share an origin** *(Increment 5d)*. They do here,
  and two things fell out of it that a real deployment inherits: the service worker had to be
  told which URLs are *shell* and which are somebody's decrypted data (Cache Storage ignores
  `no-store`, so the allowlist is the only thing standing between the two), and the manifest's
  `start_url` had to name the client rather than `/`. Separate origins would make both
  questions disappear and cost a second deployment plus a cross-origin story for shares.
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
- **Whether the browser bundle's size matters** *(Increment 4, sharpened by 5d)*. 112 KiB gzip
  for a read-only screen, **zod the second-largest piece**, reaching the browser unavoidably
  through `@leapsake/schema`. 5d makes the PWA real, so this is now live — but it also changes
  the shape of the question: an installed app downloads its bundle **once** and then serves it
  from Cache Storage, so the size is a first-launch cost rather than a per-visit one, and the
  864 KiB `.wasm` dwarfs it either way. The fix, if there is one, is still a shared-package
  shape change rather than a web one.
- **Media and the no-JS floor** — [`v0-2.md`](./v0-2.md) raises it: serving decrypted media to a
  no-JS browser means the render server transiently holds *file* keys. Out of scope here (no
  blobs exist yet), but these SSR measurements are the input to that decision.
