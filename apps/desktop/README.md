# @leapsake/desktop

The Leapsake desktop app (Electron + React, built with electron-vite). The main
process owns better-sqlite3, runs migrations, and exposes the People repository
over a typed IPC surface; the renderer is a minimal React People CRUD UI that
talks only to `window.api`.

## Layout

```
src/
  main/
    index.ts                    # app lifecycle, window, DB init, IPC handlers
    db/better-sqlite3-driver.ts # production SqliteDriver (mirrors the test adapter)
  preload/
    index.ts                    # contextBridge → window.api; exports the `Api` type
  renderer/
    index.html
    src/
      main.tsx                  # React root
      App.tsx                   # People CRUD UI (semantic HTML, minimal CSS)
      env.d.ts                  # augments Window with `api: Api`
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

## Native-module ABI workflow (read this)

better-sqlite3 is a native addon; its compiled binary targets **one** ABI at a
time — Node's (for the Vitest integration tests) or Electron's (for this app).
They can't coexist in the shared `node_modules`.

- After `pnpm install`, better-sqlite3 is built for **Node**, so `pnpm test`
  passes.
- `dev` and `start` run a `predev`/`prestart` hook that rebuilds it for
  **Electron** (`@electron/rebuild`). After running the app, `pnpm test` will
  fail to load better-sqlite3.
- To run the tests again, restore the Node build:

  ```sh
  pnpm --filter @leapsake/desktop run rebuild:node   # or: pnpm install
  ```

`rebuild:native` force-rebuilds for Electron if you ever need it explicitly.

**Electron is pinned to 41.x** because better-sqlite3 12.x publishes prebuilt
binaries only through Electron 41's ABI. Electron 42 has no prebuilt and fails to
compile against its newer V8 — bump Electron only when a matching better-sqlite3
prebuild exists.

## Notes

- In `dev`/`start` (unpackaged) Electron prints a Content-Security-Policy
  warning. It is dev-only and disappears once the app is packaged; no action
  needed for V1.
- The renderer never imports SQLite or Node — it only calls `window.api`, whose
  type is derived from the preload's exported `Api`.
