# Leapsake — Web client (`apps/web`)

> **What the spike proved, and what an `apps/web` inherits.** The *design* is
> [`encryption/model.md`](./encryption/model.md) §9.2 (server-side decryption), §10 (the
> progressive-enhancement table), §11 (sharing), §13 (the `KeyStore` port per client). This doc
> holds the spike's **answers** — nothing restates the design, and nothing here re-derives the
> narrative that produced them. Everything below is an input to a web client nobody has started.

**The spike is done: six increments, 2026-08-02 → 2026-08-14.** Read, write, both sharing
flavors, the browser data layer, the whole client-side login path, that path in a Worker over a
persistent store, a reload that needs neither the password nor the relay, and finally one that
needs no server either. Every question answered yes, every one with **zero files changed under
`packages/`** — nine times.

> **The spike is closed** *(2026-08-15)*. All four owed checks are done — the last two by the
> owner at a keyboard — and `apps/web-spike` is deleted. The code is at the tag
> **`web-spike-final`**: `git show web-spike-final:apps/web-spike/<path>` works forever, and
> *Where the code went* below says which files are worth reading.
>
> **This doc is not part of the numbered v0.1 set and does not retire with it** *(renamed out of
> `v0-1_web-spike.md`, 2026-08-15)*. The spike was scheduled pre-v0.1; its **subject is
> post-launch**, and its work landing is precisely what created the thing worth keeping. It
> retires when an `apps/web` exists and everything here has moved next to that code.

## The three questions, answered

The owner asked three things on 2026-08-02. In three sentences:

1. **Can an authenticated sync user view their data on the web?** **Yes** — and in two different
   architectures, both built: an SSR host that decrypts per request and holds no standing
   plaintext store, and a browser client that decrypts in the tab and never gives the server a
   key at all.
2. **Can they share part of it?** **Yes**, in both §11 flavors from one mechanism, differing by
   exactly one thing — who holds the content key — with the zero-knowledge flavor's key never
   reaching the server's request line.
3. **Can both work with JS, without JS, and as a PWA?** **Yes, yes with a three-item product
   backlog, and yes** — the no-JS floor renders and round-trips create/edit/delete with zero
   `<script>` on the wire, and the installed app resumes offline in 69.3 ms with **0 bytes
   across the wire**.

The load-bearing non-result behind all three: **the shared layer was never client-shaped.** A
six-line adapter, the desktop loader and actions call for call, the field readers *verbatim*,
`CoreApi` across a thread boundary behind a 40-line `Proxy`, `SqliteDriver` unwidened for a third
engine, `KeyStore` implemented as written. Four hosts now, and nothing reshaped for any of them.

## The measurements

One machine, and now permanently: **MacBook Pro (Mac14,6), M2 Max, 12 cores, 32 GiB, macOS
26.5.1, Chrome 151**, 10.0 GiB storage quota. See *Open questions* → the phone.

**Cold start, by host.** The browser column is a *visible* tab; hidden-tab readings are not
comparable to anything and are excluded (a backgrounded renderer de-prioritizes main thread and
workers alike, three-fold and noisily).

| stage | SSR host (Node 24) | browser, cold login | browser, resume |
| --- | --- | --- | --- |
| Argon2id | 386 ms | **441 ms** | **not run** |
| schema — `runMigrations`, 28 migrations | 5.4 ms *(0.1 ms via `serialize`/`deserialize`)* | 91 ms, new OPFS file | 14–29 ms, nothing to do |
| pull + decrypt + apply | 22.9 ms / 446 records | 277 ms / 129 records *(8.4 ms of it transport)* | **not run** |
| unwrap the master key | — | — | 4.9–10.2 ms |
| **total** | **421 ms** | **859 ms** | **40–96 ms** |

**The KDF is the whole cost, on every host.** 51% of a cold browser login, 93% of one against a
store that already exists, and ~85% of a browser cold start at the sizes that matter. A Worker
does not make it cheaper — 433.3 / 440.6 / 441.1 ms on a worker against 449.4 ms on the main
thread — it moves *which* thread pays, and that is worth everything: the page's own worst
unavailability drops from ~800 ms to **8.4 ms**.

**SSR per-request page, cold store + warm key** (p50, list page, login outside the loop):

