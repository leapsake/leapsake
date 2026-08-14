# Wanted changes

Every moment the spike was tempted to edit a file under `packages/` (or
`apps/server/`), with what it did instead. The spike doc calls this list "a large
share of the findings' value": Increment 2's done-when is *zero files changed
under `packages/`*, and this is the record of what that cost.

One line each: **what was wanted → what happened instead**.

## Increment 1 — scaffold and seed

- **Relay: per-IP failed-login budget.** `/accounts/session` and
  `/accounts/bootstrap` share a 10-per-60s per-IP throttle. An SSR host logs in
  from one IP for every user, so the budget is structurally wrong for a web
  client. → Lifted with `RELAY_BOOTSTRAP_RATE_LIMIT_MAX` / `RELAY_RATE_LIMIT_MAX`
  env vars for the spike run. **Not patched.** This one is a real relay change,
  and it is already listed in the spike doc's *Changes this spike has already
  justified*.

- **A non-blocking `deriveKeyMaterial`.** It is synchronous and CPU-bound, and it
  freezes the SSR host for ~355 ms per login (README finding 2). Wanted: an async
  or worker-hosted variant in `@leapsake/crypto`. → Nothing changed; the spike
  measures the stall and reports it. This is a real build item for a web client,
  but it is a *design* decision (worker pool vs. native binding) that the spike
  should inform, not pre-empt.

- **A `syncableRepos`-shaped bulk write path.** `core.people.create` runs a full
  `regenerateSystem()` reconcile per call, which is right for a UI and quadratic
  for a 10 000-row seed. → Used `createPeopleRepo(driver).create` directly for
  the filler rows and `core` for the one rich person. No package change wanted on
  reflection: the reconcile is correct behaviour and a seed script is not a user.

- **Nothing else.** The four-call bootstrap, the seed chain, the cold pull, and
  the `@leapsake/ui` SSR load all ran against the shared packages **unmodified**.

## Increment 2 — the no-JS SSR read path

**Zero files under `packages/` were changed, and — the part worth saying —
almost nothing was even tempting.** The read path is three providers, a six-line
adapter, and seven `core` calls. What follows is the whole list.

- **`GiftCaptureForm` renders a raw `<form>` with no `method`, no `action`, and
  not one `name` attribute** (`packages/ui/src/web/gifts/GiftCaptureForm.tsx`).
  It is the only `<form>` on a rendered person page and the only thing there that
  is *inert* rather than merely non-interactive without JavaScript: a browser
  submitting it would post nothing, nowhere. Wanted: route it through the
  adapter's `Form` and give the fields names. → Nothing changed. The rewrite is
  plausible (see the section inventory in the README) but it is **product work**
  — the form's occasion picker and multi-recipient list are genuinely stateful,
  and deciding what their no-JS shape is belongs to whoever builds the web
  client, not to a spike that would be deleted with the answer inside it.

- **`duplicates.findFor` is quadratic, and at 1 000 people it *is* the person
  page** — 122.9 ms of a 151.9 ms request; at 10 000 it is 11 781 ms of 12 078 ms.
  It scans every pair on every person-page load (`packages/core/src/index.ts` →
  `findDuplicateCandidates`, a full in-memory O(n²) pass, filtered afterwards).
  Wanted: an index, a cache, or a `count`-shaped query, since the page only needs
  `length`. → Nothing changed, because **this is not an SSR finding**: desktop
  makes the same call on the same screen and pays the same cost against its own
  store. It is recorded as a shared-app performance defect, and it distorted the
  spike's own numbers until it was measured out of them.

- **A per-call attribution seam.** Seven parallel `core` calls where one blocks
  the event loop make all seven report the same duration, which named no culprit
  for the 12-second page. Wanted: nothing in `packages/` — this turned out to be
  the spike's own measurement bug. → Added `WEB_SPIKE_LOADER=serial` to
  `src/routes/person.tsx`, which runs the loader serially purely to attribute.

- **Not wanted, worth recording as a near-miss:** `@leapsake/ui`'s three
  providers, `PersonScreen`'s prop contract, `views.entityList`, and the whole
  `CoreApi` surface ported without a single edit or wrapper. `UiFormProps`'s
  promise — that an adapter must render a real `<form>` with `method`/`action`
  intact — held: the no-JS adapter is the *degenerate* one, doing strictly less
  than desktop's.

## Increment 3 — the full CRUD round trip

**Zero files under `packages/` were changed again**, but unlike Increment 2 the
list is not almost-empty: one entry below is a genuine gap in `@leapsake/sync`
that a real web client cannot work around as cleanly as the spike did, and one
is the same product decision `GiftCaptureForm` already raised.

