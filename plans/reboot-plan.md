# Leapsake Reboot — Architecture & Delivery Plan

> **Status: Phase 0 complete. V1 in progress — the data foundation has shipped.**
> The shared data layer (`packages/schema` + `packages/data`) is built, fully
> tested, and green; the remaining V1 work is the Electron desktop app (shell,
> typed IPC, People CRUD UI). See §11 for the detailed checklist of done vs.
> remaining. This document is the source of truth for the restart; it is **not**
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

## 3. Tech stack (final for V1)

| Concern | Choice |
|---|---|
| Package manager | pnpm + pnpm workspaces |
| Runtime | **Node 24 LTS** (pinned via `.tool-versions`; `engines.node >= 24`) |
| Languages/formats | TypeScript, React, CSS Modules, HTML |
| Desktop shell | Electron via **electron-vite** (Vite for main + renderer) |
| Database | **better-sqlite3** in the Electron main process |
| Renderer ↔ main | Typed IPC over `contextBridge` (renderer never touches SQLite) |
| Validation | **Zod** (schemas → inferred types) at every trust boundary |
| IDs | `crypto.randomUUID()` (UUIDv4) — core Node, zero-dep |
| Lint | **oxlint** |
| Format | **oxfmt** (Prettier-compatible beta; fall back to Prettier via `--migrate` if needed) |
| Test | **Vitest** |
| Mobile (V2) | Expo / React Native |
| Web (V3) | Server-rendered + progressive enhancement; framework TBD |
| Server (V3) | TBD |

## 4. Key architecture decisions

### 4.1 Domain naming: People, not Contacts
The core entity is **`Person`** (table `people`). A "contact" is an abstraction
*over* a person; this app may also manage people records who aren't contacts.
Use `Person` / `people` / `peopleRepo` consistently.

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

### 4.3 Zod as the single source of truth
Zod schemas live in `packages/schema`; TypeScript types are **inferred** from
them. The same schema validates at three boundaries over the project's life:
IPC (renderer→main), sync payloads (V3), and the server (V3). One dependency
that replaces hand-written guards in multiple places — it earns its keep.

### 4.4 Shared data layer with a driver port
The People repository lives in a shared package, **not** in `apps/desktop`, so
mobile can reuse it. The catch: **better-sqlite3 is synchronous, expo-sqlite is
asynchronous.** To reconcile them, the repository is written against a small
**async** `SqliteDriver` port:

```ts
interface SqliteDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
```

- **Desktop** supplies a better-sqlite3 adapter that wraps its synchronous calls
  in resolved promises.
- **Mobile (V2)** supplies an expo-sqlite adapter natively.
- IPC is already promise-based (`ipcRenderer.invoke`), so the renderer is async
  end-to-end with no friction.

This is the one abstraction that is **not** speculative — mobile is on the
roadmap, and this is the seam that makes V2 a port rather than a rewrite.

### 4.5 Migrations, hand-rolled
better-sqlite3 offers nothing for schema evolution, and the schema *will* change
(a third field arrives in week two). A migration library is the kind of bloat we
avoid. Instead, a ~30–40 line runner in `packages/data`:

- reads `PRAGMA user_version`,
- applies an ordered array of `{ version, up(driver) }` steps in a transaction,
- bumps `user_version`.

Portable SQL works across better-sqlite3 and expo-sqlite (both are SQLite).

## 5. Repository structure