| people | cold store, warm key | warm store | what cold pays for |
| --- | --- | --- | --- |
| 100 | **6.6 ms** | 3.7 ms | 128 records re-pulled |
| 1 000 | **36.8 ms** | 8.2 ms | 1 028 records |
| 10 000 | **352.1 ms** | 66.9 ms | 10 028 records, 2.2 MiB |

**Offline, installed:** resume in **69.3 ms** with **0 bytes** on the wire and
`navigator.onLine: true` — the browser labelling the navigation `deliveryType: "cache-storage"`
itself, with the dev server *killed* rather than DevTools pretending. A second offline reload,
OS page cache warm: **14.3 ms**. A second tab queues on a `Web Lock` and takes the store over in
**21.5 ms** when the first closes.

**Weights:** `@leapsake/crypto` + `@leapsake/bytes` **5.9 KiB gzip**; the same plus React and a
shared screen **112 KiB gzip** (react-dom the largest piece, **zod the second**, `@leapsake/ui`
itself 16 KiB); the sqlite `.wasm` **864 KiB**, which dwarfs both and is slower out of Cache
Storage (218.8 ms) than out of Chrome's own (20–91 ms).

## What must change before a browser client can exist

### The relay — three, and the first two are not optional

- **CORS + an `OPTIONS` handler.** No longer a prediction: the relay sends no
  `Access-Control-Allow-*` and answers no `OPTIONS`, and the transport's `Authorization` header
  is not CORS-safelisted, so a browser preflights into a 404 and **no browser client can exist**.
  ~6 lines behind a `RELAY_CORS_ORIGINS` env var so the default stays closed. The spike got past
  it by forwarding `/relay/*` from its own origin — **do not let that launder into "no relay
  change needed"**: the proxy sees `Authorization: Bearer <accountId>.<b64(authVerifier)>`, so it
  could impersonate the account to read and write ciphertext. Confidentiality genuinely survives
  (the verifier is an independent HKDF branch); integrity and availability do not.
- **Compaction, or a `pull` that collapses by row id.** The relay is an append-only log with no
  compaction and `/sync/pull` has no pagination, so `pull(0)` returns every version ever pushed
  rather than the latest per row. Invisible to desktop and mobile, which pull incrementally from
  a durable cursor; **unavoidable for a cold-per-request host**, which must `pull(0)` and whose
  per-request cost therefore grows with the account's write *history* rather than its size.
- **The per-IP failed-login budget is wrong for an SSR host** — `/accounts/session` and
  `/accounts/bootstrap` share a 10-per-60s per-IP throttle, and an SSR host logs in from one IP
  for every user, so ten users mistyping a password lock out the eleventh. Lifted with env vars
  for the spike run, not patched.

*Smaller, and worth knowing rather than fixing:* the relay's pull cursor is **global across
accounts**, not per-account. Correctness is unaffected — records are account-scoped — but a
client's cursor is a weak side channel on total relay activity.

### The shared packages — three, none blocking

- **`SyncEngine` should expose its high-water mark** (or offer a `pushChanged` needing no mark).
  `push(hwm)` re-pushes everything newer than `hwm`; a host with no durable `sync_state` row must
  start at 0 and so re-pushes its entire store on every session's first write — measured at
  **6.2× the relay log and 4.3× the page from five logins, permanently**. The obvious substitute
  is silently broken: `Date.now()` after the pull drops any write landing in that same
  millisecond, because `listChangedSince` is `updated_at > ?` *strictly* — **four writes in five
  pushed nothing while returning a happy 303**. 5c narrowed the scope: a browser client with an
  OPFS database keeps `sync_state` like desktop and gets both marks from `sync()`, so this is a
  **cold-store** want, not a client-side one.
- **`createCollectingTestApi` should live in `@leapsake/data/testing`**, beside the
  framework-agnostic contract it exists to run. Mobile wrote it; 5a needed it **byte for byte**,
  `diff`-clean, not even an import path changed. The second copy is evidence where the first was
  a judgement call.
- **A server-side Argon2 worker pool or a native binding.** `deriveKeyMaterial` is synchronous
  and CPU-bound, so on a single-threaded SSR host every in-flight request freezes for the
  duration of anyone's login — ten concurrent logins is a three-second stall for everybody.
  Neither exists in the repo. *Which* of the two is an open question; that one is needed is not.

