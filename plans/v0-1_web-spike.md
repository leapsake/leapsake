# Leapsake — Web client (`apps/web`)

> **Unbuilt work only.** The *design* for how a web client decrypts, renders, and shares
> is [`encryption/model.md`](./encryption/model.md) §9.2 (server-side decryption), §10 (the
> progressive-enhancement table), §11 (sharing), and §13 (the `KeyStore` port per client).
> The *findings* are in [`apps/web-spike/README.md`](../apps/web-spike/README.md), beside
> the code that produced them. Nothing here restates either. This doc holds what is **left
> to do**, and is deleted when the list empties.

**Done: Increments 1-4 and 5a** *(→ 2026-08-13)* — read, write, both sharing flavors, and the
browser data layer, all answered yes, every one with **zero files changed under `packages/`**.
**Left: 5b-e, then Increment 6 (write up, tear down). Start at 5b.** No stopping points
remain; 5a's green means 5b-e are each droppable on their own merits rather than collectively
at risk.

## What 1-5a settled, so the rest does not re-derive it

Eight results in one line each; the evidence for every one is in the README.

- **A real browser is drivable** — the Claude-in-Chrome extension reads the browser the user
  already has open (headless still will not launch here). So the three checks owed before
  teardown, and 5d's offline reload, are not human-only work.
- **The browser data layer works and the port did not widen for it** — 12/12 on
  `runDriverContract`, `runMigrations` complete, from a 40-line driver. Engine ~55 ms, schema
  40-140 ms: as on the server, the KDF is the cold-start cost, not the database.
- **Cold store, warm key** — §9.2 as written, so the warm-decrypted-store trust claim it
  warned might be forced is not forced. `WEB_SPIKE_STORE=warm` still builds the other arm.
- **Argon2id is the whole login cost (~355 ms) and it stalls the entire host** — the number
  every in-browser measurement is compared against.
- **Cold store and incremental pull are mutually exclusive** — the relay is an append-only log
  with no compaction and a cold host must `pull(0)`. 5c's client is *not* cold, which is why
  "a reload does not re-pull" is worth proving.
- **`SyncEngine` does not expose its high-water mark**, and the obvious substitute
  (`Date.now()`) silently drops writes. Any client that writes needs the real mark.
- **The shared layer ports with no shim** — six-line adapter, loader/actions call-for-call,
  field readers verbatim, view models usable as a share payload; `@leapsake/crypto` (5.9 KiB
  gzip) and `@leapsake/ui` + React (112 KiB gzip) both compile to a browser target; contract
  and migrations run in a browser unmodified.
- **The no-JS floor has a three-item `packages/ui` backlog**, all product work:
  `GiftCaptureForm`, the `HolidaysSection` add-field, `RelationshipFields` on create.

## Decisions that still bind

The rest were consumed by 1-5a and now live in the code they shaped (`vite.config.ts`,
`bootstrap.ts`, the two drivers). These two still constrain unbuilt work:

- **`@sqlite.org/sqlite-wasm` for the browser database** — chosen, and as of 5a *working*,
  so what still binds is the part 5c/5d has yet to use: **OPFS SAHPool needs no cross-origin
  isolation**, where the older OPFS VFS needs `SharedArrayBuffer` and therefore COOP/COEP,
  which would poison the whole origin. (`wa-sqlite`'s async-VFS pitch bought nothing because
  our port is already async; `sql.js` has no persistence story. Migration portability is no
  longer a prediction — `runMigrations` ran unmodified in 5a, `PRAGMA user_version` and all.)
- **One origin, one module graph.** Vite in middleware mode already covers SSR pages, the
  client bundle, the `.wasm` and the service worker from a single origin, and `server.ts`
  reaches the app only through `ssrLoadModule` — load a module twice and the session store
  splits in half. New files in Increment 5 stay inside that graph.

Governance for anything new: `"version": "0.0.0"`, no `typecheck` script, excluded from
`oxlint` via `.oxlintrc.json` → `ignorePatterns`, and out of `vitest.config.ts` — verification
here is manual and in-browser.

## Increment 5b-e — the rest of the browser JS path

Spike-sized only if "can it work" is split from "is it usable." The lever: **the desktop
main/renderer split is isomorphic to the browser main-thread/Worker split.**
`window.api.people.get(id)` is `ipcRenderer.invoke`; a path-addressed `postMessage` proxy over
`CoreApi` is ~40 lines. This re-hosts `core` behind a different RPC — it re-implements nothing.

5a is done: the driver is `apps/web-spike/src/wasm-sqlite-driver.ts`, the page is
`/driver-contract`, and the `optimizeDeps` exclusion the `.wasm` needs is in
`vite.config.ts` with the failure mode recorded beside it.

- **5b — client login, pull, decrypt** on the main thread with `:memory:`. Freeze the tab;
  prove the capability first. Same four calls as the server (`src/bootstrap.ts`), then
  `runMigrations` → `createSyncEngine(...).pull(0)` → `createCore` → render `PersonScreen`
  with the *same* `ui-adapter.tsx`.
- **5c — Worker and OPFS.** Move sqlite-wasm, `createCore`, `createSyncEngine`, and
  `deriveKeyMaterial` into the worker; the main thread keeps React and the RPC proxy. Switch to
  `installOpfsSAHPoolVfs()` + `new poolUtil.OpfsSAHPoolDb("/spike.db")`. **Done when** the page
  stays interactive through login and the full pull, and a reload does not re-pull. Worth
  checking while there: persistence should make `runMigrations` a once-ever cost rather than
  5a's 40-140 ms per load, and the ~55 ms engine init should remain per tab regardless.
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

**What 5 still owes the measurement table** (the server-side half is all in `src/measure.ts`,
one file to delete; 5a's browser numbers are printed by the page that produced them):
**Argon2id in-browser**, main thread (5b) and worker (5c), with the device
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

**Three checks are owed before the teardown**, all the same shape — things verified by
construction or by a stand-in rather than by driving the real thing. 5a found they need not be
manual: the Claude-in-Chrome extension drives the browser the user already has open, which is
how `/driver-contract` was read. Only the Firefox one needs a human, and only because
`javascript.enabled=false` is a Firefox preference.

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
to rediscover it. Each is confirmed, none is built; the reasoning is in
[`WANTED-CHANGES.md`](../apps/web-spike/WANTED-CHANGES.md).

- **The relay needs CORS + `OPTIONS`** before any browser client can exist (~6 lines behind a
  `RELAY_CORS_ORIGINS` env var).
- **The relay never compacts**, and `/sync/pull` has no pagination, so `pull(0)` returns every
  version ever pushed rather than the latest per row. Invisible to desktop and mobile, which
  pull incrementally from a durable cursor; **unavoidable for a cold-per-request host**, whose
  per-request cost then grows with the account's write *history*. Latest-per-row compaction (or
  a `pull` that collapses by row id) is the real answer.
- **The relay's per-IP failed-login budget is wrong for an SSR host** — one IP for every user,
  so ten users mistyping a password lock out the eleventh. Lifted with env vars, not patched.
- **A real SSR host needs a worker pool or a native Argon2 binding**; neither exists here.
- **`SyncEngine` should expose its high-water mark** (or offer a `pushChanged` needing no mark).
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
