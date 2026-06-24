# Leapsake — Testing Strategy (the model)

> **The stable "why/how" doc.** It defines the principles in depth, the testing-trophy
> layer model applied to *this* codebase, and the **driver-contract keystone**. It rarely
> changes. For the mobile-specific investigation that constrains the plan, see
> [`mobile-engine.md`](./mobile-engine.md); for what's built/next, see
> [`status.md`](../status.md); start at [`README.md`](./README.md) if you're new here.

## 1. The principles, in depth

The owner's testing philosophy is the testing trophy (a strong static base, then mostly
integration tests), governed by these rules. Each one *cuts options* — they're not
slogans, they decide tools.

1. **Automate over manual.** A manual verification step (like the existing mobile SQLCipher
   check) is a temporary bridge, not an endpoint. Every layer should converge on something
   a machine runs.
2. **Match production as closely as possible.** Signal strength scales with runtime
   fidelity. A test that runs a *different engine, bundler, or module graph* than ships is
   weaker, and the gap is a smell to be named and minimized. This single rule rejects both
   mocked SQLite (jest-expo) and WASM SQLite (wa-sqlite) for the mobile **driver** — see
   [`mobile-engine.md`](./mobile-engine.md).
3. **Test what's observable to the consumer.** Identify *who consumes the thing under
   test*, and assert only on the surface that consumer sees:
   - consumer of `expoSqliteDriver` / `encryptedSqliteDriver` = `packages/data` via the
     `SqliteDriver` port → assert on the port's return values;
   - consumer of a `packages/data` repo = `packages/core` → assert on repo method results;
   - consumer of `packages/core` = a client app → assert on `CoreApi` results;
   - consumer of an **app** = a human → assert on what's on screen.
4. **As blackbox as possible.** Drive the subject through its real boundary; never reach
   inside. For apps this favors *blackbox UI automation* (drive the built app, assert on
   screen) over instrumenting the app's internals.
5. **Full trophy for every app and package.** The target is static + unit + integration +
   E2E with a home for each, per app and per package — desktop *and* mobile (*and* server,
   web when it exists).
6. **Everything reachable from the dev machine — or a documented host for the platform.**
   No hosted CI is assumed yet; a developer on a MacBook must be able to run every
   automated test locally *that physically can run there*. This makes the *emulator tier*
   a first-class local concern, and forces an explicit `pnpm test` orchestration decision
   (one slow command vs. tiers + an umbrella). **Carve-out:** native-platform E2E is
   intrinsically multi-host — a prod-faithful Windows or Linux run cannot happen on an
   Apple-silicon Mac. So the rule is "reachable from the dev machine **or** from a
   documented, *vendor-neutral* host for that platform"; a platform's E2E gate is simply
   *blocked* (not waived) until its host exists. See §6.
7. **Incremental, no middling-confidence hacks.** Reorder freely to lay the best next
   brick; don't ship a shortcut that only buys partial confidence.

## 2. The layer model, applied to this codebase

The non-UI surface is shared across clients (`schema → data → core → clients`), so most
"business logic" testing already belongs to the **packages**, and the **apps** add the
platform edges (the driver, the key store, the UI).