**Read "no package change" carefully.** Two things the spike deliberately did *not* want are not
the same as nothing to build: `packages/data` ships **no drivers by design** and `packages/crypto`
ships the `KeyStore` **port plus an in-memory adapter** — so the web client owns its wasm driver
(~40 lines) and its IndexedDB custody adapter (~60 lines) exactly as every other app owns its
own. Both are app work that no package change would remove.

### `packages/ui` — four items, all product work

Three are the no-JS gaps below. The fourth: **a shared screen has no read-only mode.** Rendered
to an unauthenticated viewer, `RelationshipScreen` still emits "Edit roles", "Delete" and "Add
milestone", plus the relationship's internal id and the shape of the owner's routes. The
mechanism is small (a `readOnly` prop, or a viewer capability the sections read); *what a shared
view is* — does a viewer see the timeline? the other partner's page? — is not, and **every §11
mode renders somebody else's screen.**

## The no-JS floor

The strong form of the claim, and it holds by construction rather than by luck: the SSR response
contains **no `<script>` element and no inline event attribute**, so the DOM a browser builds is
identical either way. Every mutation is navigation to a `/new`, `/edit` or `/delete` route — **23
real `<a href>`s** on a person page, and exactly **two `<button>`s**, both inside the one form
that does not work.

| person page | no JS | verdict |
| --- | --- | --- |
| Contact methods, Milestones, Relationships, Mentioned in | ✅ works | — |
| Tags | ✅ works | "Edit tags" is a link to `/edit` |
| Holidays | ⚠️ renders, inert | **plausible**: the addable list is already loaded, so a `<form method="post">` with a `<select>` is a direct swap |
| Gifts | ❌ inert | **product work**: `GiftCaptureForm` emits a bare `<form>` with no `method`, no `action` and **no `name` on any field** — a no-JS submit posts nothing, nowhere. Needs a `/gifts/new?for=` route and named fields |

| person form | no JS | verdict |
| --- | --- | --- |
| Fields + Gender | ✅ works | plain `<input>`/`<select>` with names |
| Tags (`ChipTextField`) | ✅ works | in `grammar="tags"` the visible input *is* the stored value and carries `name`; only the chip picker is lost. In `grammar="prose"` it would not — there the `name` is on a hidden input React maintains |
| Relationships (create only) | ❌ inert | starts at zero rows, grows them from an `onClick`, and emits its hidden input only after React resolves the typed name against the candidate list. Needs a fixed `<select>` pair per row, or a second screen after create |

**Confirmed by hand in Firefox with `javascript.enabled=false`** *(owner, 2026-08-15 — the check
Increment 2 could only make with `curl` and a markup parse)*. Create, edit and delete were each
walked through the real browser with the pref off and all three worked, as did a **hosted** share
link opened in the same session — the half of Increment 4 that a DOM stub could not reach. The
two known-inert affordances behaved as the table above predicts and nothing else did. So the
strong claim — the DOM a browser builds is identical either way — is now observed in the browser
rather than argued from the bytes.

**All three gaps are gaps in the floor, not in the components.** 5b rendered the identical
components in a browser client and `HolidaysSection`'s combobox and `GiftCaptureForm` are both
fully live there, with no change to either. A client with JavaScript gets the whole screen from
the same code the SSR host renders as HTML.

**And the write path is the same code too.** The three actions are the desktop router's call for
call; the field readers ported *verbatim*, one edit each — the parameter type, `FormData` →
`URLSearchParams`, whose bodies are identical because the two classes agree exactly on the
surface the readers use. The desktop write path was never Electron-shaped; it was
**`FormData`-shaped**, and a no-JS host gets that free from the raw body.

**A real desktop build converges on it, both directions** *(Electron 41.7.1, 2026-08-14 — the
check Increment 3 could only make with a Node peer)*. A **clean install** on a throwaway
user-data directory joined the spike's relay account in **836 ms**, `duplicateCount: 0`, and
converged on **100 people** — Ada Lovelace and Charles Babbage among them. Then:

- a create on the **JavaScript-disabled web client** arrived on `syncNow` with the **same row
  id**, 100 → 101;
- a create in the **desktop app** came back rendered by the SSR host, with **zero `<script>`**.

That closes both halves of Increment 3's caveat, and the second half is the one worth naming:
this store is **encrypted at rest**. Increment 3's peer used plain `node:sqlite` against a plain
file; this is `better-sqlite3-multiple-ciphers` on the Electron ABI, and the resulting 385 KiB
file has **no `SQLite format 3` header** — `sqlite3` refuses it outright as "not a database". So
the envelope (layer 2) and the at-rest cipher (layer 1) are now observed composing on a real
build, rather than argued to be independent.

