# Mobile Engine Testing — The Investigation

> **The load-bearing research artifact behind this folder.** It answers one question that
> shapes the whole mobile testing plan: *can expo-sqlite's real engine run in a headless
> Node/Vitest process?* (No.) It records the evidence, why the obvious substitutes are
> rejected, the resulting emulator-tier shape, and the harness-tool trade-offs. Read
> [`strategy.md`](./strategy.md) for the principles this applies; [`README.md`](./README.md)
> for the open decisions and task backlog.

## The question

Desktop runs its repo/service integration tests against the **real** production engine
(`better-sqlite3-multiple-ciphers`, in-process, Node ABI). To give mobile the same
prod-faithful coverage, we need a real `expoSqliteDriver` (`apps/mobile/db/expo-sqlite-driver.ts`)
over a real expo-sqlite `SQLiteDatabase`. So: **can expo-sqlite run under Node/Vitest at all?**

## Finding: no — the real engine cannot load headlessly

expo-sqlite is a **native module**. Its module graph resolves to
`requireNativeModule('ExpoSQLite')` (`node_modules/expo-sqlite/build/ExpoSQLite.js`), which
throws when there is no Expo native runtime to return the module — i.e. in any plain
Node/Vitest process. This is structural to native modules, not a missing config.

Three concrete dead-ends, all verified by reading expo-sqlite's shipped source:

1. **Native path → throws.** `build/index.js → SQLiteDatabase → ExpoSQLite.js →
   requireNativeModule('ExpoSQLite')`. No native runtime in Node ⇒ throws at import.
2. **The built-in Node branch is a no-op stub.** `build/ExpoSQLite.web.js` has a
   `typeof window === 'undefined'` branch that loads `web/SQLiteModule.node`, whose own
   header reads *"expo-sqlite is not supported on server runtime, this file contains a
   dummy implementation for the server runtime."* Every method is a no-op returning empty
   results. Running the contract suite against it would pass/while-asserting-nothing — the
   exact "fake it" trap.
3. **The wa-sqlite WASM web build is a different engine and a browser artifact.**
   `web/SQLiteModule.ts` is real SQLite compiled to WASM, but it `new Worker(new
   URL('./worker', window.location.href))`, drives it with synchronous worker calls
   (SharedArrayBuffer/`Atomics`), and needs `window`. It is a *browser* runtime artifact,
   and even if hosted (Vitest browser-mode under headless Chromium), it is the **web**
   engine — **not** the iOS/Android native build (which is SQLCipher-keyed, per
   [`status.md`](../status.md)). Different engine = violates "match production."

(Also confirmed empirically: a bare `node` import of `expo-sqlite` fails even to resolve
its extensionless imports — the package is built for the Metro bundler, not Node ESM.)

## Consequence: the mobile driver test is an emulator tier

Since no headless substitute is prod-faithful, the real `expoSqliteDriver` must run **inside
the app on a simulator/emulator**. Shape:

