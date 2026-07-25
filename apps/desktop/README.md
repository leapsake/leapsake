# @leapsake/desktop

The Leapsake desktop app (Electron + React, built with electron-vite). The main
process opens the encrypted SQLite database, runs migrations, builds the
`@leapsake/core` application surface, and forwards it over a typed IPC surface;
the renderer is a React + react-router UI that talks only to `window.api`.

## Layout

```
src/
  main/
    index.ts                 # app lifecycle, window, DB init, core wiring, IPC handlers
    db/
      encrypted-sqlite-driver.ts # production SqliteDriver over the encrypted engine
      database-key.ts            # whole-DB key custody in the OS enclave (KeyStore)
      plaintext-migration.ts     # one-time upgrade of a pre-Stage-2 plaintext DB
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

Data lives in a single **encrypted** SQLite file at Electron's `userData` path
(`leapsake.db`), e.g. `~/Library/Application Support/@leapsake/desktop/` on macOS.
The file is unreadable without the device's whole-DB key, held in the OS enclave.

## Running

From the repo root (Node 24 required):

```sh
pnpm --filter @leapsake/desktop dev     # dev server + HMR
pnpm --filter @leapsake/desktop build   # production bundle into out/
pnpm --filter @leapsake/desktop start   # preview the built app
```

## Database: encrypted SQLite (at-rest, Stage 2)

The database is **encrypted at rest** (`plans/encryption/model.md` §8): the file on
disk is ciphertext, decrypted into memory page-by-page only while the process holds
the whole-DB key. The backend is `better-sqlite3-multiple-ciphers`
(SQLite3-Multiple-Ciphers, SQLCipher-compatible), chosen over a WASM build because
it is the only maintained, batteries-included encrypted SQLite for Node/Electron,
ships **prebuilt binaries** for both Node and Electron (no node-gyp compile), and is
synchronous — a near drop-in for the previous `node:sqlite` driver.

This reintroduces a native addon (the cost `node:sqlite` had let us avoid — accepted
for at-rest encryption). Two consequences:

- **Electron ABI guard (automatic).** The single native `.node` carries one ABI at a
  time, and Vitest (Node) and the app (Electron) need _different_ ABIs — running one
  otherwise flips the binary out from under the other. `scripts/ensure-sqlite-abi.mjs`
  (repo root) re-extracts the matching prebuild (from `prebuild-install`'s cache — no
  compile) and is wired into the commands: `dev`/`start`/`rebuild` ensure the Electron
  ABI, `pnpm test` ensures the Node ABI. So the two are interchangeable with no manual
  step; the Electron version is auto-derived, so a bump needs no edit.
- The native module is externalized by `electron-vite` automatically (it is a real
  dependency, not a `@leapsake/*` workspace package), so its `.node` loads from
  `node_modules` at runtime.

The production driver (`src/main/db/encrypted-sqlite-driver.ts`) implements the async
`SqliteDriver` port over the engine — applying the key pragma at open time, wrapping
the synchronous calls in resolved promises, and `transaction` in manual
`BEGIN`/`COMMIT`/`ROLLBACK`. `packages/data` itself stays driver-free, so the
integration tests still run on `node:sqlite` `:memory:` and mobile keeps its
expo-sqlite adapter. The whole-DB key is minted/held in the OS enclave
(`database-key.ts`); a pre-Stage-2 plaintext file is re-keyed in place on first
launch (`plaintext-migration.ts`).

## Notes

- In `dev`/`start` (unpackaged) Electron prints a Content-Security-Policy
  warning. It is dev-only and disappears once the app is packaged; no action
  needed for V1.
- The renderer never imports SQLite or Node — it only calls `window.api`, whose
  type is derived from the preload's exported `Api`.
