# AGENTS.md

## Project Overview

Leapsake is a privacy-first people management app. Data lives locally in SQLite;
no cloud dependency in V1. The architecture is designed to grow incrementally:
desktop (V1) → mobile (V2) → sync + web (V3).

## Guiding Principles

- **Incremental delivery** — each phase is usable and shippable on its own.
- **Lean scope** — no speculative features, no premature abstractions.
- **TypeScript everywhere** — no Rust or other application languages.
- **Offline-first** — SQLite is the primary data store.
- **Dependencies are a budget** — add a dependency only when it pays for itself
  across more than one place.

## Tech Stack

| Concern | Choice |
|---|---|
| Package manager | pnpm + pnpm workspaces |
| Languages | TypeScript, React, CSS Modules |
| Desktop shell | Electron via electron-vite |
| Database | `node:sqlite` (`DatabaseSync`, Node built-in) in the Electron main process |
| Renderer routing | react-router (`react-router-dom`) |
| Renderer ↔ main | Typed IPC over `contextBridge` (`window.api`) |
| Validation | Zod — schemas → inferred types, at every trust boundary |
| IDs | `crypto.randomUUID()` — no dependency |
| Lint | oxlint |
| Format | oxfmt (fall back to Prettier if needed) |
| Test | Vitest |

## Repository Structure

```
apps/
  desktop/          # Electron app (V1)
  mobile/           # Expo app (V2 — not yet created)
  web/              # Web app (V3 — not yet created)
  server/           # Server (V3 — not yet created)
packages/
  schema/           # Zod schemas → inferred types + pure portable domain logic
                    # (formatters, role algebra, normalization). Zero platform deps.
  data/             # SqliteDriver port, migration runner, per-entity repositories,
                    # cross-repo services (kinship, search, timeline).
                    # Depends on schema. No DB driver import.
  core/             # Client-agnostic application surface (CoreApi): transactional
                    # writes, cascade deletes, relationship orientation, view-models.
                    # Depends on data + schema.
  highlight/        # Search-match highlighting.
AGENTS.md
plans/
  reboot-plan.md    # Architecture and delivery plan
```

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

- **Unit**: schema validation + pure domain logic (role algebra, gender
  derivation, milestone precision, normalization) in `packages/schema`.
- **Integration**: every repository and cross-repo service against a real
  `node:sqlite` `:memory:` database — run migrations, then exercise CRUD,
  soft-delete, cascades, kinship, search, timeline. (~234 tests, green.)
- **E2E** (deferred): Playwright + Electron, once UI surface justifies it.

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

## Dependency Budget (V1)

Runtime: `electron`, `react`, `react-dom`, `react-router-dom`, `zod`.
(`node:sqlite` is a Node built-in — zero dependency.)
Dev: `electron-vite`, `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`,
`oxlint`, `oxfmt`.

Anything beyond this list needs a clear reason.
