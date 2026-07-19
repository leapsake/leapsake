# Leapsake — The Testing Model

> The trophy applied to *this* codebase: the layer model, the **driver-contract keystone**, and
> the **native-E2E release-gate policy**. Assumes the [principles](./README.md#principles-the-lens-every-decision-is-judged-against).
> For the mobile constraint that shapes the plan, see [`mobile-engine.md`](./mobile-engine.md);
> for the E2E flow catalog, [`crucial-flows.md`](./crucial-flows.md); for status,
> [`status.md`](../status.md).

## 1. The layer model, applied here

The non-UI surface is shared across clients (`schema → data → core → clients`), so most
"business logic" testing belongs to the **packages**; the **apps** add the platform edges (the
driver, the key store, the UI).

| Layer | What it asserts | Lives today | Missing |
|---|---|---|---|
| **Static** | types, lint | `tsc` per package/app, `oxlint` | — (watch: every new test dir must be in a tsconfig `include` — desktop's `test/` was silently excluded until fixed) |
| **Unit** | pure functions in isolation | `packages/schema` (role algebra, gender, milestone precision, normalization, search folding, mention/tag helpers) | mobile-specific pure logic has no headless runner |
| **Integration** | repos/services + a **real** driver | `apps/desktop/test/integration/*` on the real encrypted engine via `makeEncryptedTestDriver` | mobile: none — blocked by the native-engine wall ([`mobile-engine.md`](./mobile-engine.md)) |
| **Driver contract** | every `SqliteDriver` impl behaves identically | `packages/data/src/testing/driver-contract.ts`, run by desktop Vitest **and** the mobile in-app self-test (§2) | — |
| **E2E** | whole app, driven as a user | none | both apps — the crucial-flow catalog ([`crucial-flows.md`](./crucial-flows.md)) |

**Key architectural consequence:** because the repo/service logic is shared and driver-injected,
you do *not* re-prove it per platform by re-running every integration suite on every engine. You
prove the **driver** is equivalent (§2), and the shared logic's desktop run carries over. This is
the lever that keeps the mobile/emulator tier small.

**Consumer mapping (principle #3 in practice)** — assert on what each consumer sees:
`expoSqliteDriver`/`encryptedSqliteDriver` → their `SqliteDriver` port's return values; a
`packages/data` repo → its method results; `packages/core` → `CoreApi` results; an **app** → what's
on screen.

## 2. The driver-contract keystone

`packages/data` is written entirely against the `SqliteDriver` port (`exec`, `run`, `all`, `get`,
`transaction`). Two real implementations have subtle behavioral seams the repos paper over:

- **desktop** `encryptedSqliteDriver` — `better-sqlite3-multiple-ciphers`, **synchronous**, BLOBs
  return as `Buffer`, manual `BEGIN/COMMIT/ROLLBACK`.
- **mobile** `expoSqliteDriver` — expo-sqlite, **async**, `getFirstAsync` returns `null` (coerced
  to `undefined`), manual `BEGIN/COMMIT/ROLLBACK`.

Nothing else guarantees they behave identically — that's the gap the keystone closes.

**Design:** one **driver-agnostic conformance suite**, `runDriverContract(testApi, makeDriver)`,
authored against injected `{ describe, it, expect }` (no test-runner import) and a driver factory,
so the two drivers can't drift behind divergent copies. Each case provisions/tears down its own
driver and its own throwaway table (schema-independent). It exercises only the observable port
contract — transaction commit persists / rollback discards / rollback rethrows, positional param
binding, `get()`→`undefined` on a miss (not `null`), BLOB byte round-trip, multi-statement `exec`,
`all` ordering + `[]`-on-empty, NULL round-trip, connection-close. Blackbox (touches only the port)
and prod-faithful (each app runs it against its *own* real engine), satisfying principles #2–#4 at
once.

**Build the keystone first:** it's the smallest test that must touch a real engine, and every
mobile tier leans on it — once the mobile driver passes it, the shared logic above the port is
already covered by desktop's run.

### Keeping the contract from going stale

The risk isn't *which* cases run (both consumers call the one `runDriverContract`, so adding a case
appears in both automatically) — it's the *contract* failing to grow when a driver does. Two levers:

- **Coverage gate (the authoring forcer).** The desktop Vitest run gates the driver file at 100%
  coverage (`vitest.coverage.config.ts`), so a new desktop driver code path *mechanically* fails
  until a contract case exercises it. Desktop-only — the mobile driver can't load under Node, so
  its equivalent coverage lives in the in-app self-test.
- **Both engines run the one spec.** Desktop Vitest and the mobile self-test both consume
  `runDriverContract`, so a new case must go green on *both* engines. The screen also self-guards a
  stale-signal trap: a zero-case run reads **FAIL** (`total > 0` required), so a broken import can't
  show a vacuous green.

> Future candidate cases (where native SQLite libs most plausibly diverge): type/affinity coercion
> (int/real/text, BigInt, empty-string vs NULL, boolean), large BLOBs, constraint-violation/error
> shape, nested transactions, collation/Unicode ordering, any new `SqliteDriver` method.

## 3. Native-platform E2E: the release-gate policy

The keystone proves the *driver*; the integration layer proves the *shared logic*. Neither proves
**a real user on a real device can complete the crucial journeys**. That's the E2E tier, and it
carries a rule the lower tiers don't:

> **Before the first release of Leapsake on a given platform, the crucial-flow catalog must run
> *automated and green* on the closest approximation of that platform** — iOS Simulator, Android
> emulator, macOS/Windows/Linux native.

A **simulator/emulator/VM is itself the accepted approximation** — the gate does not require real
hardware or a device cloud. "Closest approximation" = the closest *automatable* runtime: the
production app binary on that OS image, virtualized. This is why the vendor-neutrality story holds
(a real-device farm never becomes a hard dependency). The catalog itself — the tool-agnostic list
of journeys each platform's harness implements — is [`crucial-flows.md`](./crucial-flows.md).

### Host matrix and v0.1 scope

| Platform | Closest approximation | Reachable from this Mac? |
|---|---|---|
| macOS desktop | the macOS app on macOS | ✅ the dev MacBook — fully local |
| Android | Android emulator | ✅ verified working locally |
| iOS | iOS Simulator (Xcode) | ✅ local (Xcode gate lifted) |
| Windows desktop | the Windows app on Windows | ❌ needs a Windows host (VM / NUC / self-hosted runner) |
| Linux desktop | the Linux app on Linux + xvfb | ❌ needs a Linux container/VM |

**v0.1 release gate (owner decision): iOS + Android + macOS** must pass the catalog before v0.1.
Windows + Linux are *deliberately deferred* — blocked on a host, not waived. Shipping a subset is
an explicit, supported outcome.

### Vendor-neutrality: two layers, kept apart

- **Authoring layer** — the flow catalog + its harness specs (Maestro flows, Playwright/Electron
  specs). Open-source, portable, drive the app through OS/UI. This is what we own and keep.
- **Execution layer** — *where* a harness runs: local, self-hosted VM/NUC, or (if ever) a farm. A
  **swappable backend.** The rule: **never bake a farm's proprietary API into a spec** — a spec
  that runs locally must run on a self-hosted host with only config changes.

Harness tools: **mobile → Maestro** (Detox in reserve — [`mobile-engine.md`](./mobile-engine.md#tool-trade-offs));
**desktop → Playwright's Electron support** (leaning; commit at the desktop-E2E step — the
alternative is WebdriverIO + `wdio-electron-service`). Both are open-source and run the same spec
across their target OSes.
