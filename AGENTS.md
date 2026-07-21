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
- Add a dependency only when it pays for itself across more than one place.
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


## Repository Structure

```
apps/
  desktop/          # Electron app (V1) — built
  mobile/           # Expo app (V2) — built, feature-complete vs. desktop
  server/           # Blind sync relay (V3) — built; see apps/server/README.md
  web/              # Web app (V3 — not yet created)
packages/
  schema/           # Zod schemas → inferred types + pure portable domain logic
                    # (formatters, role algebra, normalization). Zero platform deps.
  data/             # SqliteDriver port, migration runner, per-entity repositories,
                    # cross-repo services (kinship, search, timeline), and the sync
                    # substrate (defineSyncable, sync_state). Depends on schema.
                    # No DB driver import.
  sync/             # V3 client convergence: the SyncTransport port + in-memory and
                    # HTTPS relay adapters, the registry-driven SyncEngine, and the
                    # scheduler. Depends on data for types only.
  core/             # Client-agnostic application surface (CoreApi): transactional
                    # writes, cascade deletes, relationship orientation, view-models.
                    # Owns the syncable-repo allowlist and account bootstrap.
                    # Depends on data + sync + schema.
  bytes/            # Byte ↔ string codecs (base64/hex/utf-8) + deterministicUuid.
                    # Non-secret data only; no workspace deps. See its README.
  crypto/           # V3 envelope primitives (seal/wrap, the password KDF) + the
                    # KeyStore port. Depend on this only if you handle keys or
                    # ciphertext. See packages/crypto/README.md.
  highlight/        # Search-match highlighting.
AGENTS.md
plans/                # forward-looking only — upcoming work, not past decisions
  README.md           # project map / front door
  status.md           # the single status oracle (all workstreams) — what's done + what's next
  encryption/         # V3 encryption, privacy & sync design (unbuilt Stages 2–4)
```

Per-package architecture rationale (the "why this package is shaped this way") lives in each
package's own `README.md` — `packages/{schema,data,sync,core,crypto,bytes}`,
`apps/{desktop,server}`.

## Data Model

The domain has grown well past a single entity: **people, pets, tags, a
relationship graph with derived kinship + dismissals, milestones, and typed
contact methods** (email/phone/postal). Ten forward-only migrations live in
`packages/data/src/migrations.ts` — read them for the current shape. All tables
follow the sync-safe conventions below.

### Person

```ts
// packages/schema/src/person.ts
const personSchema = z.object({
  id:         z.uuid(),
  firstName:  z.string().min(1),
  middleName: z.string().min(1).nullable(),
  lastName:   z.string().min(1),
  gender:     genderSchema.nullable(),
  createdAt:  z.number().int(),   // epoch ms, UTC
  updatedAt:  z.number().int(),
  deletedAt:  z.number().int().nullable(),
});
type Person = z.infer<typeof personSchema>;
```

DB uses `snake_case`; the repository maps to camelCase in TypeScript.
Never hard-delete rows — use `deleted_at` (soft delete). Value constraints
(enums, partial-date rules) live in **Zod, not the DB**, so the same portable
SQL runs on `node:sqlite` and expo-sqlite.

### Sync-safe conventions (all tables)

- **Primary key**: client-generated UUID, stored as `TEXT`.
- **`created_at`, `updated_at`**: `INTEGER` epoch milliseconds UTC.
- **`deleted_at`**: nullable `INTEGER` epoch ms.

## SqliteDriver Port

Every repository is written against a small async interface so it can run on
`node:sqlite` (desktop) and expo-sqlite (mobile) without rewriting:

```ts
interface SqliteDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
```

Desktop supplies a `node:sqlite` adapter that wraps its synchronous calls in
resolved promises (`apps/desktop/src/main/db/node-sqlite-driver.ts`). Mobile
supplies an expo-sqlite adapter (`apps/mobile/db/expo-sqlite-driver.ts`).

**Shared packages run on the Hermes floor.** `packages/*` execute on mobile's
Hermes engine, which lags on newer JS. Two consequences proven in V2 step 1b:
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
- **Driver contract**: one shared spec (`@leapsake/data/testing` →
  `runDriverContract`) pins every `SqliteDriver` impl to identical observable
  behavior; desktop runs it under Vitest, mobile via the in-app self-test.