- **In-app dev-only self-test.** A debug route/entry constructs a real
  `openDatabaseAsync(...)` → `expoSqliteDriver` and runs the **shared contract suite**
  (the same one desktop runs, [`strategy.md`](./strategy.md#3-the-driver-contract-keystone))
  in-process, then renders PASS/FAIL (and failure detail). Assertions execute in the
  *production* RN runtime — maximally faithful, and blackbox w.r.t. the driver (it only
  touches the port). The app already bundles expo-sqlite + the SQLCipher build, so no new
  native host project is needed.
- **A blackbox harness** (Maestro/Detox) launches the app on an emulator and asserts the
  self-test reports PASS. This *is* the automation that satisfies "automate over manual" —
  an emulator run is automatable, not inherently manual.

**Why the tier stays small:** the contract test proves the *driver* is equivalent to
desktop's. The repo/service logic above the `SqliteDriver` port is shared code already
covered by desktop's integration run, so it need not be re-run on the emulator. The
emulator job carries the *small* contract suite, not the ~27 integration suites. (Whether
to *additionally* run broader suites on the engine is an open call — see
[`README.md`](./README.md#open).)

## Platform reality (local-first, no hosted CI)

- **Android emulator works locally today** and is verified for the SQLCipher dev client
  ([`status.md`](../status.md)) → it is the **near-term native target**.
- **iOS is gated locally** — the Expo 56 / RN 0.85 prebuilt `ExpoModulesJSI` needs Swift
  tools 6.2 (Xcode 16.4+); the local Xcode is 16.2. iOS joins once that's lifted. The
  shared code path is platform-identical, so Android exercises the driver fully meanwhile.
- Because every automated test must be reachable from the dev MacBook (principle #6), the
  emulator tier is a **local** concern now, not a "wait for CI" deferral. This forces the
  `pnpm test` orchestration decision (see below).

## Tool trade-offs

### Rejected substitutes (and why)

| Option | Real engine? | Why rejected for the driver |
|---|---|---|
| **jest-expo (Node)** | No — mocks native modules | Fake driver; violates "match prod". *(Still valid for pure-JS mobile **unit** tests.)* |
| **Vitest browser + wa-sqlite WASM** | Real SQLite, **wrong** engine | Web/WASM build, not the native SQLCipher build; browser artifact (Worker/`window`/SharedArrayBuffer). Smell. |
| **better-sqlite3 directly "as mobile"** | Real SQLite, **desktop's** engine | Explicitly the "test the wrong engine and call it mobile" anti-goal. |

### Harness tool trade-offs

The harness launches the app on the emulator and observes the self-test (and later drives
real E2E flows). Whatever is chosen **founds the mobile E2E tier**, so weigh it long-term.
That E2E tier is the **mobile slice of the per-platform release gate** — the crucial-flow
catalog that every platform (desktop included, via Playwright) must pass on its closest
approximation before first release; see
[`strategy.md` §6](./strategy.md#6-native-platform-e2e-crucial-flows-per-platform-as-a-release-gate).

| | **Maestro** | **Detox** | Appium |
|---|---|---|---|
| Model | **Blackbox** UI (YAML flows) | Gray-box (instruments the RN bridge) | Blackbox (WebDriver) |
| Sync / flakiness | retries + timeouts | **bridge-idle sync** (fewest flakes) | manual waits (flakiest) |
| Install weight | single binary | npm + jest + native build config | heavy server + drivers |
| App coupling | none (drives the installed app) | instruments the build | none |
| Fit to "as blackbox as possible" | **best** | weaker (instruments the subject) | ok |
| Local-Mac / no-CI fit | **excellent** | good, more config | poor |

- **Maestro** is the cultural and operational fit: blackbox (principle #4), single binary,
  no app instrumentation, easy to invoke from a `pnpm` script locally. Weakness: less
  deterministic sync than Detox (mitigated by built-in retries).
- **Detox** trades blackbox-ness for the most stable synchronization (it waits for the RN
  bridge to idle) and Jest-style matchers — worth it only if real E2E flows get flaky.
- **Appium** is overkill here.

**Decision (owner-confirmed 2026-07-16):** **Maestro.** Blackbox, single binary, and
*arch-agnostic* — it never touches the RN bridge, so New-Architecture/Fabric on RN 0.85
is a non-issue, whereas Detox's instrumented build is the part most likely to fight the
New Arch. Detox stays **in reserve** for the day an elaborate flow (sync/pairing) turns
flaky and its bridge-idle determinism earns back the gray-box cost; the tool-agnostic flow
catalog keeps that switch cheap. (Not built yet — founds the mobile E2E tier at steps 8–9.)

## `pnpm test` orchestration (open decision)

The emulator tier costs minutes (boot + install) and needs an emulator present, so it can't
sit on the hot path of every iteration. Two shapes:

- **Tiered + umbrella (leaning):** `pnpm test` = fast Node tier (static/unit/integration,
  sub-10s); `pnpm test:native` / `pnpm test:e2e` = emulator tiers; `pnpm test:all` runs
  literally everything. Documented so principle #6 ("everything reachable") holds via the
  umbrella, while daily work stays fast.
- **Single command:** `pnpm test` boots the emulator and runs all tiers every time — one
  mental model, zero chance of a skipped automated test, but every run pays the emulator
  cost and requires an emulator available.

## What a future agent should do with this

1. Treat finding #1–#3 as **settled** — do not re-litigate headless expo-sqlite; it cannot
   be prod-faithful in Node. If you think you've found a way, you've probably found the
   WASM or stub path, which is rejected on principle, not capability.
2. Build the **shared contract suite** and the **desktop run first** (no emulator needed) —
   it's unblocked and is the keystone the emulator tier consumes.
3. For the emulator tier, confirm the **harness** and **`pnpm test` shape** decisions in
   [`README.md`](./README.md#open) before building; target **Android** first.
