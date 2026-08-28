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
(`~/Library/Application Support/Leapsake Dev/` in dev on macOS, `…/Leapsake` packaged); once an account
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

`dev` and `start` are unpackaged, so they run as **Leapsake Dev** and put this device's
userData at `~/Library/Application Support/Leapsake Dev` — deliberately not the packaged
`…/Leapsake`. See *The app's name, and why it is a data boundary* below; it is a boundary
worth understanding before changing either name.

Both also run two `node_modules` chores first: the SQLite ABI flip below, and
`scripts/name-dev-bundle.mjs`, which puts that name on the dev Electron bundle. Both are
idempotent, and both re-apply themselves after an install wipes them.

> ⚠️ Any of these flips the native SQLite binary to the Electron ABI, which breaks the next
> Vitest run in a misleading way. See [`../../AGENTS.md`](../../AGENTS.md) → *The native SQLite
> ABI, and how it bites*.

## The app's face on macOS

The Dock icon and the name beside the Apple logo are both read from the **app bundle**, and
in dev the bundle is `node_modules/electron/dist/Electron.app` — someone else's icon, someone
else's name. Packaging will supply a real one (plans/v0-2.md); until it does, three small
pieces stand in, and they are in three different places because macOS reads them at three
different moments:

| Surface | Set by | Where |
| --- | --- | --- |
| Dock icon | `app.dock.setIcon(resources/icon-macos.png)` | `src/main/index.ts`, after `whenReady` |
| Menu-bar title | `CFBundleName` in the dev bundle's `Info.plist` | `scripts/name-dev-bundle.mjs`, run by `dev`/`start` |
| Menu wording (About…, Quit…) | `productName`, plus a dev suffix | `package.json`; `src/main/index.ts` |
| Window title | the renderer's own `<title>` | `src/renderer/index.html` |

The second row is the awkward one: AppKit takes the menu title from the bundle and nothing at
runtime can reach it, so `dev` stamps the downloaded bundle on its way past. That is safe here
and the script says why at length — the short version is that the bundle is ad-hoc
linker-signed with its `Info.plist` unsealed, and the copy is this repo's own.

`icon-macos.png` is a separate file from `icon.png` rather than a crop of it, because macOS
supplies no mask of its own and wants the rounded tile in the pixels; see
[`assets/icon/README.md`](../../assets/icon/README.md).

## The app's name, and why it is a data boundary

Every build is **Leapsake**; an unpackaged one is **Leapsake Dev**. That is one field and one
guarded line:

```jsonc
// package.json — read by Electron before any app code runs
"productName": "Leapsake"
```
```ts
// src/main/index.ts, at module scope
if (!app.isPackaged) app.setName(`${app.getName()} Dev`);
```

Alpha, beta, RC and stable are all packaged, so they are all plain "Leapsake" with nothing to
configure. `app.isPackaged` is the only distinction that matters here.

**`app.name` is not a label.** Electron derives three things from it, and only the first is
cosmetic:

1. the wording *inside* the macOS app menu — "About Leapsake Dev", "Quit …";
2. `app.getPath("userData")` — where this device's whole store lives;
3. on macOS, the **Keychain item safeStorage wraps keys with**: the service is
   `<app.name> Safe Storage`, so the name decides which key `keystore.json` is sealed under.

The third has no lever. `app.setPath` can put `userData` back where it was, which makes a late
rename *look* survivable while the enclave has quietly moved to a key that decrypts none of the
existing wraps. There is no equivalent API for the Keychain service.

What makes the dev rename safe is that it is not a *change* of name. It runs at module scope,
before anything has read `app.name`, and identically on every launch — so a dev device is only
ever "Leapsake Dev", with store, Keychain item and menu agreeing from its first launch.

