# Leapsake Reboot — Architecture & Delivery Plan

> **Status: Phase 0 + V1 complete and exceeded. Desktop app runs locally.**
> The shared layers (`packages/schema`, `packages/data`, `packages/core`,
> `packages/highlight`) and the Electron desktop app are built, tested, and green
> (234 tests across 19 files). V1 shipped a minimal People CRUD and then grew
> organically into a full local personal-CRM — people, pets, tags, a
> relationship graph with derived kinship, milestones, and contact methods — all
> on the sync-safe model. The client-agnostic `core` package was extracted to
> prepare for V2. **The next unit of work is the start of V2 (mobile): stand up
> `apps/mobile` with an expo-sqlite driver and prove `@leapsake/core` runs on it.
> See §11.** This document is the source of truth for the restart; it is **not**
> agent guidance (that lives in `AGENTS.md`).

## 1. Context

Leapsake is a personal project being restarted from scratch. The prior version
became overcomplicated early, largely due to an unfamiliar stack (Rust/Tauri).
The reboot optimizes for **incremental, shippable delivery**: every increment is
usable on its own and provides real end-user value.

## 2. Guiding principles

- **Incremental delivery** — each phase is usable and shippable on its own.
- **Lean scope** — no speculative features, no premature abstractions.
- **TypeScript everywhere** — no Rust or other application languages. (Build
  tools written in other languages, e.g. Vite/oxc, are fine — that's tooling,
  not our codebase.)
- **Offline-first** — SQLite is the primary data store wherever possible.
- **Dependencies are a budget** — a dependency may help, but it also bloats and
  adds risk. Prefer core Node / platform APIs; add a dependency only when it
  pays for itself across more than one place.

## 3. Tech stack (V1 — as built)

| Concern | Choice |
|---|---|
| Package manager | pnpm + pnpm workspaces |
| Runtime | **Node 24 LTS** (pinned via `.tool-versions`; `engines.node >= 24`) |
| Languages/formats | TypeScript, React, CSS Modules, HTML |
| Desktop shell | Electron via **electron-vite** (Vite for main + renderer) |
| Database | **`node:sqlite`** (`DatabaseSync`, Node built-in) in the Electron main process |
| Renderer routing | **react-router** (`react-router-dom`) in the renderer |
| Renderer ↔ main | Typed IPC over `contextBridge` (renderer never touches SQLite) |
| Validation | **Zod** (schemas → inferred types) at every trust boundary |
| IDs | `crypto.randomUUID()` (UUIDv4) — core Node, zero-dep |
| Lint | **oxlint** |
| Format | **oxfmt** (Prettier-compatible beta; fall back to Prettier via `--migrate` if needed) |
| Test | **Vitest** |
| Mobile (V2) | Expo / React Native + expo-sqlite |
| Web (V3) | Server-rendered + progressive enhancement; framework TBD |
| Server (V3) | TBD |

> **Note — database choice changed during V1.** The plan originally specified
> **better-sqlite3** (a native module). It was replaced with Node's built-in
> **`node:sqlite`** (`DatabaseSync`), which deletes a native dependency *and* the
> entire native-module ABI problem: `node:sqlite` ships inside the Node runtime
> that both Vitest and Electron already bundle, so there is no rebuild dance and
> no Electron version pin tied to a prebuilt binary. It remains plain SQLite, so
> the portable-SQL and expo-sqlite story (§4.4, §4.5) is unchanged. The
> `SqliteDriver` port made this a one-adapter swap.

## 4. Key architecture decisions

### 4.1 Domain naming: People, not Contacts
The core entity is **`Person`** (table `people`). A "contact" is an abstraction
*over* a person; this app may also manage people records who aren't contacts.
Use `Person` / `people` / `peopleRepo` consistently. The graph also includes
**`Pet`** as a first-class entity alongside Person.