| Layer | What it asserts | Where it lives today | Where it's missing |
|---|---|---|---|
| **Static** | types, lint | `tsc` per package/app, `oxlint` | (watch: new test dirs must be in a tsconfig `include` — desktop's `test/` was silently excluded until fixed) |
| **Unit** | pure functions in isolation | `packages/schema` (role algebra, gender derivation, milestone precision, normalization, search folding) | mobile-specific pure logic, if any, has no runner |
| **Integration** | repos/services + a **real** driver | `apps/desktop/test/integration/*` (~27 suites) on the real encrypted engine via `makeEncryptedTestDriver` | mobile: nothing — blocked by the native-engine wall (§4) |
| **Driver contract** | every `SqliteDriver` impl behaves identically | *(to build — the keystone, §3)* | both apps need to run it against their own engine |
| **E2E** | whole app, driven as a user | none (desktop Playwright+Electron deferred; mobile none) | both apps |

**Key architectural consequence:** because the repo/service logic is shared and
driver-injected, you do *not* re-prove it per platform by re-running every integration
suite on every engine. You prove the **driver** is equivalent (the contract test), then the
shared logic's desktop run carries over. This is the lever that keeps the mobile/emulator
tier small.

## 3. The driver-contract keystone

`packages/data` is written entirely against the `SqliteDriver` port
(`packages/data/src/driver.ts`): `exec`, `run`, `all`, `get`, `transaction`. There are two
real implementations, with subtle behavioral seams the repos currently paper over:

- **desktop** `encryptedSqliteDriver` (`apps/desktop/src/main/db/encrypted-sqlite-driver.ts`)
  — `better-sqlite3-multiple-ciphers`, synchronous, BLOBs come back as `Buffer`
  (a `Uint8Array` subclass), manual `BEGIN/COMMIT/ROLLBACK`.
- **mobile** `expoSqliteDriver` (`apps/mobile/db/expo-sqlite-driver.ts`) — expo-sqlite,
  async, `getFirstAsync` returns `null` (coerced to `undefined`), manual
  `BEGIN/COMMIT/ROLLBACK`.

**Nothing currently guarantees they behave identically.** That's the gap the keystone
closes.

**Design:** a single **driver-agnostic conformance suite** that accepts a `makeDriver`
factory and exercises the observable contract:

- transaction **commit** persists; transaction **rollback** discards;
- positional **param binding** (`?` placeholders);
- `get()` → `undefined` on a miss (not `null`);
- **BLOB round-trip** — a `Uint8Array` in comes back with the same bytes and a readable
  `Uint8Array`-compatible type;
- **multi-statement `exec`**;
- **`all` ordering** is preserved.

Each app runs the *same* suite against its *own* real engine: desktop under Vitest against
`encryptedSqliteDriver`; mobile inside the app on an emulator against `expoSqliteDriver`
(§4). The suite is blackbox (it only touches the port) and prod-faithful (real engines),
satisfying principles #2–#4 simultaneously.

**Portability note (open decision):** to be runnable under both desktop-Vitest and a
mobile runner, the suite should be authored against **test-runner globals** (no hard
`import` from `vitest`) and shared from one location (e.g. a `@leapsake/data/testing`
subpath), so the two drivers can't drift behind divergent copies. The alternative —
desktop-local now, generalize later — risks exactly the drift the keystone exists to
prevent. See [`README.md`](./README.md#open) for the pending call.

## 4. The mobile wall (summary; full detail in `mobile-engine.md`)

The real expo-sqlite engine is a **native module** and cannot be loaded in a Node/Vitest
process — `requireNativeModule('ExpoSQLite')` throws with no Expo runtime. The two
headless substitutes both violate principle #2 (match prod): jest-expo *mocks* the native
module, and the wa-sqlite **web/WASM** build is a different engine (and a browser artifact
needing Worker/`window`/SharedArrayBuffer). Therefore the **only** prod-faithful mobile
driver test runs the engine **inside the app on a simulator/emulator**.

That makes the mobile tier an **emulator tier**: a dev-only in-app self-test runs the
shared contract suite in-process (real engine, real `SQLiteDatabase`, real SQLCipher) and
surfaces PASS/FAIL, and a blackbox harness (Maestro/Detox) launches the app on an emulator
and asserts the result. The harness chosen here also **founds the mobile E2E tier**, so it
isn't single-use scaffolding. Android is the near-term target (iOS gated on a local Xcode
upgrade, per [`status.md`](../status.md)). Tool trade-offs and the full investigation are
in [`mobile-engine.md`](./mobile-engine.md).

## 5. How this maps onto the trophy (the end state)

```
            ▲ fewer, slower, more prod-faithful
   E2E      │  the crucial-flow catalog (§6), per platform on its closest approximation:
            │  iOS sim · Android emulator · macOS/Windows/Linux native (Maestro / Playwright)
 Integration│  repos/services + real driver (desktop: Vitest+encrypted engine;
            │                                 mobile: contract suite proves the seam)
   Unit     │  pure logic in packages/* (Vitest); mobile-specific units if any
  Static    │  tsc + oxlint, every package/app   ◄ broad, fast, cheap
            ▼
```

The **driver contract** sits at the integration/E2E boundary: it's the smallest test that
must touch a real engine, and it's what lets the broad integration layer stay
single-engine. Build it first; it's the brick every other mobile tier leans on. The **E2E
tier above it is gated per platform** — see §6.

## 6. Native-platform E2E: crucial flows, per platform, as a release gate

The contract keystone proves the *driver*; the integration layer proves the *shared
logic*. Neither proves that **a real user on a real device can actually complete the
crucial journeys** — first run, unlock, create a person, record a milestone, pair a second
device. That's the E2E tier, and it carries a rule the lower tiers don't:

> **Before the first release of Leapsake on a given platform, the crucial-flow catalog must
> run *automated and green* on the closest approximation of that platform** — iOS on an iOS
> Simulator, Android on an Android emulator, the macOS app on macOS, Windows on Windows,
> Linux on Linux. The bulk of the trophy stays non-native (principles #2–#5); this tier is
> deliberately *small*, but for the journeys that matter it must be as close as possible to
> a real user on a real device.

A **simulator / emulator / VM is itself the accepted approximation** — the gate does *not*
require real hardware or a real-device cloud. "Closest approximation" means the closest
*automatable* runtime: the production app binary on the platform's OS image, virtualized.
This is both sufficient (it runs the real engine, key store, and UI of that OS) and the
reason the vendor-neutrality story holds (§6.3) — a real-device farm never becomes a hard
dependency. Everything below this tier stays in a JS runtime (Node/Vitest); only these few
flows pay the VM/sim cost.

### 6.1 The crucial-flow catalog (the E2E keystone)

The analog of the driver-contract keystone, one tier up: a **single, tool-agnostic catalog
of crucial user flows**, authored in plain language, that *each platform's harness
implements* against the built app. Keeping the catalog separate from any one tool is the
core anti-lock-in move (§6.3) — swap Maestro for Detox, or Playwright for WebdriverIO, and
the catalog survives unchanged.

Initial catalog (smoke-level, ~5–6 flows — expand deliberately, not reflexively):

1. **First run / onboarding** — fresh install reaches a usable empty state.
2. **Unlock + re-auth** — set a passphrase, lock, unlock. *Exercises the per-platform key
   store* (macOS Keychain · Windows Credential Manager/DPAPI · Linux libsecret · iOS/Android
   secure storage) — genuinely platform-specific, so high E2E value.
3. **Create a person + a relationship** — the core write path, asserted on screen.
4. **Record a milestone** — exercises the encrypted per-item content path end to end.
5. **Pair a second device (sync)** — the multi-device join, the one flow integration tests
   can only approximate.
6. **Recovery code** — generate, and recover with, a recovery code.

Each flow asserts on **what's on screen** (principle #3) and drives the **built app**
through its real boundary (principle #4) — never the app's internals.

### 6.2 Per-platform host matrix (what runs where, and what's blocked)

Native E2E is intrinsically multi-host; principle #6's carve-out names this explicitly.

| Platform | Closest approximation | Host reachable from this Mac? |
|---|---|---|
| macOS desktop | the macOS app on macOS | ✅ the dev MacBook — fully local, unblocked |
| iOS | iOS Simulator (Xcode) | ⏳ local once the Xcode 16.4+ gate is lifted (see [`status.md`](../status.md)) |
| Android | Android emulator | ✅ verified working locally |
| Windows desktop | the Windows app on Windows | ❌ not on macOS — needs a Windows host (VM / NUC / self-hosted runner) |
| Linux desktop | the Linux app on Linux + xvfb | ❌ needs a Linux container/VM (Electron GUI needs a virtual framebuffer) |

**v0.1 release gate (owner decision): iOS + Android + macOS** must pass the catalog before
v0.1 ships. Windows and Linux are *deliberately deferred* to a later release — their gate is
blocked until a host exists, not waived. Shipping a subset is an explicit, supported
outcome. Priority order overall is iOS → Android → macOS → Windows → Linux, but
*feasibility-first* the earliest bricks are **macOS desktop** (local, unblocked today) and
**Android** (emulator verified); **iOS** unblocks with the Xcode upgrade.

### 6.3 Vendor-neutrality: two layers, kept apart

The owner's constraint — *don't let the test suite get locked into a single third-party* —
is satisfied by separating two layers and never letting one leak into the other:

- **Authoring layer** — the crucial-flow catalog (§6.1) and its harness specs (Maestro
  flows, Playwright/Electron specs). All open-source, portable, drive the app through OS/UI.
  This is what we own and keep.
- **Execution layer** — *where* a harness runs: local machine, a self-hosted VM/NUC, or (if
  ever) a device/VM farm. This is a **swappable backend**. The rule: **never bake a farm's
  proprietary API into a spec.** A spec that runs locally must run on a self-hosted host with
  only config changes. That portability *is* the insurance against lock-in.

Harness tools per app: **mobile → Maestro** (leaning; Detox in reserve — see
[`mobile-engine.md`](./mobile-engine.md#harness-tool-trade-offs)); **desktop → Playwright's
Electron support** (leaning; commit at the E2E step — see [`README.md`](./README.md#open)).
Both are open-source and run the same spec across their target OSes.
