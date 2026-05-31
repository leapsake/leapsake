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
| Database | better-sqlite3 in the Electron main process |
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
  schema/           # Zod schemas → inferred TypeScript types. Zero platform deps.
  data/             # SqliteDriver port, migration runner, People repository.
                    # Depends on schema. No DB driver import.
AGENTS.md
plans/
  reboot-plan.md    # Architecture and delivery plan
```

## Data Model

### Person

```ts
// packages/schema/src/person.ts
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

DB uses `snake_case`; the repository maps to camelCase in TypeScript.
Never hard-delete rows — use `deleted_at` (soft delete).

### Sync-safe conventions (all tables)

- **Primary key**: client-generated UUID, stored as `TEXT`.
- **`created_at`, `updated_at`**: `INTEGER` epoch milliseconds UTC.
- **`deleted_at`**: nullable `INTEGER` epoch ms.

## SqliteDriver Port

The People repository is written against a small async interface so it can run
on better-sqlite3 (desktop) and expo-sqlite (mobile) without rewriting:

```ts
interface SqliteDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
```

Desktop supplies a better-sqlite3 adapter that wraps sync calls in resolved
promises. Mobile (V2) will supply an expo-sqlite adapter.

## IPC Design

- A single typed `api` surface on `window.api` via `contextBridge`.
- `ipcMain.handle` handlers validate inputs with Zod before touching the repo.
- Renderer types come from `packages/schema`; the renderer never imports SQLite.

## Testing

- **Unit**: schema validation (`personSchema` accept/reject cases).
- **Integration**: People repository against a real better-sqlite3 `:memory:`
  database — run migrations, then exercise full CRUD + soft-delete.
- **E2E** (deferred): Playwright + Electron, once UI surface justifies it.

## Desktop app (`apps/desktop`)

Electron app built with electron-vite (`src/main`, `src/preload`,
`src/renderer`). The main process opens better-sqlite3, runs migrations, and
exposes the People repo over typed IPC; the renderer is React. See
`apps/desktop/README.md` for the full dev workflow.

**Native-module ABI caveat (important):** better-sqlite3 is a native module and
its compiled binary targets exactly one ABI — Node's (for `pnpm test`) or
Electron's (for the app). They cannot coexist. So:

- Default / after `pnpm install`: built for **Node** → `pnpm test` passes.
- `pnpm --filter @leapsake/desktop dev` (and `start`) auto-rebuild for **Electron**
  via a `predev`/`prestart` hook — the app runs, but `pnpm test` will then fail
  to load better-sqlite3.
- To run tests again, restore the Node build:
  `pnpm --filter @leapsake/desktop run rebuild:node` (or re-run `pnpm install`).

Electron is pinned to **41.x**: better-sqlite3 12.x ships prebuilt binaries only
up to Electron 41's ABI; Electron 42 has no prebuilt and won't compile against
its newer V8. Bump Electron only when better-sqlite3 publishes a matching prebuild.

## Dependency Budget (V1)

Runtime: `electron`, `better-sqlite3`, `react`, `react-dom`, `zod`.  
Dev: `electron-vite`, `vite`, `@vitejs/plugin-react`, `@electron/rebuild`,
`typescript`, `vitest`, `oxlint`.

Anything beyond this list needs a clear reason.