### 4.2 Sync-safe data model from day one
Even though V1 doesn't sync, V3 does, and sync is brutally sensitive to schema
decisions made now. Reversing them later means migrating every row. So, on
**every** table from the start:

- **Primary key**: client-generated UUID (`crypto.randomUUID()`), stored as
  `TEXT`. Two offline devices never collide.
- **`created_at`, `updated_at`**: `INTEGER` epoch milliseconds, UTC
  (`Date.now()`). Trivial to generate and compare; carries ordering for sync.
- **`deleted_at`**: nullable `INTEGER` epoch ms. **Soft delete** — never hard-
  delete, so deletions can propagate during sync.

The user never sees any of this; the app looks identical. It's cheap insurance.
In practice this paid off immediately: "one active row per key" uniqueness is
enforced with **partial unique indexes scoped to `deleted_at IS NULL`**, so
soft-deleted history coexists with live data (tags, taggings, contact methods).

### 4.3 Zod as the single source of truth
Zod schemas live in `packages/schema`; TypeScript types are **inferred** from
them. The same schema validates at three boundaries over the project's life:
IPC (renderer→main), sync payloads (V3), and the server (V3). One dependency
that replaces hand-written guards in multiple places — it earns its keep. The
schema package now also owns the **domain logic that is pure and portable**:
name/label formatters, gender derivation, relationship-role algebra
(`inverseRole`, `genderedVariant`, `composeRoles`, …), milestone date precision,
contact-method normalization, and search folding. Every client formats and
reasons about the domain identically because it shares these.

### 4.4 Shared data layer with a driver port
The repositories live in shared packages, **not** in `apps/desktop`, so mobile
can reuse them. The catch: **`node:sqlite` (desktop) is synchronous, expo-sqlite
(mobile) is asynchronous.** To reconcile them, every repository is written
against a small **async** `SqliteDriver` port:

```ts
interface SqliteDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
```

- **Desktop** supplies a `node:sqlite` adapter that wraps its synchronous calls
  in resolved promises (`apps/desktop/src/main/db/node-sqlite-driver.ts`).
- **Mobile (V2)** will supply an expo-sqlite adapter natively.
- IPC is already promise-based (`ipcRenderer.invoke`), so the renderer is async
  end-to-end with no friction.

This is the one abstraction that is **not** speculative — mobile is on the
roadmap, and this is the seam that makes V2 a port rather than a rewrite. The
`core` package (§4.6) sits on top of this seam and is itself driver-agnostic.

### 4.5 Migrations, hand-rolled
SQLite offers nothing for schema evolution, and the schema *will* change — it
already has, ten times. A migration library is the kind of bloat we avoid.
Instead, a small runner in `packages/data` (`migrations.ts`):

- reads `PRAGMA user_version`,
- applies an ordered, forward-only array of `{ version, up(driver) }` steps,
  each inside a transaction,
- bumps `user_version`.

Portable SQL works across `node:sqlite` and expo-sqlite (both are SQLite). Value
constraints (enums, partial-date rules) live in **Zod, not the DB**, precisely so
the same SQL runs on both drivers.

### 4.6 The `core` package — a client-agnostic application surface
`packages/core` was extracted (it is **not** in the original plan) to hold the
application logic that is neither pure-domain (`schema`) nor raw persistence
(`data`), but must be **identical across clients**: transactional multi-repo
writes, cascade soft-deletes, relationship orientation (resolving raw `a`/`b`
endpoints to "the other end" with a label and role), the "imply my role from the
other end" rule, and read-and-compose **view-model builders** (`core/views.ts`).

`createCore(driver)` wires every repository and service over one `SqliteDriver`
and returns a `CoreApi`. Both clients consume it the same way:

- **Desktop** builds the core in the Electron main process and forwards each
  method over typed IPC. The preload's `Api` type **is** `CoreApi`, so the IPC
  bridge can never drift from core.
- **Mobile (V2)** will build the core in-process and call it directly.

This is the seam that makes V2 a UI port: the entire non-UI surface is already
client-agnostic and tested.

