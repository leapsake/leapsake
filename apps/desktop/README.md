# @leapsake/desktop

The Leapsake desktop app (Electron + React, built with electron-vite). The main
process opens `node:sqlite`, runs migrations, builds the `@leapsake/core`
application surface, and forwards it over a typed IPC surface; the renderer is a
React + react-router UI that talks only to `window.api`.

## Layout

```
src/
  main/
    index.ts                 # app lifecycle, window, DB init, core wiring, IPC handlers
    db/node-sqlite-driver.ts # production SqliteDriver over node:sqlite (mirrors the test adapter)
  preload/
    index.ts                 # contextBridge → window.api; `Api` type is CoreApi
  renderer/
    index.html
    src/
      main.tsx               # React root
      router.tsx             # react-router routes
      App.tsx                # app shell
      screens/ components/   # per-entity views, create/edit/delete, search
      env.d.ts               # augments Window with `api: Api`
```

Data lives in a single SQLite file at Electron's `userData` path
(`leapsake.db`), e.g. `~/Library/Application Support/@leapsake/desktop/` on macOS.

## Running

From the repo root (Node 24 required):

```sh
pnpm --filter @leapsake/desktop dev     # dev server + HMR
pnpm --filter @leapsake/desktop build   # production bundle into out/
pnpm --filter @leapsake/desktop start   # preview the built app
```

## Database: `node:sqlite` (no native-module dance)

The database is Node's built-in `node:sqlite` (`DatabaseSync`), not a native
addon. It ships inside the Node runtime that both Vitest and Electron already
bundle, so there is **no compiled binary to rebuild**, no ABI mismatch between
`pnpm test` and the app, and no Electron version pin tied to a prebuilt binary.
`pnpm test` and `dev` just work after `pnpm install`.

The production driver (`src/main/db/node-sqlite-driver.ts`) implements the async
`SqliteDriver` port over `DatabaseSync` — wrapping its synchronous calls in
resolved promises and `transaction` in manual `BEGIN`/`COMMIT`/`ROLLBACK`. It
mirrors the test adapter in `packages/data/test`, so `packages/data` itself
stays driver-free and reusable on mobile with an expo-sqlite adapter.

## Notes

- In `dev`/`start` (unpackaged) Electron prints a Content-Security-Policy
  warning. It is dev-only and disappears once the app is packaged; no action
  needed for V1.
- The renderer never imports SQLite or Node — it only calls `window.api`, whose
  type is derived from the preload's exported `Api`.