## Sharing: two flavors, one mechanism

| | capability link | hosted link |
| --- | --- | --- |
| where the key is | the URL fragment, client-side only | the server, `wrap(ck, hostKey)` |
| page contains | 840 B ciphertext, **0 B plaintext** | the rendered relationship |
| `<script>` in the response | 1 | **0** |
| works with JS disabled | **no, and cannot** | yes |
| re-showable to the sharer | **no** | yes |
| server can read the content | no | **yes** |

Two rules fall out, and both are product rules rather than implementation details:

- **Capability links are structurally incompatible with the no-JS floor.** The key never
  arrives, so no server can render the page. This is the one place the accessibility floor cannot
  be reached by more work, and the answer is a `<noscript>` that says so rather than a page that
  looks broken. The hosted fallback beside it is a ten-line route.
- **A capability link cannot be re-shown.** The key exists in the host process only for the
  duration of the create request, and a redirect target could only carry it in a fragment the
  redirected-to server would never see — so the create *response* is the only place it ever
  appears. Lose the link and you re-share. That is what "the server cannot read it" means seen
  from the sharer's side, and it belongs in whatever UI offers the choice.

The payload needed no share format: `views.relationship()` already returns exactly the screen's
props, so the view model is sealed verbatim and type-checks against `@leapsake/ui` with no
mapping.

**The zero-knowledge claim is confirmed in a real browser** *(Chrome 151, 2026-08-14 — the check
Increment 4 could only make with a DOM stub)*. A capability link opened with its 43-character
fragment, and three witnesses agree:

- the browser's **document request** is logged as `/share/<id>` — **no fragment**;
- the **server's own echo** of `req.url` reads `/share/<id>` for a request the *page* issued with
  `location.href`, fragment and all — byte-identical to one issued without it. So both request
  paths a browser takes, navigation and `fetch`, drop the key;
- the tab still holds the key (`location.hash`, 43 chars) and **decrypted with it**: "Ada
  Lovelace & Charles Babbage" rendered from **840 bytes of ciphertext** in a 1 566-byte
  `private, no-store` body containing **zero plaintext** — one `<script>`, one `<noscript>`.

Every figure matches Increment 4's to the byte, so what the check moved is the *warrant*, not the
numbers: the rule was read out of the Fetch standard and is now observed in the browser the claim
depends on.

## Three edits owed to `encryption/model.md` — one applied, two still owed

Changes to *designs*, not findings about code. **The third is applied** *(owner, 2026-08-15)*;
the first two remain one-line-to-one-row edits an owner should green-light.

- **§9.2 should say the `authVerifier` is wrapped under the session key too.** Relay sessions are
  in-memory per process, so a restart forces a re-login and the host must re-authenticate without
  the password — which means the session store holds a standing relay credential. In the clear
  beside the wrapped master key it partly defeats the split: a store thief gets read/write access
  to all of the account's ciphertext. Wrapping it is one more line. The model does not currently
  spell this out.
- **§9.2's cold-vs-warm question is answered: cold**, with two orders of magnitude to spare at
  realistic store sizes (table above). The configuration is §9.2 as written — the *key* is warm
  (`wrap(MK, sk)` server-side, `sk` in an `httpOnly` cookie), the *store* is memory-only,
  request-scoped and closed in a `finally`. **The SSR web app never holds a standing decrypted
  database in server memory**, so the product-visible trust claim §9.2 warned might be forced is
  not forced. *(Deliberately unmeasured: peak RSS per warm session — it only decides anything if
  warm is forced, and it is not.)*