## 5. Repository structure

```
apps/
  desktop/          # Electron app (V1) — built
  mobile/           # Expo app (V2 — create when needed)
  web/              # Web app (V3 — create when needed)
  server/           # Server (V3 — create when needed)
packages/
  schema/           # Zod schemas → inferred types, plus pure portable domain
                    #   logic (formatters, role algebra, normalization). Zero
                    #   platform deps.
  data/             # SQLite DDL, migration runner, per-entity repositories,
                    #   cross-repo services (kinship, search, timeline), and the
                    #   SqliteDriver port. Depends on schema. No DB driver import.
  core/             # Client-agnostic application surface (CoreApi): transactional
                    #   writes, cascade deletes, relationship orientation, and
                    #   view-model builders. Depends on data + schema.
  highlight/        # Search-match highlighting (segments for result rendering).
pnpm-workspace.yaml
package.json
AGENTS.md           # agent guidance (always AGENTS.md, never CLAUDE.md)
docs/               # "how does this work" documentation
plans/
  reboot-plan.md    # this document
```

Conventions:
- `apps/` for runnable applications; `packages/` for shared code.
- App folder names: `desktop`, `mobile`, `web`, `server` (no `client-` prefix).
- No shared **UI** package yet — add only when mobile needs it. UI does not
  transfer between Electron/React, RN, and server-rendered web anyway.

## 6. Data model — as built (V1)

What began as a single `Person` table is now a small relational domain. Every
table follows the §4.2 sync-safe conventions (UUID PK, epoch-ms timestamps,
`deleted_at` soft delete). Ten migrations, forward-only:

| # | Migration | Tables / changes |
|---|---|---|
| 1 | People | `people` (id, first/last name, timestamps, soft delete) |
| 2 | Middle name | `people.middle_name` |
| 3 | Tags | `tags` + polymorphic `taggings(entity_type, entity_id)`; partial unique indexes |
| 4 | Relationships | `relationships` — one directed edge, both endpoints + roles, polymorphic `(type,id)` |
| 5 | Pets | `pets` (plug into existing taggings + relationships, no schema change there) |
| 6 | Gender | `people.gender`, `pets.gender` (nullable; constrained in Zod) |
| 7 | Dismissals | `relationship_dismissals` — suppress *derived* edges the user rejected |
| 8 | Milestones | `milestones` — dated life facts (partial year/month/day), polymorphic subject |
| 9 | Contact methods | `email_addresses`, `phone_numbers`, `postal_addresses` (three typed tables) |
| 10 | Contact-method tweaks | free-text labels (drop `label_note`), phone `sms_capable` |

`Person` schema today (`packages/schema/src/person.ts`):

```ts
const personSchema = z.object({
  id:         z.uuid(),
  firstName:  z.string().min(1),
  middleName: z.string().min(1).nullable(),  // null when absent
  lastName:   z.string().min(1),
  gender:     genderSchema.nullable(),        // null when unset
  createdAt:  z.number().int(),               // epoch ms, UTC
  updatedAt:  z.number().int(),
  deletedAt:  z.number().int().nullable(),
});
type Person = z.infer<typeof personSchema>;
```

Notable derived/cross-cutting behavior (lives in `data` services + `core`):

- **Kinship** (`kinship-service`) computes *derived* relationships and gender
  from explicit facts (e.g. infer a sibling, or a gender from a gendered role),
  with `relationship_dismissals` letting the user reject a derived edge without
  writing a competing fact.
- **Milestone timeline** merges an entity's own milestones with those of its
  explicit relationships, annotated with the partner's label.
- **Search** (`search-service` + `search-fold` + `@leapsake/highlight`) folds
  text/phone/address for accent- and format-insensitive matching, including a
  birthday-query parser.

Repository surface per entity (async, against `SqliteDriver`): `create`,
`list`/`listForEntity`/`listForSubject` (all exclude soft-deleted), `get`,
`update`, `softDelete`, plus cascade `removeAllForEntity`/`removeAllForOwner`.

