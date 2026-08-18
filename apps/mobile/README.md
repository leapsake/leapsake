# @leapsake/mobile

The Leapsake mobile app (Expo + React Native, expo-router). Unlike desktop there is no IPC
boundary: the app builds `@leapsake/core` **in-process** over an expo-sqlite driver, so the
same core surface backs both clients behind a swapped driver and key-store port.

## Layout

```
app/          # expo-router routes; (tabs)/index.tsx is Home (the reminders list)
              # Four tabs — Home, Search, New, Settings/Account. "New" never
              # navigates: it resolves to a create screen or opens a sheet.
              # Everything else (People & Pets, the holidays and gifts catalogs,
              # Data, Settings, add.tsx, every detail screen) is a root-stack
              # route that pushes full-screen over the tab bar.
components/   # AppHeader.tsx draws the header for *both* navigators, so iOS and
              # Android get one design; screens still just set `title`.
db/           # the expo-sqlite driver, store conversion, and the unlock doors
lib/          # core-context.tsx — the boot path, custody branches, and core wiring
test/         # the on-device self-tests (driver contract + custody)
maestro/      # the E2E flows; see maestro/README.md
```

**Where the data lives depends on custody.** A device with no account holds a _plaintext_
store; once an account exists it is encrypted at `stores/<accountId>/`, with the two unlock
doors in `doors.db` beside it. The full cross-repo map is in
[`@leapsake/key-custody`](../../packages/key-custody/README.md).

## Running

```sh
pnpm --filter @leapsake/mobile ios       # dev client, iOS simulator
pnpm --filter @leapsake/mobile android   # dev client, Android emulator
```

This is a **native SQLCipher build** — Expo Go cannot host it.

Against a local relay, the simulators reach the host differently:

| Platform         | Relay URL               |
| ---------------- | ----------------------- |
| iOS simulator    | `http://localhost:4000` |
| Android emulator | `http://10.0.2.2:4000`  |

Start the relay with `pnpm --filter @leapsake/server dev` — see
[`@leapsake/server`](../server/README.md) → _Running_.

## Why the driver test needs a device

**expo-sqlite's real engine cannot run in a headless Node/Vitest process.** It is a native
module: its graph resolves to `requireNativeModule('ExpoSQLite')`, which throws without an Expo
native runtime. That is structural, not a missing config — and it is why the mobile driver is
proven on an emulator instead of in the fast local suite.

Three substitutes were verified against expo-sqlite's shipped source and all fail. **Do not
re-litigate them:**

1. **The native path throws.** `build/index.js → SQLiteDatabase → ExpoSQLite.js →
requireNativeModule('ExpoSQLite')`. No native runtime in Node ⇒ throws at import.
2. **The Node branch is a no-op stub.** `ExpoSQLite.web.js`'s `typeof window === 'undefined'`
   branch loads `web/SQLiteModule.node`, whose own header calls it a _"dummy implementation for
   the server runtime."_ Every method no-ops, so the contract suite would pass while asserting
   nothing — the "fake it" trap in its purest form.
3. **The wa-sqlite WASM build is a different engine.** `web/SQLiteModule.ts` is real SQLite in
   WASM, but it is a _browser_ artifact (`new Worker`, SharedArrayBuffer/`Atomics`, needs
   `window`) and it is the **web** engine — not the iOS/Android native SQLCipher build that
   ships. A different engine violates "match production".

**jest-expo** _mocks_ the native module and **wa-sqlite** is the wrong engine, so neither is
prod-faithful. (jest-expo remains fine for pure-JS mobile _unit_ tests — just not for the
driver.) Using **better-sqlite3** "as mobile" is the same trap from the other side: that is
desktop's engine.

So the real `expoSqliteDriver` runs **inside the app on a simulator/emulator**: a `__DEV__`-gated
route builds a real `openDatabaseAsync(...)` → `expoSqliteDriver` and runs the **shared
`runDriverContract` spec** — the same one desktop runs — in-process against the real engine and
real SQLCipher. A Maestro flow launches the app on a booted device, deep-links to it, and asserts
the result from the command line, which is what makes an emulator run _automated_ rather than
manual.

**The harness assertion contract:** wait for `testID=driver-selftest-status` and assert its
`accessibilityLabel` reads `PASS` — `FAIL` on any failed case _or_ a zero-case run, `ERROR` if
the suite could not start. Key on that stable token, never the human-readable `N/N` count.

### Why Maestro _(owner-confirmed)_

The harness also founds the mobile E2E tier, so the choice was weighed long-term rather than for
this one self-test.

|                                  | **Maestro**                     | **Detox**                            | Appium                  |
| -------------------------------- | ------------------------------- | ------------------------------------ | ----------------------- |
| Model                            | **Blackbox** UI (YAML flows)    | Gray-box (instruments the RN bridge) | Blackbox (WebDriver)    |
| Sync / flakiness                 | retries + timeouts              | **bridge-idle sync** (fewest flakes) | manual waits (flakiest) |
| Install weight                   | single binary                   | npm + jest + native build config     | heavy server + drivers  |
| App coupling                     | none (drives the installed app) | instruments the build                | none                    |
| Fit to "as blackbox as possible" | **best**                        | weaker                               | ok                      |

Maestro wins on blackbox fit and install weight, and it is _arch-agnostic_ — it never touches the
RN bridge, so New-Architecture/Fabric is a non-issue, whereas Detox's instrumented build is the
part most likely to fight it. **Detox stays in reserve** for the day an elaborate flow
(sync/pairing) turns flaky and its bridge-idle determinism earns back the gray-box cost; the
tool-agnostic flow catalog keeps that switch cheap. Appium is overkill here.

## `__DEV__` deep links

```sh
leapsake://dev-selftest       # driver contract + the custody suite, on device
leapsake://dev-clear-dbkey    # simulate keychain loss
```

`dev-clear-dbkey` offers **three scopes**, and the difference matters:

- the **db-key alone** raises the unlock gate;
- **everything** reaches the master-key repair;
- **device identity** keeps the db-key, and so is the one route to the _Degraded_ state.

> Editing a self-test needs a **bundle reload**, not just re-firing the deep link. See
> [`maestro/README.md`](./maestro/README.md), which also covers the automated
> `pnpm test:native` gate.