```
apps/
  desktop/          # Electron app (V1)
  mobile/           # Expo app (V2 — create when needed)
  web/              # Web app (V3 — create when needed)
  server/           # Server (V3 — create when needed)
packages/
  schema/           # Zod schemas → inferred types. Zero platform deps.
  data/             # SQLite DDL, migration runner, People repository,
                    #   SqliteDriver port. Depends on schema. No DB driver import.
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

## 6. Data model — `Person` (V1)

`packages/schema`:

```ts
const personSchema = z.object({
  id:        z.string().uuid(),
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  createdAt: z.number().int(),   // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});
type Person = z.infer<typeof personSchema>;
```

`people` table DDL (snake_case in DB, camelCase in TS; the repository maps):

```sql
CREATE TABLE people (
  id         TEXT    PRIMARY KEY,
  first_name TEXT    NOT NULL,
  last_name  TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
```

Repository surface (async, against `SqliteDriver`):
`create`, `list` (excludes soft-deleted), `get`, `update`, `softDelete`.

## 7. IPC design

- A single typed `api` surface exposed via `contextBridge` as `window.api`.
- `ipcMain.handle(channel, …)` handlers **validate inputs with the Zod schema**
  before touching the repository.
- Renderer types come from `packages/schema`; one source of truth, both sides.
- The renderer never `require`s anything or sees SQLite — only typed `window.api`.

V1's real engineering is this boundary plus the data seam; the People CRUD is
just its first consumer.

## 8. Testing strategy

Vitest, first-class from the start:

- **Unit** — schema validation (`personSchema` accept/reject cases).
- **Integration** — the People repository against a **real** better-sqlite3
  `:memory:` database: run migrations, then exercise full CRUD + soft-delete.
  This is the high-value equivalent of "a path through IPC→SQLite," at the data
  layer where the logic lives.
- **Deferred** — full Electron end-to-end (Playwright + Electron runtime) is
  heavier; add it once the UI surface justifies it.

## 9. Tooling notes

- **pnpm workspaces** only. Turborepo optional later, not now.
- **electron-vite** bundles both main and renderer.
- **oxlint** for linting; **oxfmt** for formatting (beta, Prettier-compatible;
  fall back to Prettier if it bites).
- `tsc --strict` is a real guardrail, run in CI alongside lint.

## 10. Dependency budget (V1)

Runtime: `electron`, `better-sqlite3`, `react`, `react-dom`, `zod`.
Dev: `electron-vite`, `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`,
`oxlint`, `oxfmt`.

That's the whole list. Anything beyond it needs a reason.

**Installed so far (foundation):** runtime `zod`; dev `vitest`, `oxlint`,
`oxfmt`, `typescript`, `@types/node`, plus `better-sqlite3` +
`@types/better-sqlite3` as **dev-only** deps of `packages/data` (used by its
integration test; the production driver wires better-sqlite3 in at the desktop
layer). `electron`, `react`, `react-dom`, `electron-vite`, `vite`,
`@vitejs/plugin-react`, and `@electron/rebuild` land with the desktop app.
`pnpm.onlyBuiltDependencies` allowlists better-sqlite3 so pnpm runs its
prebuilt-binary install script under Node 24.

## 11. Phased delivery

### ~~Phase 0 — Clean slate~~
~~Remove the Rust/Tauri reboot-irrelevant artifacts (`Cargo.*`, `target/`, old
`apps/*`) and stand up the bare pnpm-workspace skeleton + `packages/schema`,
`packages/data`.~~ **Done.**

### V1 — Desktop skeleton + People CRUD
**Status: in progress — data foundation complete, desktop app remaining.**

**Done so far (foundation):**
- ✅ `packages/schema` — `personSchema` plus `createPersonInput` /
  `updatePersonInput` schemas, types inferred (Zod 4, `z.uuid()`).
- ✅ `packages/data` — async `SqliteDriver` port, hand-rolled migration runner
  (migration 001 = `people`), and the People repository
  (`create` / `list` / `get` / `update` / `softDelete`) with snake_case⇄camelCase
  mapping and soft-deletes excluded from reads. No runtime DB-driver import.
- ✅ Vitest green — schema unit tests + repository integration test against a
  **real** better-sqlite3 `:memory:` database (19 tests).
- ✅ oxlint + oxfmt + `tsc --strict` clean; Node pinned to 24 LTS.

**Remaining (desktop app):**
- ⬜ `apps/desktop` via electron-vite (main + preload + renderer).
- ⬜ Typed `window.api` IPC with Zod validation at the boundary.
- ⬜ People CRUD React UI — create / edit / soft-delete two-field people.
- ⬜ Production better-sqlite3 driver wired into the main process against a real
  on-disk DB file (with `@electron/rebuild` for the native ABI).
- ⬜ `pnpm dev` runs the Electron app.

**Ship bar:** **runs locally** (no signing/notarization/auto-update yet).

### V2 — Mobile (Expo / React Native)
- Replicate the People app on mobile.
- Reuse `packages/schema` unchanged; provide an expo-sqlite adapter for the
  `SqliteDriver` port and reuse `packages/data`.
- UI is rebuilt natively; the data layer is shared.

### V3 — Sync + true distribution + Web
- Design sync between desktop and mobile (the V1 UUIDs / timestamps / soft
  deletes pay off here).
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
- `WITHOUT ROWID` for `people` (TEXT PK) — minor optimization, evaluate later.
- Electron e2e testing (Playwright) — add when UI surface justifies it.
