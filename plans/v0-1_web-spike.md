# Leapsake — Web client (`apps/web`)

> **Unbuilt work only.** The *design* for how a web client decrypts, renders, and shares
> is [`encryption/model.md`](./encryption/model.md) §9.2 (server-side decryption), §10 (the
> progressive-enhancement table), §11 (sharing), and §13 (the `KeyStore` port per client).
> The *findings* are in [`apps/web-spike/README.md`](../apps/web-spike/README.md), beside
> the code that produced them. Nothing here restates either. This doc holds what is **left
> to do**, and is deleted when the list empties.

**State: Increments 1-4 are done** *(2026-08-12)*, and with them all three owner questions
except the PWA one. A person's page server-renders with JavaScript disabled; create / edit /
delete do too, and land on a second device through a real relay; and a capability link
decrypts in the browser from a key the server is *observed* never to receive, with the
hosted fallback a ten-line SSR route. Every increment held **zero files changed under
`packages/`**; the record of what that cost is
[`WANTED-CHANGES.md`](../apps/web-spike/WANTED-CHANGES.md).

**Left: Increment 5 (the browser JS path), then Increment 6 (write up, tear down).**
**5a is the next stopping point** and the place to start.

**Scheduled pre-v0.1** *(owner, 2026-08-07)*, as a parallel track in [`v0-1.md`](./v0-1.md) —
independent of the launch prerequisite chain, and the natural filler whenever that chain is
waiting. The deciding argument was that two of the changes the spike exists to find are
**relay** changes, and the relay is the component hardening for v0.1. Note that this
schedules the **spike**, not the Stage 4 web app, which stays post-launch
([`encryption/README.md`](./encryption/README.md)).

## What 1-4 settled, so 5 and 6 do not re-derive it

Six results, and only these — everything else is in the README.

- **Take cold-per-request with a warm key.** Measured and decided; §9.2 as written, no warm
  decrypted store, so the trust claim it warned might be forced is not forced.
  `WEB_SPIKE_STORE=warm` still builds the other arm if the owner ever wants it.
- **Argon2id is the whole login cost (~355 ms) and it stalls the entire host.** Whatever
  Increment 5 measures in a browser, this is the number it is being compared against.
- **The relay is an append-only log with no compaction, and a cold host must `pull(0)`** — so
  **cold store and incremental pull are mutually exclusive**. Increment 5's client is *not*
  cold (it has OPFS), which is exactly why 5c's "a reload does not re-pull" is worth proving.
- **`SyncEngine` does not expose its high-water mark**, and the obvious client-side
  substitute (`Date.now()`) silently drops writes. Any client that writes needs the real
  mark; the spike computes it by hand and says why that is not good enough for production.
- **The shared packages port with no shim.** Adapter six lines, loader and actions call-for-
  call, field readers verbatim, view models usable as a share payload unchanged — and
  `@leapsake/crypto` (5.9 KiB gzip) and `@leapsake/ui` + React (112 KiB gzip) both **compile
  to a browser target**. 5a therefore has only the sqlite-wasm half left to answer.
- **The no-JS floor has a three-item backlog**, all in `packages/ui` and all product work:
  `GiftCaptureForm`, the `HolidaysSection` add-field, and `RelationshipFields` on create.
  Out of scope here; the README inventories them for whoever builds the real client.

## Decisions that still bind

The rest were consumed by 1-4 and now live in the code they shaped
(`vite.config.ts`, `bootstrap.ts`, `node-sqlite-driver.ts`). These two still constrain
unbuilt work:

- **`@sqlite.org/sqlite-wasm` for the browser database.** OPFS SAHPool needs no
  cross-origin isolation, where the older OPFS VFS needs `SharedArrayBuffer` and therefore
  COOP/COEP, which would poison the whole origin. `wa-sqlite`'s async-VFS pitch buys nothing
  because our port is already async; `sql.js` has no persistence story and so cannot answer
  the PWA question. Migrations are portable — `packages/data/src/migrations.ts` is plain DDL,
  no extensions or `RETURNING`; the only exotic statement is `PRAGMA user_version`.
- **One origin, one module graph.** Vite in middleware mode already covers SSR pages, the
  client bundle, the `.wasm` and the service worker from a single origin, and `server.ts`
  reaches the app only through `ssrLoadModule` — load a module twice and the session store
  splits in half. New files in Increment 5 stay inside that graph.

Governance for anything new: `"version": "0.0.0"`, no `typecheck` script, excluded from
`oxlint` via `.oxlintrc.json` → `ignorePatterns`, and out of `vitest.config.ts` — verification
here is manual and in-browser.

## Increment 5 — the browser JS path

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
  prove the capability first. Same four calls as the server (`src/bootstrap.ts`), then
  `runMigrations` → `createSyncEngine(...).pull(0)` → `createCore` → render `PersonScreen`
  with the *same* `ui-adapter.tsx`.
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

