# @leapsake/mobile

The Leapsake mobile app (Expo + React Native, expo-router). Unlike desktop there is no IPC
boundary: the app builds `@leapsake/core` **in-process** over an expo-sqlite driver, so the
same core surface backs both clients behind a swapped driver and key-store port.

## Layout

```
app/          # expo-router routes; (tabs)/index.tsx is Home (the reminders list)
              # Four tabs — Home, People, Search, Menu. Everything else (the
              # holidays and gifts catalogs, Settings, every detail screen) is a
              # root-stack route that pushes full-screen over the tab bar.
db/           # the expo-sqlite driver, store conversion, and the unlock doors
lib/          # core-context.tsx — the boot path, custody branches, and core wiring
test/         # the on-device self-tests (driver contract + custody)
maestro/      # the E2E flows; see maestro/README.md
```

**Where the data lives depends on custody.** A device with no account holds a *plaintext*
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

| Platform | Relay URL |
|---|---|
| iOS simulator | `http://localhost:4000` |
| Android emulator | `http://10.0.2.2:4000` |

Start the relay with `pnpm --filter @leapsake/server dev` — see
[`@leapsake/server`](../server/README.md) → *Running*.

## `__DEV__` deep links

```sh
leapsake://dev-selftest       # driver contract + the custody suite, on device
leapsake://dev-clear-dbkey    # simulate keychain loss
```

`dev-clear-dbkey` offers **three scopes**, and the difference matters:

- the **db-key alone** raises the unlock gate;
- **everything** reaches the master-key repair;
- **device identity** keeps the db-key, and so is the one route to the *Degraded* state.

> Editing a self-test needs a **bundle reload**, not just re-firing the deep link. See
> [`maestro/README.md`](./maestro/README.md), which also covers the automated
> `pnpm test:native` gate.
