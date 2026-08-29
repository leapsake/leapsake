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

## Cutting a release

```sh
pnpm release alpha --dry-run   # what is this rung waiting on?
pnpm release alpha             # bump, tag, archive, export, upload
```

**Name no platform.** A tag ships every target that is `ready` and reports the rest as ⏳ with
the reason, so a platform is held back by its own status in `scripts/release/targets/`, never
by a flag left off the command line.

`scripts/release/` owns the rules and documents them in its own header; `pnpm release
--help` prints the current rung/platform matrix. Credentials live in an untracked `.env`
(copy `.env.example`) — team, provisioning profile, and an App Store Connect API key.

**From `beta` up, the release does not stop at the upload.** `alpha` hands the `.ipa` to
App Store Connect and ends there, which is all an internal build needs. `beta` and `rc` go
on to wait out processing, attach *What to Test*, add the build to the external tester
group, and submit it for Beta App Review — so a build reaches strangers with no App Store
Connect session anywhere in the path. Two things follow that nothing else in the repo
implies:

- **The API key must be App Manager.** A *Developer* key uploads builds perfectly well and
  cannot do any of the four steps above. The preflight is otherwise entirely offline and
  makes one deliberate exception — a live read of the app record — to catch that before the
  archive rather than after the upload. A role change means a **new key**, because the
  `.p8` downloads exactly once. The same probe reports what the record is still missing:
  Test Information, Beta App Review contact and notes, the tester group.
- **`release-notes/what-to-test.txt` is release copy, not a changelog.** It is what every
  external tester reads before installing, it is plain text because TestFlight renders no
  Markdown, and at this rung it has to say that the build is not a sole copy of anything.
  Preflight fails in the first ten seconds if it is missing, because the alternative is
  finding out after a twenty-minute archive.

Beta App Review runs **per version, not per build** — `0.1.0-beta.1` pays the day and
`beta.2` onwards go out in minutes — and the internal alphas buy no credit toward it,
since internal builds skip beta review entirely.

Three things about this app specifically, all of which cost an evening to learn once:

- **`ios/` is deleted and regenerated on every release.** It is `expo prebuild` output and
  gitignored, so nothing may originate there — signing is passed at invocation instead. A
  release therefore leaves you needing a fresh `pnpm --filter @leapsake/mobile ios` before
  the next dev-client run.
- **The suite's iOS tier needs a dev client that has been launched at least once against
  the running Metro**, because the harness reconnects through the dev-launcher's remembered
  server. If it times out at 180s having found no *Continue* button, that list is empty (or
  its stored URL is a LAN address that has since changed) — relaunch the dev client rather
  than debugging the flow. `pnpm test:native --provision` (which is what a release runs)
  repairs this itself by relaunching once and retrying; without the flag it is yours to fix.
- **Export compliance is declared in `app.json`**, not answered per upload. Without
  `ITSAppUsesNonExemptEncryption` a build lands at *Missing Compliance* and cannot be
  distributed to anyone, internal testers included.

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

## Form controls: the four pickers

Forms here are ports of the desktop forms — keep them behaviorally faithful (same fields,
same validation) and adapt only the input controls, because React Native has no `<select>`
and no `<datalist>`.

Four components cover every case, and each one's doc-comment states which list shape it is
for and why the other three are wrong for it — read those rather than a table here, since
they sit next to the code that has to honour them:

| Component | The list it is for |
|---|---|
| [`SelectField`](./components/SelectField.tsx) | a short, finite enum — the native wheel/dropdown |
| [`SuggestField`](./components/SuggestField.tsx) | free text with a handful of usual answers |
| [`Typeahead`](./components/Typeahead.tsx) | a long list picked *inline*, where the field can afford the width |
| [`PickerField`](./components/PickerField.tsx) | a long **closed** list picked in a sheet, when it cannot |

[`SegmentedControl`](./components/SegmentedControl.tsx) is the fifth, and not a picker: it
is for a genuinely small, glanceable, mutually-exclusive choice (`EntityTypeToggle`).

Prefer a native element over novel custom UI for any of these.

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