**So the two names are a data boundary, not decoration.** `dev` ships breaking schema changes
without migrations (see the repo's pre-v0.1 stance); the separate name is what stops a dev
build opening the store an installed Leapsake is using.

### Renaming either one is a migration

Two things move with a name, and only one of them can be carried:

- **the store** — `mv "~/Library/Application Support/<old>" "~/Library/Application Support/<new>"`;
- **the wrapped keys**, which cannot move. The old Keychain item becomes unreachable, so an
  encrypted device comes back through its password or recovery-phrase door and re-wraps on the
  way in. A device with no account (plaintext store) just moves.

`keystore.json` does not travel between machines anyway — see *Backing up and restoring* — so
this is the same path a restore onto a new machine already takes.

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
~/Library/Application Support/Leapsake/     # packaged
~/Library/Application Support/Leapsake Dev/ # dev
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

## IPC: a thin bridge, not a layer

The renderer talks to one typed `api` surface on `window.api`, exposed via
`contextBridge`. `ipcMain.handle` handlers validate their inputs with Zod and forward to a
single `CoreApi` method — **that is all they do**. In particular, do not open a
`driver.transaction` in a handler: `@leapsake/core` already owns atomicity, and a second
transaction around one that exists is either a no-op or a deadlock waiting for a slow disk.

The bridge cannot drift from core, by construction: the preload's `Api` type **is**
`CoreApi` (`export type Api = CoreApi`) and the runtime `api` object `satisfies CoreApi`, so
a method added to core without a handler is a type error rather than a missing feature
discovered at runtime.

## React lives at this app's version, not the workspace's

**Each app owns its React version.** Mobile's is hard-pinned by its Expo SDK; desktop tracks
a newer `react`/`react-dom` pair on its own schedule. That is safe because the two apps are
separate bundles that share **no** React-consuming runtime code — mobile uses `expo-router`,
desktop `react-router-dom` — so there is no cross-app React instance to keep aligned.

React's "single copy" rule is **per-bundle, not per-monorepo**. Within one app, everything
that calls hooks must import the *same physical* React, because the hook dispatcher is a
module-level singleton; two instances in one bundle produce "Invalid hook call" and null
`useContext` crashes — a white screen, from a clean build.

We enforce that **at the bundler**. `electron.vite.config.ts` sets
`renderer.resolve.dedupe: ["react", "react-dom"]`, collapsing every React import in this
bundle (transitive ones included) to desktop's own copy. Desktop also pins `react` and
`react-dom` to the **same exact** version, which React requires of the pair.

**What decides whether an app needs that dedupe** is the workspace's `nodeLinker: hoisted`
(`pnpm-workspace.yaml`): pnpm hoists exactly one React to the root `node_modules`. An app on
that same version needs nothing. An app on a **different** version forces a second, nested
copy that a React library like `react-router-dom` can latch onto — so that app must dedupe.

- **Desktop** runs a newer React than the hoisted root, so it dedupes.
- **Mobile** *is* the hoisted root version, so no second copy exists and Metro needs no
  equivalent. If mobile ever diverges, add one (force `react`/`react-dom` to a single path
  via `resolver.resolveRequest` or `extraNodeModules` in `metro.config.js`).
- **Never** add a global `pnpm.overrides` forcing one React across the repo — that recouples
  desktop to Expo's pin, which is the opposite of the point.
- **A shared UI package declares React as a `peerDependency`, never a dependency**
  (`packages/ui`). A direct dep puts a second physical React in this bundle — the exact
  failure the dedupe prevents.
- **The workspace root pins a matching `react`/`react-dom` pair** (mobile's version) purely
  so `packages/ui`'s component tests render against one. Before that, hoisting produced a
  *mismatched* pair — mobile's `react` beside desktop's `react-dom`, its only consumer —
  which renders nothing and reports a bogus `act(…)` warning, because React 19's `act` queue
  lives in `react` while the work lives in `react-dom`. Root stays on mobile's version
  deliberately: moving it would push mobile off the hoisted copy into the nested case Metro
  does not currently have to handle.

**The guard is a test, not this document.** `pnpm test:bundle` (the `bundle` tier, in
`pnpm test`) builds the renderer and asserts the bundle contains exactly one `react` and one
`react-dom`, reading the sourcemap's source list — the only faithful signal, since on-disk
resolution legitimately sees two copies the bundler collapses.

## Notes

- In `dev`/`start` (unpackaged) Electron prints a Content-Security-Policy
  warning. It is dev-only and disappears once the app is packaged; no action
  needed for V1.
- The renderer never imports SQLite or Node — it only calls `window.api`, whose
  type is derived from the preload's exported `Api`.
