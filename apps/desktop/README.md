# @leapsake/desktop

The Leapsake desktop app (Electron + React, built with electron-vite). The main
process opens this device's store — encrypted or not, depending on custody — runs
migrations, builds the `@leapsake/core` application surface, and forwards it over a
typed IPC surface; the renderer is a React + react-router UI that talks only to
`window.api`.

## Layout

```
src/
  main/       # app lifecycle, window, boot, core wiring, IPC handlers (index.ts),
              # plus db/ — the driver, the boot path (open.ts), the store
              # conversion, and the account flows (create / adopt / forget / reset)
  preload/    # contextBridge → window.api; `Api` type *is* CoreApi
  renderer/   # React + react-router; talks only to window.api
```

**Where the data lives depends on custody.** A device with no account holds a
_plaintext_ store at `stores/local/leapsake.db` under Electron's `userData` path
(`~/Library/Application Support/@leapsake/desktop/` on macOS); once an account
exists the store is encrypted and lives at `stores/<accountId>/leapsake.db`, with
its two unlock doors beside it as sidecar files. The roster
(`accounts.json`) sits outside every store and is what the boot path reads to
decide which one is active — see [`@leapsake/store-layout`](../../packages/store-layout/README.md).

## Running

From the repo root (Node 24 required):

```sh
pnpm --filter @leapsake/desktop dev     # dev server + HMR
pnpm --filter @leapsake/desktop build   # production bundle into out/
pnpm --filter @leapsake/desktop start   # preview the built app
```

`dev` puts this device's userData at `~/Library/Application Support/@leapsake/desktop` — the
dev app, **not** the packaged `…/Leapsake`.

> ⚠️ Any of these flips the native SQLite binary to the Electron ABI, which breaks the next
> Vitest run in a misleading way. See [`../../AGENTS.md`](../../AGENTS.md) → *The native SQLite
> ABI, and how it bites*.

### More than one device at once

There is no single-instance lock, so extra instances are just extra profiles. From the repo
root, each distinct `--user-data-dir` is a separate "device":

```sh
ELECTRON_RENDERER_URL=http://localhost:5173 "$(node -p 'require("electron")')" \
  apps/desktop --user-data-dir=<fresh-dir>
```

Point them at a local relay to exercise sync — see
[`@leapsake/server`](../server/README.md) → *Running*.

### Driving the app without a harness

**Until the E2E tier exists this is the only way to prove a user-visible desktop change**, and
it is how every custody slice was verified. Add `--remote-debugging-port=9333` to the command
above, then talk CDP to the renderer: `curl -s localhost:9333/json` gives the page's
`webSocketDebuggerUrl`, and `Runtime.evaluate` over that socket runs anything in the
renderer — `window.api.*`, `window.sync.*`, `window.boot.*`, or DOM clicks. Node 22+ has a
built-in `WebSocket`, so the driver is ~40 lines and needs no dependency.

Pair it with **out-of-band assertions on the profile directory** — the store's first 16 bytes
(`SQLite format 3\0`, or not), `keystore.json`'s key list, `accounts.json`, the sidecars —
since custody's defining properties are invisible on screen.

Things that will otherwise cost you an hour each:

- React inputs need the native value setter **plus** an `input` event to register.
- `location.reload()` picks up an HMR'd renderer change without restarting the app.
- **`electron-vite dev` only HMRs the renderer.** A change under `packages/` needs the dev
  server restarted before an extra instance picks it up — check with `grep` against
  `out/main/index.js`.
- Deleting `keystore.json` between launches simulates keychain loss — but it takes this
  device's **master key** as well as its db-key, which the boot path repairs from whichever
  door you then unlock with. Such a profile exercises the *repair*, not merely the gate.
- Deleting **only** `device-id` and `enclave` from that file leaves the db-key alive, which is
  the one route to the *Degraded* state: no gate is raised, so nothing can repair it.
- A `pkill -9` of the Electron child can take `out/` with it and leave the dev server serving
  nothing. If a launch produces no output at all, restart the dev server.

## Database: SQLite with an encrypted backend

A store that belongs to an account is **encrypted at rest**
(`plans/encryption/model.md` §8): the file on disk is ciphertext, decrypted into
memory page-by-page only while the process holds the whole-DB key. The backend is `better-sqlite3-multiple-ciphers`
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
`BEGIN`/`COMMIT`/`ROLLBACK`. `packages/data` itself stays driver-free, so mobile
keeps its expo-sqlite adapter and the integration suites run **this** driver: they
build it through the production open path over a throwaway temp file
(`test/support/encrypted-test-driver.ts`), because the encrypted backend cannot key
an in-memory database.