- ✅ **§13's PWA row** — *applied 2026-08-15*, as a rewritten row plus three bullets under §13's
  table, because it read as though nothing works until PRF does, and something does. The
  durability half also produced a **product rule**, now [`model.md`](./encryption/model.md)
  §10.1: **the web client requires a sync account and must never hold the only copy.** The owner
  check that forced it is below — `persist()` is refused on an *installed* origin too, not only
  on `localhost`, so an install is not the fix:

  ```
  best-effort (evictable) storage — persist() was refused, 8.8 MiB used of 10.0 GiB
   · running as: standalone
  ```

  *(Chrome 151, owner, 2026-08-15. `standalone` is the install having taken effect. It
  contradicts Chrome's own documented criteria, which name PWA installation as a thing that
  grants persistence — leaving site engagement or a `localhost` exclusion as the explanations,
  and neither is chased: no more measurement.)* The three parts as applied:
  - *the port is satisfied today* — a non-extractable `AES-GCM` `CryptoKey` per secret in
    IndexedDB implements `getSecret` / `setSecret` / `deleteSecret` as written, ~60 lines, no
    widening, and `exportKey` is refused on every run. An attacker who reads IndexedDB gets a
    wrap they cannot open anywhere else;
  - *passkey PRF is what it still lacks* — **user presence**, a per-unlock gesture a background
    XSS cannot supply. Non-extractable stops exfiltration, not same-origin use, because using the
    key is the entire point of storing it. So PRF stays the designed answer and this is the floor
    rather than the ceiling.
  - **Durability belongs in the same row.** `storage.persist()` is `[Exposed=Window]`, so the
    thread that owns the data cannot protect it — and it is **refused on `localhost` and on an
    installed origin alike**, leaving both the OPFS store and the wrap evictable. The failure
    mode is mild *because §10.1 makes it so*: eviction costs one Argon2id and a full re-pull,
    **not an account** — which is only true while the web client requires one.

## Where the code went

`apps/web-spike` was deleted on **2026-08-15**, and the commit before that is tagged
**`web-spike-final`** — one `git worktree add` from runnable, without being maintained. Nothing
was lost by the delete: `git show web-spike-final:apps/web-spike/<path>` works forever, and
paths below are relative to `apps/web-spike/`.

Of ~8 000 lines, these are what an `apps/web` would otherwise re-derive:

| file | why it is worth reading |
| --- | --- |
| `src/wasm-sqlite-driver.ts` | the whole browser data layer in ~40 lines; the three ways oo1 differs from `node:sqlite` are absorbed inside it (**an empty `bind` throws** — the one that breaks `runMigrations`'s own first statement) |
| `src/client/core-proxy.ts` | `CoreApi` over `postMessage` in one recursive `Proxy` — no method table, no batching. **It must not answer to `then`**, or an accidental `await core.views` hangs forever |
| `src/client/key-custody.ts` | the `KeyStore` port over IndexedDB + a non-extractable `CryptoKey`, per-secret so `deleteSecret` is complete; plus the account record and the relay canary that prove a warm start got the *right* key |
| `src/client/core-worker.ts` | the `Web Locks` election (~40 lines) that turns OPFS's exclusive access handles from a crash into a queue; the lock is held by a promise that never resolves, so the browser releases it when the tab dies |
| `src/client/service-worker.js` | `isShell()` — the five-line allowlist that is the whole difference between an app cache and a data leak (below) |
| `vite.config.ts` | three load-bearing lines: `ssr.noExternal: [/^@leapsake\//]`, `optimizeDeps.exclude` for the `.wasm`, and `worker: { format: "es" }` |

Four hazards that cost hours to find and minutes to avoid, so they are written here rather than
left in a deleted docblock:

- **`optimizeDeps.exclude` for `@sqlite.org/sqlite-wasm` is load-bearing, and its failure is a
  runtime abort.** Pre-bundling moves the module and leaves the `.wasm` behind; the build is
  clean, the page loads, and then emscripten aborts at init naming neither Vite nor the missing
  file. Any bundler that relocates a module relative to its asset reproduces it.
- **Cache Storage ignores `no-store`.** `cache.put` stores a `private, no-store` response as
  happily as any other, so a service worker caching "everything same-origin" would write
  server-rendered person pages — names, contact methods, timelines — to disk, on an origin whose
  SSR half exists precisely to avoid that. Allowlist the shell; let everything else fall through.
- **A service worker cannot live in the bundler's module graph.** It controls only URLs at or
  below the path it is served from, so it is served from the root off disk and is the one
  untransformed file in the app. Every production bundler ships a service-worker special case,
  and this is why.
- **Parallel timings cannot attribute blocking work.** Seven parallel `core` calls where one
  blocks the event loop all report the *same* duration, naming no culprit — which is what hid a
  12-second page. And a naive `setInterval`/`clearInterval` stall probe reads **0 ms**, because a
  synchronous block prevents the timer callback from ever running. In a hidden tab neither works
  at all: `requestAnimationFrame` never fires and `setInterval` is clamped to ~1 s, so a provably
  free main thread reads 724–950 ms of "stall". What works is a `MessageChannel` posting to
  itself and measuring the gap between deliveries.
- **`PerformanceNavigationTiming.name` keeps the fragment**, so it is *not* an instrument for
  "did the key cross the wire" — it reports the document's URL, not the request line, and it is
  the first thing anyone re-checking the capability claim reaches for. The instruments that
  answer the question are the browser's own network log and a server that echoes `req.url` back.

One shared-app defect the spike measured and deliberately did not fix, because it is **not an SSR
finding**: `duplicates.findFor` is a full in-memory O(n²) pass run on every person-page load and
on every create, and the page only uses `.length` of the result — 2.1 ms at 100 people, 122.9 ms
at 1 000, **11 781 ms at 10 000**. Desktop makes the identical call on the same screen.

## Open questions

Nothing below was answered by the spike, and each is a decision an `apps/web` has to make.

- **Framework.** Deliberately open, and the cost of leaving it open was visible and small: five
  increments of bare `node:http` + `renderToString` cost one regex, a literal route ordered above
  the pattern it would otherwise match, and a hand-written loader/action pairing. It argued for
  nothing in particular. But **the SSR host and the JS client want different adapters over the
  same screens**: the degenerate `href`-passthrough adapter is right for no-JS and wrong for a
  client-side app, where every link is a document navigation that **discards the tab's key and
  store** — a click on "Edit" is a re-login. Desktop's adapter (`href` → react-router's `to`) is
  the shape the client half needs, and it already exists in the repo.