- **Mobile native** (built, Android + iOS): `pnpm test:native` drives the in-app
  self-test on a booted Android emulator **and/or** iOS simulator via **Maestro** and
  asserts PASS from the CLI — the mobile driver leg is a terminal automated gate, not a
  manual screen read. The Maestro flow is byte-identical across platforms.
- **E2E** (blocked, not built): the crucial-flow catalog per platform — desktop
  Playwright/Electron, mobile **Maestro** (committed). See `plans/testing/`.

### The test harness (`scripts/test-all.mjs`)

One orchestrator runs each trophy tier as a `pnpm test:*` script and prints a
combined verdict; **blocked** tiers — either not built yet (E2E) *or* a built
native tier whose device isn't booted here — are surfaced as ⏳, never silently
skipped. The two mobile native tiers run per platform (`native-android` /
`native-ios`, each `pnpm test:native --platform=<x>`); the orchestrator maps the
runner's exit code 0→PASS, 3→BLOCKED, else→FAIL.

- `pnpm test` — the fast local suite (static + unit + integration + coverage
  gate; no emulator). The default inner loop.
- `pnpm test:all` — everything reachable + reports the blocked native/E2E tiers.
- `pnpm test:node` — just Vitest (unit + integration), the tightest loop.
- `pnpm test:format` · `test:lint` · `test:types` — individual static tiers.
- `pnpm test:coverage` — the driver-contract coverage forcer (gates the desktop
  driver file at 100%, so a new driver path fails until a contract case covers it).
- `pnpm test:native` — the mobile driver-contract self-test on a booted device via Maestro
  (`scripts/test-native.mjs` → `apps/mobile/maestro/driver-selftest.yaml`). Auto-detects each
  booted platform (Android emulator + iOS simulator); `--platform=ios|android` runs one.
  Assumes a booted device + installed dev-client build + running Metro; it fails with the exact
  setup command if one is missing, or exits 3 (BLOCKED) if no device/toolchain is present (see
  `apps/mobile/maestro/README.md`). It is a `device` tier: `pnpm test` (fast loop) skips it;
  `pnpm test:all` runs it.
- `pnpm test:e2e` — reports BLOCKED until the crucial-flow catalog exists.

**tsconfig-include invariant**: a new test directory must sit under some project
tsconfig's `include`, or its type errors go unchecked (`pnpm test:types` only
sees included files). All current test dirs are covered; verify when adding one.

## Desktop app (`apps/desktop`)

Electron app built with electron-vite (`src/main`, `src/preload`,
`src/renderer`). The main process opens `node:sqlite`, runs migrations, builds
the `core`, and forwards it over typed IPC; the renderer is React + react-router.
See `apps/desktop/README.md` for the dev workflow.

> **No native-module ABI dance.** The database is Node's built-in `node:sqlite`,
> which ships inside the Node runtime that both Vitest and Electron bundle — so
> there is no rebuild step and no Electron version pin tied to a prebuilt binary
> (unlike the original better-sqlite3 plan). `pnpm test` and `dev` just work.

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
- **Pills / segmented control** — reserved for a genuinely small, glanceable,
  mutually-exclusive choice. **Not currently used** (the old `OptionPills` was
  retired because it scaled badly past ~4 options); reintroduce only if a true
  segmented-control case appears.

Prefer native elements over novel custom UI for these common cases.

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

**Regression guard:** `pnpm --filter @leapsake/desktop check:bundle` builds the
renderer and asserts the bundle contains exactly one `react` and one `react-dom`
(it inspects the sourcemap's source list — the only faithful signal, since
on-disk/Node resolution legitimately sees two copies that the bundler dedupes).
It fails loudly if the dedupe is dropped or the React pair drifts. Run it in CI
when CI lands; until then run it after touching React deps or the renderer
bundler config.

## Dependency Budget (V1)

Runtime: `electron`, `react`, `react-dom`, `react-router-dom`, `zod`.
(`node:sqlite` is a Node built-in — zero dependency.)
Dev: `electron-vite`, `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`,
`oxlint`, `oxfmt`.

Anything beyond this list needs a clear reason.