## 7. IPC design

- A single typed `api` surface exposed via `contextBridge` as `window.api`.
- `ipcMain.handle(channel, …)` handlers **validate inputs with the Zod schema**
  before forwarding to `core`. Handlers are a *thin* bridge: they parse the
  payload, coerce loose args, and call one `CoreApi` method. They must **not**
  open their own `driver.transaction` — `core` already owns atomicity.
- The preload's exported **`Api` type is `CoreApi`** (`export type Api = CoreApi`),
  and the runtime `api` object `satisfies CoreApi`. One source of truth: the IPC
  bridge, core, and renderer can never drift.
- The renderer never `require`s anything or sees SQLite — only typed `window.api`.

V1's real engineering is this boundary plus the data/`core` seam; the People CRUD
was just its first consumer, and the rest of the domain followed the same shape.

## 8. Testing strategy

Vitest, first-class from the start (currently **234 tests across 19 files**, green):

- **Unit** — schema validation and pure domain logic (role algebra, gender
  derivation, milestone date precision, normalization) in `packages/schema`.
- **Integration** — every repository and cross-repo service against a **real**
  `node:sqlite` `:memory:` database: run migrations, then exercise full CRUD,
  soft-delete, cascades, kinship derivation, search, and the timeline. This is
  the high-value equivalent of "a path through IPC→SQLite," at the data/`core`
  layer where the logic lives.
- **Deferred** — full Electron end-to-end (Playwright + Electron runtime) is
  heavier; add it once the UI surface justifies it.

## 9. Tooling notes

- **pnpm workspaces** only. Turborepo optional later, not now.
- **electron-vite** bundles both main and renderer.
- **oxlint** for linting; **oxfmt** for formatting (beta, Prettier-compatible;
  fall back to Prettier if it bites).
- `tsc --strict` is a real guardrail, run in CI alongside lint.

## 10. Dependency budget

Runtime: `electron`, `react`, `react-dom`, `react-router-dom`, `zod`.
(`node:sqlite` is a Node built-in — **zero dependency**, replacing the originally
budgeted `better-sqlite3`. `@electron/rebuild` is no longer needed.)

Dev: `electron-vite`, `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`,
`oxlint`, `oxfmt`.

Anything beyond this list needs a reason. Changes from the original budget:
**removed** `better-sqlite3` + `@types/better-sqlite3` + `@electron/rebuild`
(replaced by built-in `node:sqlite`); **added** `react-router-dom` (the renderer
grew from one screen to ~45 screens/components and needed routing).

## 11. Phased delivery

### ~~Phase 0 — Clean slate~~
~~Remove the Rust/Tauri reboot-irrelevant artifacts (`Cargo.*`, `target/`, old
`apps/*`) and stand up the bare pnpm-workspace skeleton + `packages/schema`,
`packages/data`.~~ **Done.**

### V1 — Desktop skeleton + People CRUD
**Status: complete — runs locally.** (Then exceeded; see V1.5.)

**Data foundation:**
- ✅ `packages/schema` — `personSchema` + create/update input schemas, types
  inferred (Zod 4, `z.uuid()`).
- ✅ `packages/data` — async `SqliteDriver` port, hand-rolled migration runner,
  People repository with snake_case⇄camelCase mapping and soft-deletes excluded
  from reads. No runtime DB-driver import.
- ✅ Vitest green — schema unit tests + repository integration test against a
  **real** in-memory SQLite database.

**Desktop app (`apps/desktop`):**
- ✅ electron-vite scaffold (`src/main` + `src/preload` + `src/renderer`),
  workspace TS packages bundled.
- ✅ Typed `window.api` IPC with Zod validation at the boundary.
- ✅ People CRUD React UI; production SQLite driver against an on-disk DB at the
  `userData` path.
