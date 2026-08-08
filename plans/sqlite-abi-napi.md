# The SQLite native-ABI dance, and the N-API exit from it

**Status: watch-item, blocked upstream.** Nothing to build. This doc exists so the exit
route is written down once and recognised the moment it becomes available, instead of
being re-derived.

## The problem we live with today

The desktop at-rest driver (`apps/desktop/src/main/db/encrypted-sqlite-driver.ts`) is a
**native module**: `better-sqlite3-multiple-ciphers`. Its prebuilt `.node` file is compiled
against a single `NODE_MODULE_VERSION`, and we load it from **two runtimes with different
ABIs** — Electron (the app) and Node (Vitest integration tests, which deliberately run
against the real production engine, `testing/strategy.md`).

One binary, two ABIs → whichever ran last wins, and the other fails with *"compiled against
a different Node.js version"*. `scripts/ensure-sqlite-abi.mjs` exists solely to paper over
this: before `dev`/`start`/`rebuild` and before `pnpm test` it re-extracts the correct
prebuild via `prebuild-install` (cached, no node-gyp compile).

The workaround has its own sharp edges:

- Interrupting the script mid-extract (SIGKILL) leaves **no** binary — recovery is a manual
  `tar` restore from `~/.npm/_prebuilds`.
- It is one more thing packaging must agree with ([`v0-1_05_desktop-packaging-and-signing.md`](./v0-1_05_desktop-packaging-and-signing.md):
  asar unpacking + the Electron ABI).

This is the cost we knowingly accepted when at-rest encryption overrode the
native-module-free `node:sqlite` preference ([`encryption/model.md`](./encryption/model.md) §8).

## The exit: better-sqlite3 v13 (N-API)

[better-sqlite3 v13.0.0](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)
(upstream, June 2026) rewrote the addon onto **Node-API** and dropped `prebuild-install` in
favour of publishing prebuilds directly. Node-API is **ABI-stable across runtime versions**:
one `.node` file loads under both Node and Electron regardless of `NODE_MODULE_VERSION`.

That deletes the entire problem class above — not mitigates it.

## Why we can't take it yet

We do not depend on upstream. We depend on the **encryption fork**, and it has not rebased:

| Package | Latest | N-API? |
|---|---|---|
| `better-sqlite3` | 13.0.1 | ✅ |
| **`better-sqlite3-multiple-ciphers`** (ours, `apps/desktop/package.json`) | **12.11.1** (2026-06-18) | ❌ |

The fork still ships per-ABI prebuilds (Electron 121/123/…/135 × platform) and has no v13
branch. Switching to upstream is **not** an option — the fork *is* SQLite3-Multiple-Ciphers,
i.e. the `PRAGMA cipher`/`PRAGMA key` support the whole at-rest design rests on.

The fork historically tracks upstream releases, so this is "watch, then take", not a fork or
a patch.

## When it lands — the whole migration

1. Bump `better-sqlite3-multiple-ciphers` to `^13` in `apps/desktop/package.json`.
2. Delete `scripts/ensure-sqlite-abi.mjs`.
3. Strip the `node ../../scripts/ensure-sqlite-abi.mjs electron &&` prefix from the desktop
   `dev` / `start` / `rebuild` scripts, and the `node` variant from `pnpm test`.
4. Re-check the packaging story in [`v0-1_05_desktop-packaging-and-signing.md`](./v0-1_05_desktop-packaging-and-signing.md) — one ABI-agnostic
   binary should *simplify* asar unpacking, not complicate it.
5. Verify the cipher pragmas are unchanged (`applyDatabaseKey`) and the driver contract
   suite passes on both runtimes without any rebuild step.

**Verification that it actually worked:** run `pnpm test` and the desktop app
back-to-back, in either order, with no rebuild in between. Today that is exactly what fails.

## Non-scope: mobile

React Native / Expo is **unaffected either way**. `apps/mobile` uses `expo-sqlite`
(SQLCipher path), a native iOS/Android module compiled by RN's own toolchain — it has no
`NODE_MODULE_VERSION` and never shared a binary with desktop. Mobile ABI friction, when it
happens, is Expo SDK / RN version alignment and has nothing to do with this.