- **`SyncEngine` should be able to tell a client its current high-water mark.**
  The whole of README finding 3. `push(hwm)` re-pushes everything newer than
  `hwm`; desktop reads `hwm` from a durable `sync_state` row; a cold SSR host has
  no durable row and starting at 0 re-pushes the entire store on every session's
  first write, permanently inflating an append-only relay log that a cold client
  must then re-pull in full on every request. Wanted: `SyncEngine.currentMark()`
  (the `MAX(updated_at)` across the repo allowlist — the same quantity `push`
  computes internally), or a `pushChanged(rows)` that does not need a mark at
  all. → Computed in the spike instead, with a `SELECT MAX(updated_at)` UNION
  over `repo.table` (`src/hydrate.ts` → `storeMark`). **That workaround is not
  good enough for production**: it depends on two facts `defineSyncable` happens
  to guarantee today — that a repo's `table` is its SQL table name, and that
  every synced table's column is `updated_at` — and if either changes it returns
  a *wrong mark* rather than failing. The engine already knows both; the client
  should not have to.

- **The near-miss that makes the above urgent: `listChangedSince` is `updated_at
  > ?`, strictly.** The obvious client-side substitute for a mark — `Date.now()`
  taken after the pull — silently drops any write landing in that same
  millisecond. Measured at four writes in five, each returning a successful 303
  with nothing pushed. Wanted: nothing changed here; `>` is correct for a mark
  that came from a real push. → Recorded as the reason a synthesised mark is
  unsafe, which is the argument for the engine exposing one.

- **`RelationshipFields` has no no-JS shape** (`packages/ui/src/web/fields/
  RelationshipFields.tsx`). It starts at zero rows, grows them from an `onClick`,
  and emits its hidden `relationships` input only after React resolves the typed
  entity and role against the candidate list — so a no-JS create posts no
  relationships at all. Wanted: a fixed pair of `<select>`s per row, or a
  post-create screen. → Nothing changed. Identical in kind to Increment 2's
  `GiftCaptureForm` entry, and identical in verdict: the shape is a **product**
  decision (the candidate list is already loaded, so a `<select>` is a direct
  swap, but "how many rows does a no-JS form show?" is not the spike's to
  answer). The readers are ported anyway so the action does not silently differ
  from desktop's.

- **Wanted and then withdrawn: an index or a count for `duplicates.findFor`.**
  The ported create action runs it to choose its redirect, so it is now on the
  *write* path as well as the person page. → Still nothing changed, for the
  reason Increment 2 gave: desktop runs the same call on the same flow.

- **Not wanted, and the near-miss worth recording:** the three actions and all
  five field readers ported with **no wrapper and no shim** — the readers took
  `URLSearchParams` where desktop passes `FormData` and needed no other edit,
  because the desktop write path was `FormData`-shaped rather than
  Electron-shaped. `PersonForm`, `FormShell` and `ConfirmDelete` were used
  exactly as desktop uses them; `FormShell`'s action-less `<form method="post">`
  is what lets one component serve create and edit on two different URLs with no
  JavaScript at all.

## Increment 4 — sharing, both flavors

**Zero files under `packages/` were changed a third time.** Two entries, and
neither is urgent: one is the same product decision the previous increments
already logged twice, and one is a bundling observation rather than a want.

- **A shared screen has no read-only mode** (`packages/ui/src/web/screens/
  RelationshipScreen.tsx`). Rendered to an unauthenticated viewer it still emits
  "Edit roles", "Delete" and "Add milestone" links, plus the relationship's
  internal id and the shape of the owner's routes. Wanted: a `readOnly` prop, or
  a viewer-capability context the sections read, so one screen serves both the
  owner and a stranger. → Nothing changed. Identical in kind and verdict to
  `GiftCaptureForm` (Increment 2) and `RelationshipFields` (Increment 3): the
  mechanism is small, but *what a shared view is* — does a viewer see the
  timeline? the other partner's page? — is a product question a spike must not
  answer by implementing one. Recorded because §11 will need it: every sharing
  mode in that table renders somebody else's screen.

- **`@leapsake/crypto`'s index does not tree-shake.** The capability client
  imports `open` and nothing else, and the browser bundle still carries the KDF's
  domain-label constants, because they are top-level `utf8ToBytes(...)` calls no
  bundler can prove are side-effect-free. Wanted, weakly: `"sideEffects": false`
  in the package, or lazily-computed labels. → Nothing changed. It costs a few
  hundred bytes against a 5.9 KiB gzip bundle, so it is a note for whoever cares
  about a minimal browser entry point rather than a change worth making now.