- ✅ `pnpm --filter @leapsake/desktop dev` runs the app; oxlint + oxfmt +
  `tsc --strict` clean; Node pinned to 24 LTS.

**Ship bar:** **runs locally** (no signing/notarization/auto-update yet). ✅

### V1.5 — Local personal-CRM (built; not originally planned)
V1's People CRUD grew, increment by increment, into a full local relationship
manager. All of the following are **built, tested, and green** in the desktop app:

- ✅ **Pets** as a first-class entity alongside People.
- ✅ **Tags** with a polymorphic tagging join (any entity, one schema).
- ✅ **Relationship graph** — explicit directed edges with role algebra, plus
  **derived kinship** (inferred relationships/gender) and user **dismissals** of
  derived edges.
- ✅ **Milestones** — partial-precision dated life facts and a merged timeline.
- ✅ **Contact methods** — typed email / phone / postal with normalization,
  free-text labels, and SMS-capable flag.
- ✅ **Search** — accent/format-insensitive folding, highlighting
  (`@leapsake/highlight`), and a birthday-query parser.
- ✅ **`node:sqlite` migration** — dropped better-sqlite3 and the native-module
  ABI dance (§3 note).
- ✅ **`packages/core` extraction** — client-agnostic `CoreApi`, with the desktop
  preload deriving `Api` from `CoreApi` so IPC can't drift. *This was done
  expressly to make V2 a port.*

### ▶▶ NEXT UNIT OF WORK — V2 step 1: prove the data layer on mobile
**The single most valuable next increment.** Don't port the UI first; de-risk the
seam, exactly as V1's real work was the data/IPC boundary rather than the CRUD.

1. **Scaffold `apps/mobile`** — an Expo / React Native app in the pnpm workspace,
   depending on `@leapsake/schema`, `@leapsake/data`, and `@leapsake/core`
   (unchanged).
2. **Write the expo-sqlite `SqliteDriver` adapter** — the mobile counterpart to
   `node-sqlite-driver.ts`. expo-sqlite is already async, so this should be a
   thin, natural implementation of the port; the only real design point is
   `transaction` semantics.
3. **Build the core in-process and run migrations** against an on-device SQLite
   file, then call a `CoreApi` method (e.g. create a Person, list people) from a
   throwaway screen to **prove the whole stack works on device/simulator**.
4. **Confirm `packages/schema`/`data`/`core` need zero changes** — if any change
   is required to run on RN/Hermes, that's the finding to capture here.

**Done when:** the mobile app boots, runs migrations on expo-sqlite, and performs
one real `CoreApi` round-trip on a simulator. The native UI build is the *next*
unit after this, not part of it.

### V2 — Mobile (Expo / React Native), remainder
- Rebuild the People/Pets/relationships/milestones/contacts UI **natively**
  (the data layer and view-models are shared; only the UI is new).
- Reuse `packages/schema`, `packages/data`, `packages/core` unchanged via the
  expo-sqlite adapter from the step above.

### V3 — Sync + true distribution + Web
- Design sync between desktop and mobile (the V1 UUIDs / timestamps / soft
  deletes / `deleted_at`-scoped indexes pay off here).
- **Distribution graduates here**: code signing, macOS notarization, and an
  auto-update mechanism — shipped alongside sync, since "truly distributable" is
  only meaningful once there's something to sync.
- Add the web app; choose its framework then (Remix / Next.js / React Router
  candidates). Server-rendered, progressive enhancement, no client JS required
  for core functionality.

## 12. Open questions / deferred decisions

- Web framework — decided at V3.
- Server architecture and sync protocol (CRDT vs. last-write-wins vs. log-based)
  — designed at V3; the V1 schema is intentionally compatible with all three.
- `WITHOUT ROWID` for the TEXT-PK tables — minor optimization, evaluate later.
- Electron e2e testing (Playwright) — add when UI surface justifies it.
- expo-sqlite `transaction` semantics — settle when writing the V2 adapter.