**Whether the store is encrypted at all is a custody question, not a desktop one.** A
device with no account holds a plaintext store and no keys; creating, joining, or
recovering an account is what converts it and mints the db-key. The boot path is
`src/main/db/open.ts`, the conversion is `convert-store.ts`, and the model is
[`plans/encryption/model.md`](../../plans/encryption/model.md) §7.

## Backing up and restoring

**"How do I back up Leapsake?"** — copy the app's `userData` directory. That is the
whole answer, and it works in every custody state. On macOS:

```
~/Library/Application Support/Leapsake/          # packaged
~/Library/Application Support/@leapsake/desktop/ # dev
  accounts.json          # the roster — which accounts this device knows
  stores/local/leapsake.db          # Unauthenticated: plaintext
  stores/<accountId>/leapsake.db    # Authenticated: ciphertext
  stores/<accountId>/leapsake.db.password   # door 1: the account password
  stores/<accountId>/leapsake.db.recovery   # door 2: the 24-word phrase
  keystore.json          # this machine's keys — does NOT travel
```

**Quit the app before copying.** Copy any `-wal`/`-shm` files next to a store if
they are present; a store copied mid-write is the one way to get an unreadable
backup.

**`keystore.json` is deliberately worthless off the machine.** It is a map of
`id → base64(ciphertext)` sealed by Electron's `safeStorage`, which derives its key
from *this* OS account's keychain (`main/keystore/safe-storage-keystore.ts`). Copying
it to another machine restores nothing. That is not a gap — it is why the two
sidecar doors exist, and the restore path below goes through them.

**`accounts.json` is small and load-bearing.** It is the only file whose loss is
silent: the roster degrades to empty rather than throwing
([`@leapsake/store-layout`](../../packages/store-layout/README.md)), so a restore
missing it boots into a *fresh Unauthenticated store* with the real data sitting
unopened in `stores/<accountId>/`. Nothing is lost — the fix is to restore the file,
or hand-write it (`{"version":1,"accounts":[{"id":…,"username":…,"createdAt":…}]}`,
where `id` is the store's directory name) — but the app will not tell you that is
what happened.

### Restoring, per custody state

| State | What to copy | What happens on first boot |
|---|---|---|
| **Unauthenticated** (no account) | `stores/local/leapsake.db` | Opens straight into the data. No keys, no ceremony — there is nothing to unlock |
| **Authenticated, password door** | `accounts.json` + the whole `stores/<accountId>/` directory | The gate asks for the account password; it unwraps the db-key from `.password`, restores it to this machine's keychain, and re-adopts the master key |
| **Authenticated, phrase door** | same | Same gate, answered with the 24 words; `.recovery` yields the same db-key, and the phrase also restores this device's recovery key |
| **Either door, wrong secret** | — | Rejected with a per-door message and re-prompted, in a loop. Nothing is written and nothing is corrupted — a wrong answer costs an attempt, not the store |
| **Encrypted store, no sidecars** | — | Refused outright: *"the database is encrypted but this device's key is missing."* Correct, and unrecoverable — the db-key lives nowhere inside the store it opens |

The gate offers only the doors whose sidecars are present, so a backup that carries
one of them is a complete restore. Both are 100-odd opaque bytes; there is no reason
not to carry both.

The unlock is `openAppDatabase` (`main/db/open.ts`, case 3) and the repair that
follows it is `establishKeySession`
([`@leapsake/key-custody`](../../packages/key-custody/README.md)). A door unlock
means the keychain was lost, which took this device's *master* key with it, so the
boot path re-adopts the account's before anything reads it; if that fails the app
still opens, in the **Degraded** state, rather than refusing to start.

**A phrase unlock does not force a new password**, and does not need to: the password
door is an independent file and still opens. (Account-level recovery *does* demand
one — `sync:recover` unwraps the master key from the relay's escrow onto a device that
never had it. That is a different flow with a different threat model.)

### The limit, stated honestly

**An account protects access; a backup protects against losing the device.** They are
not substitutes:

- A backup does not need an account. The majority of v0.1 users are local-only —
  sync requires self-hosting a relay — and copying one plaintext file is their
  complete backup story.
- An account does not give you a backup. Sync replicates to a relay you run; it is
  not a restore point, and Forget account destroys the local store.
- What a backup cannot survive is losing **both** door secrets on an encrypted store.
  No amount of file copying helps: that is the design working as intended.

Exporting to a portable format (rather than copying files) is the vCard exporter in
[`plans/v0-2.md`](../../plans/v0-2.md).

## Notes

- In `dev`/`start` (unpackaged) Electron prints a Content-Security-Policy
  warning. It is dev-only and disappears once the app is packaged; no action
  needed for V1.
- The renderer never imports SQLite or Node — it only calls `window.api`, whose
  type is derived from the preload's exported `Api`.