- **Not wanted, and the near-miss worth recording twice over.**
  `views.relationship()` returns *exactly* `RelationshipScreen`'s props, so the
  share payload is the view model sealed verbatim — no share format to design,
  and it type-checks against `@leapsake/ui`'s `RelationshipPartner` with no
  mapping. And `@leapsake/crypto` + `@leapsake/bytes` bundled for a browser with
  **no shim, no polyfill, and no config beyond pointing Vite at the entry**,
  which is the property Increment 5 depends on and the thing this increment was
  asked to check early.

## Increment 5a — the wasm driver and the contract

**Zero files under `packages/` were changed a fifth time**, and this one had the
strongest reason yet to want an edit: a new driver for a third engine is exactly
the moment a port either holds or gets widened. It held, so the list is one real
entry.

- **`createCollectingTestApi` belongs in `@leapsake/data/testing`, beside the
  contract it exists to run.** `runDriverContract` is deliberately
  framework-agnostic so a host with no test runner can drive it — and a host with
  no test runner then needs a `describe`/`it`/`expect` that collects results. That
  shim was written for `apps/mobile`, and this increment needed it **byte for
  byte**: `src/client/test-api.ts` is `diff`-clean against
  `apps/mobile/test/test-api.ts`, with not even an import path changed, because it
  depends on nothing but the exported `TestApi` type. Wanted: move it to
  `packages/data/src/testing/collecting-api.ts` and have mobile import it, so the
  runner-less path is as shared as the spec is. → Copied instead, per the
  zero-edits constraint. Two callers with identical bytes in two apps is the
  clearest case in this whole file: the *second* copy is evidence, where the
  first was a judgement call.

- **Not wanted, and the near-miss worth recording:** `SqliteDriver` needed **no
  widening** for a third unrelated engine. The three ways oo1 differs from
  `node:sqlite` (an empty `bind` throws, `selectObject` already returns
  `undefined` on a miss, `close()` is idempotent) are all absorbed inside 40
  lines of adapter, which is what the port is for. And `runMigrations` ran
  unmodified against a browser database — the "portable SQL only" rule in
  `packages/data/src/migrations.ts` is now checked on three engines instead of
  two.

- **Also not wanted:** the `.wasm` resolution fight is entirely Vite's
  (`optimizeDeps.exclude`), not a package's. Nothing in `packages/` knows the
  driver exists, which is the point of the app owning it.

## Increment 5b — client login, pull and decrypt

**Zero files under `packages/` were changed a sixth time**, and the one entry
that is genuinely blocking is not in `packages/` at all — it is the relay.

- **The relay needs CORS and an `OPTIONS` handler, and this is the increment
  where that stopped being a prediction.** It sends no `Access-Control-Allow-*`
  and answers no `OPTIONS`, and the transport's `Authorization` header is not
  CORS-safelisted — so a browser preflights into a 404 and **no browser client
  can exist**. Wanted: ~6 lines in `apps/server`, behind a `RELAY_CORS_ORIGINS`
  env var so the default stays closed. → Forwarded `/relay/*` from the spike's
  own origin instead (`src/relay-proxy.ts`), which needed **no transport change**
  because `http-transport.ts` concatenates URLs rather than calling
  `new URL(base)`, so a relative `baseUrl: "/relay"` just works. Proxying rather
  than patching, because the relay is the component that is hardening and a CORS
  patch reverted with the spike is the kind of change that survives a revert by
  accident. **The proxy is not the answer and must not be read as one**: it sees
  the account's `authVerifier`, so it could impersonate the account to read and
  write ciphertext (confidentiality survives — the verifier is an independent
  HKDF branch — but integrity and availability do not).

- **A non-blocking `deriveKeyMaterial`, again, and now with the strongest case
  yet.** Increment 1 wanted it because a synchronous KDF stalls an SSR host's
  other requests; in a browser it freezes **the user's own tab** for 450–860 ms,
  and the page cannot even paint "logging in…" without an explicit yield first.
  → Nothing changed. Still a design decision the spike should inform rather than
  pre-empt (worker vs. native binding), and 5c is where the worker arm gets
  measured. Worth noting the shape of the eventual want: a client cannot move
  `deriveKeyMaterial` off the main thread by itself — it can only move
  *everything that calls it* into a worker, which is why 5c relocates the whole
  data layer rather than one function.

