# Mobile Engine Testing — The Constraint

> The load-bearing finding behind the mobile tier: **expo-sqlite's real engine cannot run in a
> headless Node/Vitest process**, which forces the mobile driver test onto an emulator. This doc
> records the evidence, the resulting tier shape, and the harness-tool choice. Read
> [`strategy.md`](./strategy.md) for the model this applies; [`status.md`](../status.md) for what's
> built.

## Finding: the real engine cannot load headlessly

expo-sqlite is a **native module**. Its graph resolves to `requireNativeModule('ExpoSQLite')`
(`node_modules/expo-sqlite/build/ExpoSQLite.js`), which throws with no Expo native runtime — i.e.
in any plain Node/Vitest process. This is structural to native modules, not a missing config.

Three dead-ends, all verified against expo-sqlite's shipped source — **do not re-litigate these:**

1. **Native path → throws.** `build/index.js → SQLiteDatabase → ExpoSQLite.js →
   requireNativeModule('ExpoSQLite')`. No native runtime in Node ⇒ throws at import.
2. **The Node branch is a no-op stub.** `build/ExpoSQLite.web.js`'s `typeof window === 'undefined'`
   branch loads `web/SQLiteModule.node`, whose header says *"dummy implementation for the server
   runtime."* Every method no-ops → the contract suite would pass while asserting nothing (the "fake
   it" trap).
3. **The wa-sqlite WASM web build is a different engine.** `web/SQLiteModule.ts` is real SQLite in
   WASM, but it's a *browser* artifact (`new Worker`, SharedArrayBuffer/`Atomics`, needs `window`),
   and it's the **web** engine — not the iOS/Android native SQLCipher build that ships. Different
   engine = violates "match production."

The two headless substitutes both fail principle #2: **jest-expo** *mocks* the native module, and
**wa-sqlite** is the wrong engine. (jest-expo is still fine for pure-JS mobile *unit* tests — just
not for the driver.) Using **better-sqlite3** "as mobile" is the same trap from the other side —
that's desktop's engine.

## Consequence: the mobile driver test is an emulator tier

Since no headless substitute is prod-faithful, the real `expoSqliteDriver` must run **inside the app
on a simulator/emulator**:

- **In-app dev-only self-test.** A `__DEV__`-gated route (`leapsake://dev-selftest`) constructs a
  real `openDatabaseAsync(...)` → `expoSqliteDriver` and runs the **shared `runDriverContract`
  spec** (the same one desktop runs) in-process against the real engine + real SQLCipher, then
  renders PASS/FAIL. The app already bundles expo-sqlite + the SQLCipher build, so no new native host
  project is needed.
- **A blackbox harness** (Maestro) launches the app on a booted device, deep-links to the self-test,
  and asserts the result from the command line. This is the automation that satisfies "automate over
  manual" — an emulator run is automatable, not inherently manual.

**Harness assertion contract:** wait for `testID=driver-selftest-status`, assert its
`accessibilityLabel` reads `PASS` (`FAIL` on any failed case *or* a zero-case run; `ERROR` if the
suite couldn't start). Key on that stable token, not the human-readable `N/N` count.

**Why the tier stays small:** the contract test proves the *driver* is equivalent to desktop's; the
repo/service logic above the `SqliteDriver` port is shared code already covered by desktop's
integration run. So the emulator job carries the *small* contract suite, not the ~37 integration
suites. (Whether to *also* run broader suites on the engine is an open call; default: rely on the
contract test, revisit if real drift appears.)

## Tool trade-offs

The harness launches the app and observes the self-test — and later drives real E2E flows
([`crucial-flows.md`](./crucial-flows.md)), so it **founds the mobile E2E tier** and is weighed
long-term.

| | **Maestro** | **Detox** | Appium |
|---|---|---|---|
| Model | **Blackbox** UI (YAML flows) | Gray-box (instruments the RN bridge) | Blackbox (WebDriver) |
| Sync / flakiness | retries + timeouts | **bridge-idle sync** (fewest flakes) | manual waits (flakiest) |
| Install weight | single binary | npm + jest + native build config | heavy server + drivers |
| App coupling | none (drives the installed app) | instruments the build | none |
| Fit to "as blackbox as possible" | **best** | weaker | ok |

**Decision (owner-confirmed): Maestro.** Blackbox (principle #4), single binary, and *arch-agnostic*
— it never touches the RN bridge, so New-Architecture/Fabric on RN 0.85 is a non-issue, whereas
Detox's instrumented build is the part most likely to fight the New Arch. **Detox stays in reserve**
for the day an elaborate flow (sync/pairing) turns flaky and its bridge-idle determinism earns back
the gray-box cost; the tool-agnostic flow catalog keeps that switch cheap. Appium is overkill here.
