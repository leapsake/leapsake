# The web app and sharing — what is unbuilt

Design lives in [`encryption/`](./encryption/); the relay work these build on is
[`accounts-and-sync.md`](./accounts-and-sync.md).

In dependency order:

1. **The web app — Stage 4** (SSR split-session rendering + PWA): the no-JS accessibility floor,
   and the render vehicle every URL-based share needs. The spike that de-risked it is at the tag
   `web-spike-final` (`git show web-spike-final:apps/web-spike/README.md` is its full account).
   It server-rendered a person's page and all of person CRUD with JavaScript disabled, over a
   real split session key, with zero package edits, and settled §9.2's cold-vs-warm question in
   favour of a **cold store with a warm key**, so no warm decrypted store is ever needed. What an
   `apps/web` inherits from it:

   **The relay must change first, and the first two are not optional.**

   - **CORS + an `OPTIONS` handler.** The relay sends no `Access-Control-Allow-*` and answers no
     `OPTIONS`, and the transport's `Authorization` header is not CORS-safelisted, so a browser
     preflights into a 404 and **no browser client can exist**. A few lines behind a
     `RELAY_CORS_ORIGINS` env var, so the default stays closed. ⚠️ The spike got past it by
     proxying `/relay/*` from its own origin; do not let that launder into "no relay change
     needed", because the proxy sees the bearer credential and could impersonate the account for
     ciphertext reads and writes.
   - **Compaction, or a `pull` that collapses by row id**
     ([`@leapsake/sync`](../packages/sync/README.md) → _What the relay may forget_). `pull(0)`
     returns every version ever pushed, which is invisible to clients with a durable cursor and
     unavoidable for a cold-per-request host, whose cost then grows with write _history_ rather
     than store size.
   - **The per-IP failed-login budget is wrong for an SSR host.** `/accounts/session` and
     `/accounts/bootstrap` share a 10-per-60s per-IP throttle, and an SSR host logs in from one
     IP for every user, so ten users mistyping a password lock out the eleventh.
   - Smaller, worth knowing: the pull cursor is global across accounts, a weak side channel on
     total relay activity.

   **Shared-package wants, none blocking:** `SyncEngine` should expose its high-water mark, since
   a host with no durable `sync_state` re-pushes its whole store on every session's first write,
   and the obvious substitute, `Date.now()` after the pull, silently drops same-millisecond writes
   because `listChangedSince` is strict. `createCollectingTestApi` belongs in
   `@leapsake/data/testing`; the spike needed mobile's copy byte for byte. Server-side Argon2id
   needs a worker pool or a native binding: `deriveKeyMaterial` is synchronous, so on a
   single-threaded host every in-flight request freezes during anyone's login.

   **`packages/ui` owes four things, all product work.** A **read-only mode for shared screens**:
   rendered unauthenticated, `RelationshipScreen` still offers Edit / Delete / Add-milestone and
   leaks the item's internal id, and every sharing mode renders somebody else's screen, so this is
   a prerequisite for sharing rather than polish. And these gaps in the no-JS floor:
   `HolidaysSection`'s add-field is a combobox (a `<form>` + `<select>` is a direct swap, the data
   being loaded already); `GiftCaptureForm` writes through a JS port, with no `method`, `action`
   or field `name`s and a combobox for recipients (it needs an action on each route that renders
   it, Gifts' create screen and `GiftsSection` on the Person/Pet page, and a no-JS way to pick
   recipients); relationship rows on the Person/Pet create form are added from an `onClick`, and
   each posts only a hidden JSON value the hook computes, so with no JS none posts (needs named
   fields per row, or a second screen after create); the `other` role's note field appears only
   once that role is picked; a social profile's handle-or-link rule has no HTML form, so only the
   route action refuses it; and web offers no free-text “Other” platform. Everything else on
   the person page and form works with JavaScript off. Capability links cannot, by construction,
   and get a `<noscript>` that says so with the hosted fallback beside it.

   **Hazards the spike paid for, so an `apps/web` does not:** `optimizeDeps.exclude` for
   `@sqlite.org/sqlite-wasm` is load-bearing and its failure is a runtime abort naming neither
   Vite nor the missing `.wasm`; Cache Storage ignores `no-store`, so a service worker must
   allowlist the shell rather than cache everything same-origin, or it writes decrypted person
   pages to disk; the service worker cannot live in the bundler's module graph; a `CoreApi`
   `Proxy` over `postMessage` must not answer to `then`; OPFS's exclusive access handles need a
   `Web Locks` election, which binds only participating tabs; `PerformanceNavigationTiming.name`
   keeps the fragment, so it cannot answer "did the key cross the wire" (the browser's network log
   and a server echo of `req.url` can).

   **Open, each a decision an `apps/web` has to make:** the **framework** (the SSR host wants an
   `href`-passthrough adapter; the JS client wants desktop's `href` → router adapter, because a
   document navigation discards the tab's key and store); **a phone has never been measured**, and
   the KDF is 51–93% of every start on a laptop, so treat ~440 ms as a floor and take the first
   phone reading before committing to a login flow; native binding vs. worker pool for
   server-side Argon2id; passkey PRF for custody strength; what a second tab should do beyond
   queueing; whether the SSR client and the PWA share an origin (they did, which is what forced
   the service worker to know shell from data and the manifest's `start_url` to name the client);
   where a share row lives (the owner's encrypted store, or a new relay table); revocation and
   expiry; whether the 112 KiB browser bundle matters (zod is the second-largest piece and reaches
   the browser through `@leapsake/schema`); media and the no-JS floor.
   **It ships sync-account-only, and that is a product constraint rather than a technical one**
   ([`encryption/model.md`](./encryption/model.md) §10.1). Browser storage
   is evictable at the browser's discretion — `persist()` was refused even on an **installed**
   PWA — so the web client must never hold the only copy of anything. Desktop and mobile keep
   the local-first promise; web is a view onto an account, and eviction there costs one Argon2id
   and a re-pull instead of the account. Two consequences for this increment: there is **no
   local-only / try-before-signup mode on web**, and every web user implies server storage, so
   it lands on whatever the pricing model turns out to be
   (`../leapsake-monetization.md`). The unclosed edge is **offline writes not yet pushed**,
   which requiring an account shrinks but does not remove — this increment owes an honest
   indication of what has reached the relay, and may owe a decision not to offer extended
   offline _writing_ on web at all.

2. **Capability-link sharing** — zero-knowledge public links (key in the `#fragment`, no
   `key_wrap` row). **Built and observed by the spike** — the key never reached the server and
   the page it served held ciphertext only — so what is left is productizing it: where a share
   row lives (owner's store vs. a new relay table), revocation and expiry (§11's other two
   modes, both unexercised), and a **read-only mode for shared screens**, which today still
   offer Edit / Delete to a stranger. Needs the web app as render vehicle **and** the share-URL
   decision (_Open_, below).
3. **Stage 3 — authenticated sharing**: account keypair + public-key directory (TOFU-vs-verify
   trust) + constrained principals (hosted links, Alexa, CardDAV). Kept entirely post-web. **Needs
   an external crypto audit before public ship** — the recorded review is an internal design audit.

   Three tables are designed but unbuilt, and they are **purely additive** — no shipped table
   changes shape, which is what lets this wait. A **`share`** row is the _access policy_
   (`content_key_id`, `kind ∈ capability | hosted | authenticated`, `expires_at`, `max_visits`,
   `visit_count`), deliberately separate from `key_wrap` because it is a different kind of trust:
   the server honestly refusing to serve, rather than cryptography
   ([`encryption/model.md`](./encryption/model.md) §12). Its `kind` selects the key story —
   `capability` → no `key_wrap` at all (the URL fragment); `hosted` → a wrap to a
   `server_principal`; `authenticated` → a wrap per recipient. A child **`share_grant`**
   (share_id, account_id) carries the allowed accounts, and **`server_principal`** (id, label,
   public_key) registers each constrained reader as a sibling of `account`. All three take the
   standard sync-safe substrate; soft-delete is revoke. Lighting them up also starts writing the
   `principal_kind` values already enumerated in `packages/schema/src/key-wrap.ts` —
   `recipient`, `server_principal`, `session` — which is the whole reason that enum was written
   in full up front.

- **Finer sharing granularity.** For now it is acceptable to share People and Pets at the coarse
  grain that pulls in Milestones, Contact Methods, and Relationships. Per-structure granularity is
  a future iteration. (Reminders are **not** a share target.)

_Open, each tied to a stage above:_ the **asymmetric scheme** (X25519/Ed25519, Stage 3); the
**public-key directory trust model** (TOFU vs. verification, Stage 3); the **web framework**
(Stage 4 — the spike deliberately does not settle it); **share-URL formation** across self-hosted
instances at arbitrary domains; and a **confidential-computing enclave for SSR**, the Stage 4
ceiling.