- **Not wanted, and the near-misses are the increment's real result.**
  `src/bootstrap.ts` — the SSR host's own four-call login — was **imported and
  run unmodified in a browser**, `@leapsake/crypto` and `@leapsake/sync` and all.
  `ui-adapter.tsx` was imported unmodified too, and `PersonScreen` rendered from
  `createRoot` with the same three providers `render.tsx` mounts for
  `renderToString`. The gift ports are `apps/desktop/.../gifts-ports.ts` with
  `window.api` → `core`, and the screen container is desktop's `PersonView` with
  `useLoaderData` → the loader called directly and `useRevalidator` → calling it
  again. **A fourth host, a fourth transport under `CoreApi`, and nothing
  reshaped.**

- **A `readOnly`-shaped want that is *not* wanted here, recorded so it is not
  re-raised:** the client renders the owner's own screen, so its Edit / Delete /
  Add-milestone links are correct rather than leaky. What they *are* is full
  document navigations that discard the tab's key and store — an adapter and
  routing question for a real web client (README finding 5), not a package one.
  Desktop's adapter already solves it by mapping `href` onto react-router's `to`.

- **Not a package change, and not the plugin's fault either:**
  `@vitejs/plugin-react`'s Refresh preamble had to be emitted by hand
  (`render.tsx` → `REACT_REFRESH_PREAMBLE`), because the normal route —
  `transformIndexHtml` — would inject `/@vite/client` into every page and break
  the "no `<script>` in the response" property Increments 2–4 assert on the wire.
  One opt-in flag, one page using it.

## Increment 5c — the Worker and OPFS

**Zero files under `packages/` were changed a seventh time**, and this increment
is the one that could most plausibly have failed that way: re-hosting `core`
behind a message port is exactly where an API that assumed it was called in-process
would show it. It did not, so two of the three entries below are *withdrawals* —
wants from earlier increments that this one dissolved rather than added to.

- **Withdrawn: "a non-blocking `deriveKeyMaterial`" is not the want.** Increments
  1 and 5b both asked for an async or worker-hosted KDF in `@leapsake/crypto`.
  5b already noted a client cannot move one function off the main thread by
  itself — it can only move *everything that calls it*, and that is what this
  increment did: the synchronous `deriveKeyMaterial` runs unchanged in a Worker,
  and the page stays at single-digit-millisecond task latency throughout. So the
  API needs nothing. → What survives is a *different* want, unchanged by any
  amount of threading: the KDF still costs what it costs, so a **faster
  implementation or a persisted key** (5e) is the only thing that makes a warm
  start cheap. A server-side host still wants a worker pool or a native binding
  for the separate reason Increment 1 gave.

- **Narrowed: `SyncEngine`'s missing high-water mark is a *cold-store* want, not
  a client-side one.** Increment 3 needed the mark because a stateless SSR host
  has nowhere durable to keep it; a browser client with an OPFS database has the
  same `sync_state` table desktop does, so it builds the engine with a
  `syncState` repo and gets `sync()` — durable marks included — for free. → No
  change wanted from *this* host, and the Increment 3 entry stands as written for
  the host that has no durable store. One caveat, **read out of
  `packages/sync/src/engine.ts` rather than measured**, since this client is
  read-only: `sync()` is push-then-pull, and a first sync on an empty store
  stores `push_hwm = 0`, so the *next* sync re-pushes every row the first one
  pulled. Bounded and one-time, but a persistent client that starts pushing
  should set the mark after its first pull rather than discover this on the relay.

- **Wanted, and small: a browser `KeyStore`, which is 5e's subject and is now
  urgent rather than interesting.** Persistence changed what the KDF is *for*.
  Before this increment every reload lost everything, so paying Argon2id again
  was merely slow; now the store, the schema and the cursor all survive and the
  key is the **only** thing that does not — so the whole cost of a warm start is
  a KDF run whose result is thrown away deliberately. → Nothing changed;
  `@leapsake/key-custody`'s `KeyStore` port is exactly the right seam and §13
  leaves the browser's implementation open. Recorded here because 5c is what
  makes the gap visible: the numbers on the page are a persistent client asking
  for a key it is not allowed to keep.

- **Not wanted, and the near-miss is the increment's whole result.** `CoreApi`
  crossed a thread boundary **behind a 40-line `Proxy`** with no batching layer,
  no method table and no change to any package: property access accumulates a
  path, calling it posts the path and the arguments, and the reply resolves the
  promise. It works because the API is entirely async and entirely plain-data,
  which it is because it was already crossing desktop's `ipcRenderer` boundary.
  The proof is structural rather than asserted — `src/client/person-app.tsx` is
  **one file rendering against both**, a real `core` on 5b's page and a proxied
  one here, and `gifts-ports-client.ts` is reused across the boundary untouched.
