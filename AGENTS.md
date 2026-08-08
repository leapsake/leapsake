# AGENTS.md

## Project Overview

Leapsake is a privacy-first people management app. Data lives locally in SQLite;
no cloud dependency in V1. The architecture is designed to grow incrementally:
desktop (V1) → mobile (V2) → sync + web (V3). It is a personal project, restarted
from scratch after a prior version became overcomplicated on an unfamiliar stack
(Rust/Tauri) — hence the bias toward incremental, shippable delivery and a lean,
mostly-stdlib dependency set.

> **For what to work on next, see [`plans/status.md`](plans/status.md)** (the single status
> oracle); for the project map, [`plans/README.md`](plans/README.md). This file is
> conventions and guardrails, not status.

## Guiding Principles

- Simpler is better than more complex.
- Always prefer small, incremental, independently commitable changes that can deliver independent value. Massive commits create more errors.
- Approach applications from an offline-first, progressively enhanced perspective.
- Always use pnpm as the package manager, and pnpm workspaces to manage the independent workspaces
- Use TypeScript whenever possible.
- Prefer less code over more code, but prefer legible code over concise code or "code golf"
- Add a dependency only when it pays for itself across more than one place, and say why
  where it lands (the package's README, or the commit that adds it). The dependency set is
  deliberately lean — `package.json` is the list; there is no second copy of it to consult.
- Well-written tests are preferable to docs or code comments that can drift to not reflect accurate behavior.
- Tests should generally treat the thing they are testing as a black box, and not care about the implementation.
- Well-named, legible functions and code are preferable to code comments or docs, but code comments and docs are preferable to unclear code or behavior.
- Use docs for
  - explaining infrequently-changing architecture that cuts across many files in a more succinct way
  - steps that a human needs to take to interact with the codebase
  - planning steps
- As much generalized logic as possible should live in packages/, so that we can share logic across clients
- Specific logic that's only used for a given client or app should be located in that relevant apps/ project.
- For code comments, docs, string content, text in the UI, and anywhere else appropriate, be sure to use the appropriate quotation marks, e.g. “Father’s Day” instead of "Father's Day".

### Product posture — the "why it must feel this way" *(decided 2026-07-05)*

These are stable and shape *how* every increment is built, not what gets built next.

- **Laypeople first, power users under the hood.** Defaults must work for someone who has never
  heard of a key or a relay; every stronger-or-different choice is a **visible-but-optional
  dial, never a prerequisite**. When a security default would add a hoop for a layperson, the
  hoop becomes opt-in. The reasoning is `plans/encryption/model.md` §1.
- **Interact like a typical, centralized SaaS app — but with better protections underneath.**
  The mechanism must serve that layperson mental model, not leak through it. A user should
  **not have to manage multiple accounts** on a single device or relay: *one identity, one
  credential set*. A credential set is a password plus its recovery backstop — the familiar
  arrangement (Proton, Bitwarden) — not several coequal secrets to juggle.
- **The recovery phrase is a backstop, not a ritual.** Shown once, in the role every SaaS user
  already understands: *forgot password*.
- **An account is invited, never required.** Single-device, local-only use is fully
  layperson-complete with no account at all; the invitation arrives once there is data worth
  protecting. A nudge, never a wall — see [`@leapsake/reminders`](packages/reminders/README.md).
- **Pre-v0.1 latitude** *(owner, 2026-07-27)*: **breaking changes that cost a new dev install
  are fine.** There are no real users, so a migration is only worth writing when it is genuinely
  cheaper than "delete the profile and relaunch" — prefer the simpler code. **This expires at
  v0.1.** Until then it is why several stores, key formats, and door layouts were replaced
  rather than migrated.


## Repository Structure

`apps/{desktop,mobile,server,web}` over `packages/*`, wired in one direction:

```
schema  →  data  →  core  →  clients
```

- **`schema`** — Zod schemas → inferred types, plus pure portable domain logic
  (formatters, role algebra, normalization, search folding). Zero platform deps.
- **`data`** — the `SqliteDriver` port, the migration runner, per-entity
  repositories, cross-repo services (kinship, search, timeline), and the sync
  substrate (`defineSyncable`, `sync_state`). Imports no DB driver.
- **`core`** — the client-agnostic `CoreApi` that every client wires up. It is
  the composition root: it owns the syncable-repo allowlist and the relay wiring,
  and it is the only package that depends on the others.
- **Everything else is a narrow package `core` composes** — `sync`,
  `key-custody`, `store-layout`, `crypto`, `bytes`, `holidays`, `reminders`,
  `contact-import`, `highlight`, `ui`, `view-models`. **New domain logic gets its
  own package** with injected ports rather than a new folder inside `core`.

**Each package's own `README.md` is the authority on why it is shaped the way it
is**, and `ls packages/` is the authority on which exist — do not keep a copy of
either here. The project map is [`plans/README.md`](plans/README.md);
`plans/` itself is forward-looking only.

Client-specific logic lives in that client's `apps/` project; anything two
clients could share belongs in a package.

## Data Model

The domain is **people, pets, tags, a relationship graph with derived kinship +
dismissals, milestones, typed contact methods** (email/phone/postal), holidays and
observances, reminders, gifts, and the V3 account/key/sync tables. The forward-only
migrations in `packages/data/src/migrations.ts` are the current shape; the Zod
schemas in `packages/schema/src` are the current types. Read those — a summary
here would be one more thing to keep in step, and would lose.

The conventions they all follow, which *are* this file's business:

- **Primary key**: client-generated UUID, stored as `TEXT`. Deterministic
  (content- or key-derived) where two offline devices could assert the same fact —
  otherwise they mint two rows that collide on a partial unique index at sync time.
- **`created_at` / `updated_at`**: `INTEGER` epoch milliseconds, UTC.
- **`deleted_at`**: nullable `INTEGER` epoch ms. **Never hard-delete a row** — a
  hard delete cannot replicate, so a tombstone is the only durable way to say
  "gone".
- The DB is `snake_case`; repositories map to camelCase at the boundary.
- **Value constraints (enums, partial-date rules) live in Zod, not the DB**, so the
  same portable SQL runs on both engines.

## Custody vocabulary

Three **independent** questions get asked about a running client. They are answered by
three different lookups, and they have three separate vocabularies **on purpose** — an
earlier single word ("Open") collided with the verb *open*, with an open reminder, and
with the encryption state, and made a good default sound like a vulnerability.

| Question | Vocabulary | Answered by | Lives in |
|---|---|---|---|
| Does an account exist on this device? | **Unauthenticated / Authenticated** | the roster on disk | `@leapsake/store-layout` |
| Is the file on disk encrypted? | **plaintext / encrypted** | the roster, today | `resolveActiveStore`'s `custody` discriminant |
| Can this device read its data right now? | **Locked / unlocked** | the OS keychain (is the db-key there?) | `@leapsake/key-custody` |

**Do not collapse them**, even though two currently always agree:

- **Authenticated ⇒ encrypted is true today, and is a consequence, not a definition.**
  `plans/v0-2.md` anticipates a user opting out of encryption while holding an account
  (*user-toggleable encryption beyond custody*). When that lands, the account axis is
  unchanged and only the file axis moves. Code that asks "how do I open this file?" must
  read the file axis, never infer it from the account.
- **Locked is a sub-state of Authenticated, never a peer.** Sign out (`lockThisDevice`)
  deletes exactly two keychain secrets and touches nothing else — the roster entry, the
  account row, the encrypted file and both sidecars all survive. A signed-out device is
  fully Authenticated and merely Locked. The reverse cannot happen: an Unauthenticated
  device has no keys to forget, so it can never be Locked.
- The **Degraded** state is Authenticated *and* unlocked *and* still broken (the device
  holds its db-key but cannot prove the account's master key). If the axes were one
  enum it would have nowhere to live.

**The ELI5 test** — *can you use the app right now without typing anything?*
Unauthenticated: yes, everything works, there is simply no lock on the door.
Locked: no, your data is right there and sealed.

**Internal names are not user-facing copy.** These words are for code and design docs.
The UI says whatever is clearest for a layperson — "Protect your data", "Set up your
login", "Sync across devices" — and `encryption/model.md` §7.2.1 licenses that
explicitly. Never surface "Unauthenticated" to a user.

The full design lives in `plans/encryption/model.md` §7; this section is the vocabulary
only, so it stays true as that plan evolves.

## SqliteDriver Port

Every repository is written against one small async interface
(`packages/data/src/driver.ts`) so it runs unchanged on
`better-sqlite3-multiple-ciphers` (desktop, `apps/desktop/src/main/db/encrypted-sqlite-driver.ts`)
and expo-sqlite/SQLCipher (mobile, `apps/mobile/db/expo-sqlite-driver.ts`). Both
adapters are pinned to identical observable behavior by one shared contract suite —
see *Testing*.

**Shared packages run on the Hermes floor.** `packages/*` execute on mobile's
Hermes engine, which lags on newer JS. Two consequences, both learned the hard way:
(1) avoid ES2023-only methods like `Array#toSorted` — use `[...arr].sort(...)`
(the `unicorn/no-array-sort` lint rule is disabled for this reason); (2) host
capabilities the shared code assumes (the `crypto.randomUUID` Web Standard) are
established at each app's entry, not wrapped in the shared code. Hermes ships *no*
global `crypto`, so `apps/mobile/index.ts` builds it from `expo-crypto` (native v4,
canonical lowercase — format-identical to Node/desktop and browser/web, so PKs are
platform-indistinguishable for sync). Keep new shared code to features Hermes
supports. Note: adding/removing a native module needs a Metro `--clear` restart.

## Application Surface (`packages/core`)

`createCore(driver)` wires every repository + service over one `SqliteDriver`
and returns a `CoreApi` — the client-agnostic application surface (transactional
writes, cascade deletes, relationship orientation, and view-model builders in
`core/views.ts`). It is free of any transport/UI concern. Desktop builds it in
the main process and forwards over IPC; mobile (V2) builds it in-process.

## IPC Design

- A single typed `api` surface on `window.api` via `contextBridge`.
- `ipcMain.handle` handlers validate inputs with Zod, then forward to one
  `CoreApi` method. They are a **thin bridge** — do **not** open a
  `driver.transaction` in a handler; `core` already owns atomicity.
- The preload's `Api` type **is** `CoreApi` (`export type Api = CoreApi`), and
  the runtime `api` object `satisfies CoreApi`, so the bridge can't drift from
  core. The renderer never imports SQLite — only `window.api`.

## Testing

Strategy, principles, and the driver-contract keystone live in
[`plans/testing/`](plans/testing/); this is the operational summary.

- **Unit**: schema validation + pure domain logic (role algebra, gender
  derivation, milestone precision, normalization) in `packages/schema`.
- **Integration**: every repository and cross-repo service against the **real
  production desktop engine** (`better-sqlite3-multiple-ciphers` via
  `makeEncryptedTestDriver`) — run migrations, then exercise CRUD, soft-delete,
  cascades, kinship, search, timeline.
- **Component**: `packages/ui`'s presentational components under
  `@testing-library/react`. Vitest runs `node` by default, so these files opt into
  a DOM with a `// @vitest-environment jsdom` docblock; they also need an explicit
  `afterEach(cleanup)`, since the suite runs without globals and Testing Library
  can't register its own. Assert what a user perceives (roles, text, the `name` a
  field submits under), not internals.
- **Driver contract**: one shared spec (`@leapsake/data/testing` →
  `runDriverContract`) pins every `SqliteDriver` impl to identical observable
  behavior; desktop runs it under Vitest, mobile via the in-app self-test.
- **Mobile native** (built, Android + iOS): `pnpm test:native` drives the in-app
  self-test on a booted Android emulator **and/or** iOS simulator via **Maestro** and
  asserts PASS from the CLI — the mobile driver leg is a terminal automated gate, not a
  manual screen read. The Maestro flow is byte-identical across platforms.
- **E2E** (blocked, not built): the crucial-flow catalog per platform — desktop
  Playwright/Electron, mobile **Maestro** (committed). See `plans/testing/`.

### Running them

`scripts/test-all.mjs` is the orchestrator and documents its own tier registry,
flags, and exit codes in its header — read that rather than a list here, and
`package.json` for what each `pnpm test:*` actually runs. In the inner loop:
**`pnpm test`** (fast: static + unit + integration + the coverage gate, no
emulator), **`pnpm test:all`** (everything reachable, with unreachable tiers
reported ⏳ BLOCKED rather than skipped), **`pnpm test:node`** (just Vitest).

> ⚠️ **`pnpm test` cannot complete in a sandboxed agent shell**, and the failure looks like
> a broken repo rather than a missing network. `test:node` and `test:coverage` both start
> with `scripts/ensure-sqlite-abi.mjs`, which shells out to `prebuild-install` — a network
> fetch. Sandboxed, it is **SIGKILLed mid-run**, which can *delete* the native binary on its
> way out. Both tiers then FAIL while the static tiers pass.
>
> Run the tiers that don't need the native module (`pnpm exec node scripts/test-all.mjs
> --only=format,lint,typecheck,versions`), and run Vitest **directly** — `pnpm exec vitest
> run` — after restoring the binary from the local prebuild cache (below). Never "fix"
> `ensure-sqlite-abi.mjs` to work around this: it is correct, and on a developer machine with
> network `pnpm test` runs the whole trophy as designed.

### The native SQLite ABI, and how it bites

The single native `.node` carries one ABI at a time. **Running the desktop app in any form —
`dev`, `build`, `check:bundle` — flips it to the Electron ABI**, and the next `vitest` run then
dies with dozens of *"Worker exited unexpectedly"* rather than an honest ABI error. A bare
`require()` still succeeds, so the failure is delayed and misleading.

Restore the Node build by extracting the cached prebuild — **not** with `prebuild-install
--force`, which can clear the cache before its own download is killed:

```sh
cd node_modules/better-sqlite3-multiple-ciphers
tar -xzf ~/.npm/_prebuilds/*better-sqlite3-multiple-ciphers-*-node-v137-darwin-arm64.tar.gz
```

**Which ABI is installed is a file-size check**, since both builds share a name and the
tarballs preserve mtimes: `2217120` bytes = Node, `2217808` = Electron. Check it before
trusting a green run — the binary has been observed flipped to Electron in sessions where the
dev app was never started. The whole dance disappears if the N-API fork ever releases; see
[`plans/v0-2.md`](plans/v0-2.md) → *The N-API exit*.

**tsconfig-include invariant**: a new test directory must sit under some project
tsconfig's `include`, or its type errors go unchecked (`pnpm test:types` only
sees included files). All current test dirs are covered; verify when adding one.

## Desktop app (`apps/desktop`)

Electron app built with electron-vite (`src/main`, `src/preload`,
`src/renderer`). The main process opens the encrypted store, runs migrations,
builds the `core`, and forwards it over typed IPC; the renderer is React +
react-router. See `apps/desktop/README.md` for the dev workflow.

> ⚠️ **The database is a native module, and the ABI matters.** At-rest encryption
> cost us the original `node:sqlite` choice: desktop runs
> `better-sqlite3-multiple-ciphers`, whose prebuilt binary is compiled per ABI and
> is loaded from **two** runtimes — Electron (the app) and Node (Vitest). Whichever
> ran last wins, so running the app flips the binary and the next `vitest` run dies
> with *"Worker exited unexpectedly"* rather than an ABI error.
> `scripts/ensure-sqlite-abi.mjs` papers over this before `dev`/`start`/`test`; which
> build is installed is a **file-size check**, since both share a name
> (`2217120` bytes = Node, `2217808` = Electron). The exit from the whole problem
> class is [`plans/v0-2.md`](plans/v0-2.md) → *The N-API exit* — a watch-item,
> blocked on the fork rebasing onto N-API.

## Mobile app (`apps/mobile`)

Expo app (V2). Builds the `core` in-process over an expo-sqlite driver; screens
are React Native + expo-router. Forms are ports of the desktop forms — keep them
behaviorally faithful (same fields, same validation), adapting only the input
controls to native idioms.

### Form input controls

React Native has no `<select>`/`<datalist>`, so each desktop control maps to one
of three native-feeling patterns. **Pick by the option list, mirroring how the
desktop form already chose `<select>` vs `<datalist>`:**

- **`SelectField`** (native `@react-native-picker/picker`) — for a *short,
  fully-known* enum the user can scan: milestone Kind/Month, Gender. This is the
  mobile `<select>`. iOS shows a value row that opens the wheel in a Done-
  dismissable bottom sheet; Android renders the inline native dropdown dialog.
- **`Typeahead`** (filter `TextInput` + pressable list; chosen value shows with a
  *Change*, and optional *Clear*, affordance) — for a *long or possibly-unfamiliar*
  list: relationship Role (~40 once gendered variants are included), Country (183),
  the relationship-candidate name picker. This is the mobile `<datalist>`. It is
  autocomplete-style: nothing lists until `minChars` are typed (default 2,
  matching the search tab's floor) rather than dumping the full list. The shared
  generic component is `components/Typeahead.tsx`; `CountryField` and
  `RelationshipForm` are the callers — map your value to/from an option via
  `getKey`/`getLabel`, and give the element a React `key` to reset its live query
  when a parent selection moves (e.g. Role after the Name changes).
- **Free text + suggestions** (a plain `TextInput` with a pressable suggestion
  list under it, same 2-char floor) — for a desktop `<datalist>` whose input is
  *free text with shortcuts*, where a brand-new value is the normal case: the
  gift-capture title field (`components/GiftCaptureForm.tsx`). A `Typeahead`
  would be wrong here — it collapses to a "chosen option" row, which a new title
  can never be.
- **Pills / segmented control** — reserved for a genuinely small, glanceable,
  mutually-exclusive choice. **Not currently used** (the old `OptionPills` was
  retired because it scaled badly past ~4 options); reintroduce only if a true
  segmented-control case appears.

Prefer native elements over novel custom UI for these common cases.

## User-visible text

Leapsake will be localized. Two rules follow, and they apply to new UI code now
rather than at translation time, because they are far cheaper to keep than to
retrofit:

1. **No component contains a user-visible string.** In `packages/ui`, primitives
   take text as props and everything above them reads the catalog
   (`@leapsake/ui/messages`). Elsewhere, keep strings at the top of a module
   rather than inline, so the later sweep is mechanical.
2. **Never build a sentence out of fragments.** No `` `${name} (hidden)` ``, no
   `" · with " + label`, no `parts.join(", ")`, no `count === 1 ? … : …` in a
   component. A message that takes values is a **function** the catalog owns, so
   plural rules, word order and list separators belong to the language rather
   than to render code.

Dates and numbers already go through `toLocaleDateString`/`toLocaleString`; keep
it that way. Still English and not yet covered: `@leapsake/schema`'s label tables
(`genderLabel`, `kindDefs`, the role labels), which both clients read, and the
`apps/desktop` screens not yet moved into `packages/ui`.

## React version policy (monorepo)

**Each app owns its React version; we do not lock React across the workspace.**
Mobile's React is hard-pinned by its Expo SDK (exact `react@19.2.x`); desktop is
free to track a newer `react`/`react-dom` on its own schedule. This is safe
because the apps are separate bundles/processes that share **no** React-consuming
runtime code (mobile uses `expo-router`, desktop uses `react-router-dom`), so
there is no cross-app React instance to keep aligned.

React's "single copy" rule is **per-bundle, not per-monorepo**: within one app,
everything that calls hooks — app code, `react-router-dom`, any component lib —
must import the *same physical* React, because the hook dispatcher is a
module-level singleton. Two instances in one bundle produce "Invalid hook call" /
`useContext` is null crashes.

We enforce that **at the bundler**, not with a workspace-wide version lock:
`apps/desktop/electron.vite.config.ts` sets `renderer.resolve.dedupe:
["react", "react-dom"]`, collapsing every React import in the desktop bundle
(including transitive ones) to desktop's own copy. Desktop also pins `react` and
`react-dom` to the **same exact** version (React requires the pair to match).

**The rule that triggers a dedupe:** the workspace uses `nodeLinker: hoisted`
(see `pnpm-workspace.yaml`), so pnpm hoists exactly one React version to the root
`node_modules`. An app that runs that *same* version needs nothing — its whole
tree shares the hoisted copy. An app that runs a **different** version than the
hoisted root forces a second, nested copy that a React library (e.g.
`react-router-dom`) can latch onto — so **that** app must dedupe at its bundler.

- **Desktop** runs a newer React than the hoisted root, so it dedupes (above).
- **Mobile** *is* the hoisted root version (Expo hard-pins `react@19.2.x` and the
  entire mobile tree agrees on it), so there is no second copy and Metro needs no
  equivalent today. If mobile ever diverges its React version, add the Metro
  equivalent (force `react`/`react-dom` to one path via
  `config.resolver.resolveRequest` or `extraNodeModules` in `metro.config.js`).
- **Do not** add a global `pnpm.overrides` forcing one `react`/`react-dom`
  version across the repo — that recouples desktop to Expo's pinned version,
  which is the opposite of what we want.
- **A shared UI package declares React as a `peerDependency`, never a
  dependency** (`packages/ui`). A direct dep would put a second physical React in
  desktop's bundle — the exact failure the dedupe exists to prevent.
- **The workspace root pins a matching `react`/`react-dom` pair** (mobile's
  version) purely so the component tests render against one. Before that, root
  hoisting produced a *mismatched* pair — mobile's `react` beside desktop's
  `react-dom`, the only `react-dom` consumer — which renders nothing and reports
  a bogus `act(…)` warning, because React 19's `act` queue lives in `react` while
  the work lives in `react-dom`. Root is pinned to mobile's version deliberately:
  moving it would push mobile off the hoisted copy and into the nested case Metro
  currently doesn't have to handle. Desktop keeps its own newer pair, nested.

**Regression guard:** `pnpm --filter @leapsake/desktop check:bundle` builds the
renderer and asserts the bundle contains exactly one `react` and one `react-dom`
(it inspects the sourcemap's source list — the only faithful signal, since
on-disk/Node resolution legitimately sees two copies that the bundler dedupes).
It fails loudly if the dedupe is dropped or the React pair drifts. Run it in CI
when CI lands; until then run it after touching React deps or the renderer
bundler config.