- **A phone, and now permanently unmeasured** *(owner, 2026-08-14: 5d was the last number)*.
  Every figure above is one M2 Max laptop, and the device that decides whether a browser client
  is usable is the one nobody measured. The KDF is 51–93% of every start and is exactly the work
  a phone is worst at, so treat **~440 ms as a floor, not an estimate** — and take the first
  phone reading before committing to a login flow, not after.
- **Native binding or worker pool for server-side Argon2id.** One of them is needed; which is
  open, and neither exists in the repo.
- **Custody strength** — the port is answered, the strength is not. §13's passkey PRF adds the
  user-presence gesture a background XSS cannot supply, and remains untested.
- **What a second tab *should* do.** The mechanical half is settled — it queues, then takes over
  in 21.5 ms. Two things stay open: a queued tab **does nothing**, and a `SharedWorker` owning the
  store (which would make both live) is unproven; and the election binds only *participating*
  clients, so it is a convention inside one app rather than a guarantee from the platform — an
  older tab that does not take the lock still holds the access handles and the queue is blind to
  it, observed twice.
- **Whether the SSR client and the PWA share an origin.** They do here, and two things fell out
  of it that a real deployment inherits: the service worker had to be told which URLs are shell
  and which are somebody's decrypted data, and the manifest's `start_url` had to name the client
  rather than `/`. Separate origins make both questions disappear and cost a second deployment
  plus a cross-origin story for shares.
- **Where a share lives.** The spike's process `Map` decides nothing. A real share is a row —
  in the owner's encrypted store (syncs to their devices; the link dies when they are offline) or
  in a **new relay table** (always resolves; the relay grows a schema). §11 does not say, and the
  answer decides whether this is a fourth relay change.
- **Revocation and expiry**, both unexercised. Two of §11's four modes are built; the remaining
  two are server-side gatekeeping of *delivery* and look cheap — but revocation is load-bearing,
  because a capability link cannot be re-shown, so revoke-and-re-share is the only way to correct
  a mis-sent one.
- **Whether the browser bundle's size matters.** 112 KiB gzip for a read-only screen, zod the
  second-largest piece, reaching the browser unavoidably through `@leapsake/schema`. An installed
  app downloads it **once** and then serves it from Cache Storage, so it is a first-launch cost
  rather than a per-visit one — and the 864 KiB `.wasm` dwarfs it either way. The fix, if there
  is one, is a shared-package shape change rather than a web one.
- **Media and the no-JS floor** — [`v0-2.md`](./v0-2.md) raises it: serving decrypted media to a
  no-JS browser means the render server transiently holds *file* keys. Out of scope here (no
  blobs exist yet); these SSR measurements are the input to that decision.