**What 5 still owes the measurement table** (all of it in `src/measure.ts`, one file to
delete): **Argon2id in-browser**, main thread (5b) and worker (5c), with the device
recorded — a phone is the case that matters; and **pull + decrypt + apply in the browser**,
the same shape as the Node table already in the README, so the two sit side by side. That
comparison is what says whether the client-side zero-knowledge path is viable.

### The CORS gap — proxy for the spike, but name the real change

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

**Three manual checks are owed before the teardown**, all the same shape — things verified by
construction or by a stand-in rather than by driving the real thing:

1. Load `http://localhost:5180` in Firefox with `javascript.enabled=false` and walk
   create/edit/delete by hand — and while there, open a **hosted** share link, which is the
   same check for Increment 4's no-JS half.
2. Open a **capability** link in a real browser. Increment 4 built the client for a browser
   target and then executed it against a DOM stub with the fragment supplied by hand, so what
   is unexercised is the browser's own URL handling — precisely the half the zero-knowledge
   claim rests on. Watch the network panel: the request must show the path without the `#`.
3. Converge one real desktop build against the spike's relay account, since Increment 3's peer
   is the desktop *data path* (`joinAccount` + `runAccountSync`) rather than Electron.

## Changes this spike has already justified

Not spike work — **product work it has found and priced**, listed so Increment 6 does not have
to rediscover it. Each is confirmed, none is built.

- **The relay needs CORS + `OPTIONS`** before any browser client can exist (~6 lines behind a
  `RELAY_CORS_ORIGINS` env var).
- **The relay never compacts**, and `/sync/pull` has no pagination — `append` is a plain
  `INSERT`, `pull` is `WHERE seq > ?`, so `pull(0)` returns every version ever pushed rather
  than the latest per row. Invisible to desktop and mobile, which pull incrementally from a
  durable cursor; **unavoidable for a cold-per-request host**, which makes the SSR host the one
  client whose per-request cost grows with the account's write *history* rather than its row
  count. Latest-per-row compaction (or a `pull` that collapses by row id) is the real answer.
- **The relay's per-IP failed-login budget is wrong for an SSR host** — one IP for every user,
  so ten users mistyping a password lock out the eleventh. Lifted with env vars for the spike,
  not patched.
- **A real SSR host needs a worker pool or a native Argon2 binding**; neither exists in the
  repo.
- **`SyncEngine` should expose its high-water mark** (or offer a `pushChanged` that needs no
  mark) — see `WANTED-CHANGES.md` for why the spike's workaround is not production-grade.
- **`packages/data` ships no browser driver**, and by policy ships none, so the web client owns
  one like every other app.

## Stopping points

**After 5a** — the only one left, and a real one: a couple of hours tells you whether the
browser data layer is possible before committing to 5b-e, each of which is independently
droppable.

## Open questions

- **Framework.** Deliberately still open; four increments of bare `node:http` +
  `renderToString` cost one regex for path parameters and a hand-written loader/action
  pairing. Nothing so far argues for a particular framework. Pick one afterward.
- **Whether server-side Argon2id needs a native binding or a worker pool** — the measurement
  says one of them is needed; *which* is still open, and neither exists in the repo.
- **The browser's `KeyStore`** — §13 lists PWA custody as "weak — IndexedDB, no enclave →
  passkey PRF is the right custody answer." Increment 5e probes the cheaper non-extractable
  `CryptoKey` option; passkey PRF remains the designed answer and is untested.
- **Where a share lives** *(raised by Increment 4)*. The spike keeps shares in a process
  `Map`, which decides nothing. A real share is a row — in the owner's encrypted store (so it
  syncs to their other devices, but the link dies when they are offline) or in a **new relay
  table** (so the link always resolves, and the relay grows a schema). §11 does not say, and
  the answer decides whether this is another relay change.
- **Revocation and expiry are unexercised** *(raised by Increment 4)*. §11 lists four sharing
  modes; the spike built the two public-link flavors and neither the revocable nor the
  time/visit-limited one. Both are server-side gatekeeping of *delivery* and look cheap — but
  revocation is more load-bearing than it looks, because a capability link **cannot be
  re-shown**, so revoke-and-re-share is the only way to correct a mis-sent link.
- **What a viewer of a shared screen sees** *(raised by Increment 4)*. Rendered
  unauthenticated, `RelationshipScreen` still offers Edit / Delete / Add-milestone and leaks
  the item's internal id. The mechanism is small (a `readOnly` prop, or a viewer capability the
  sections read); the product question — does a viewer see the timeline? the other partner's
  page? — is not, and every mode in §11's table needs the answer.
- **Whether the browser bundle's size matters** *(raised by Increment 4)*. 112 KiB gzip to
  render a read-only screen, of which **zod is the second-largest piece**, reaching the browser
  unavoidably through `@leapsake/schema`. Only worth acting on if 5d makes the PWA real; the
  fix would be a shared-package shape change, not a web one.
- **Media and the no-JS floor** — [`v0-2.md`](./v0-2.md) already raises it: serving decrypted
  media to a no-JS browser means the render server transiently holds *file* keys, and whether
  media is exempt from the floor is undecided. Out of scope for this spike (no blobs exist yet),
  but the SSR measurements here are the input to that decision.
