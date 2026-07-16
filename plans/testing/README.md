# Leapsake — Testing Strategy (start here)

> **This folder is the design home for *how Leapsake tests itself* across every app and
> package.** It captures the testing **principles** (stable), the **decisions** made and
> still open, the **investigation findings** that constrain us (chiefly: the mobile
> native SQLite engine cannot run headlessly), and a **task backlog** with a recommended
> order. It is forward-looking design, like [`encryption/`](../encryption/) — *not* a
> status board.
>
> **For what is built and what is next, see [`status.md`](../status.md)** — the single
> cross-workstream oracle. Update *that* per increment; keep these docs stable.

## Why this exists

Testing in the repo grew up desktop-first: a strong static base plus ~413 Vitest
integration tests that now run against the **real** desktop encrypted engine
(`better-sqlite3-multiple-ciphers` via `makeEncryptedTestDriver`). Mobile
(`apps/mobile`, Expo/React Native) has **no test runner at all** and isn't in
`vitest.config.ts`. The trigger for writing this down: an attempt to bring mobile to test
parity hit a hard architectural wall — **expo-sqlite's real engine is a native module
that cannot load in a Node/Vitest process** — which forces a deliberate, owner-signed
strategy rather than an ad-hoc fix. See [`mobile-engine.md`](./mobile-engine.md) for the
full investigation; it's the load-bearing finding behind everything here.

The owner's goal is the **full testing-trophy stack — static → unit → integration → E2E —
for every app and every package**, automated, runnable locally, with no hacks taken for
middling confidence.

## If you're picking this up cold, read in this order

1. **[`strategy.md`](./strategy.md)** — the principles (the *why*), the layer model per
   app/package, and the **driver-contract keystone** (the one test that pins every
   `SqliteDriver` implementation to identical behavior). This is the stable conceptual core.
2. **[`mobile-engine.md`](./mobile-engine.md)** — the investigation: why expo-sqlite can't
   run headlessly, what that means for the mobile tier, and the tool trade-offs
   (Maestro vs Detox vs the rejected shortcuts).
3. **This file's** *Decisions* + *Task backlog* below — what's settled, what's open, and
   the recommended next bricks.

## Principles (settled — owner-articulated)

These are the lens every testing decision is judged against. Restated in depth in
[`strategy.md`](./strategy.md).

1. **Automate over manual.** Prefer an automated test to a manual checklist, always. A
   manual step is a stopgap, never a destination.
2. **Match production as closely as possible.** The further a test's runtime drifts from
   what ships, the weaker its signal — divergence is a *smell*. (This is what rejects
   mocked/WASM SQLite for the mobile driver; see below.)
3. **Test what's observable to the consumer.** A test asserts on the surface the
   *consumer* of that app/package actually sees — return values of a port, the public API
   of a package, text/pixels on screen for an app — not private internals.
4. **As blackbox as possible.** Drive the unit under test through its real boundary; don't
   reach inside it. (Shapes the E2E tool choice toward blackbox UI automation.)
5. **Full trophy, every app and package.** Static, unit, integration, and E2E each have a
   home for each app and package — not just desktop.
6. **One local command surfaces everything it *can*.** Assume **no hosted CI** for now: a
   developer on a MacBook must be able to run *every* automated test that can physically run
   there (reachable from `pnpm test` / a documented umbrella). **Carve-out:** native-platform
   E2E is intrinsically multi-host — Windows/Linux runs can't happen on an Apple-silicon Mac.
   So the rule is "reachable from the dev machine **or** a documented, *vendor-neutral* host
   for that platform"; that platform's E2E gate is *blocked* (not waived) until its host
   exists. See [`strategy.md`](./strategy.md#6-native-platform-e2e-crucial-flows-per-platform-as-a-release-gate).
7. **Incremental, no hacks.** Prefer reordering the work to lay the best next brick over
   shipping a faster hack that only buys middling confidence.

## Decisions

### Settled (findings — see [`mobile-engine.md`](./mobile-engine.md) for proof)

- **The mobile native engine cannot run headlessly.** expo-sqlite is a native module;
  `requireNativeModule('ExpoSQLite')` throws outside the Expo runtime. Real-engine mobile
  tests therefore require a **simulator/emulator** — this is a property of native modules,
  not a fixable tooling gap.
- **Two tempting shortcuts are rejected on principle #2 (match prod):**
  - **jest-expo in Node** *mocks* native modules → the driver under test would be a fake.
    (Still fine for pure-JS unit tests; just not for the driver.)
  - **Vitest browser-mode + expo-sqlite's wa-sqlite WASM build** is real SQLite but the
    *web* engine, not the iOS/Android native build that ships — wrong engine = smell.
- **The `SqliteDriver` contract test is the architectural keystone.** A single
  driver-agnostic conformance suite (taking a `makeDriver` factory) pins every
  implementation — desktop `encryptedSqliteDriver`, mobile `expoSqliteDriver` — to
  identical observable behavior. It is blackbox (drives the port) and prod-faithful (each
  app runs it against its *own* real engine).
- **The contract test is the seam proof, which shrinks the emulator tier.** Once the
  mobile driver passes the contract test on the real engine, the shared `packages/*`
  repo/service logic above the port is already covered on desktop's engine — so the
  expensive emulator job needs only the *small contract suite*, not all ~27 integration
  suites.
- **iOS and Android are both first-class native targets.** The earlier iOS block — a local
  Xcode/Swift-tools gate on the SQLCipher dev client — was **lifted 2026-06-24** (local
  toolchain upgraded to Xcode 26.5 / Swift 6.2; see [`status.md`](../status.md)). Android
  emulator is verified working; the iOS dev-client boot is unblocked and verified as part of
  the mobile self-test increment. The shared code path is platform-identical, so one self-test
  runs unchanged on both.
- **The desktop template already exists.** `apps/desktop/test/support/encrypted-test-driver.ts`
  (`makeEncryptedTestDriver`) builds a throwaway encrypted temp-file DB through the
  production open path. The contract suite and any new tiers should follow it.
- **Native-platform E2E is a per-platform release gate.** Before the first release of
  Leapsake on a platform, the **crucial-flow catalog** must run automated and green on that
  platform's closest approximation (iOS sim · Android emulator · macOS/Windows/Linux native).
  Full details, the catalog, and the host matrix are in
  [`strategy.md` §6](./strategy.md#6-native-platform-e2e-crucial-flows-per-platform-as-a-release-gate).
- **v0.1 gate scope = iOS + Android + macOS** (owner decision). These three must pass the
  catalog before v0.1 ships; **Windows + Linux are deliberately deferred** to a later release
  (their gate is blocked on a host, not waived). Shipping a subset is supported and expected.
- **Vendor-neutrality is enforced by layer separation.** The *authoring* layer (the
  tool-agnostic flow catalog + open-source harness specs) is what we own; the *execution*
  layer (local / self-hosted VM / farm) is a swappable backend. Never bake a farm's
  proprietary API into a spec. (strategy.md §6.3.)
- **Mobile harness/E2E tool = Maestro (owner-confirmed 2026-07-16).** Blackbox YAML flows,
  single binary, no app instrumentation — best fit for principle #4, and *arch-agnostic*
  (it never touches the RN bridge, so New-Architecture/Fabric on RN 0.85 is a non-issue,
  where Detox's instrumented build is the riskiest part). Also the tool Expo's own E2E docs
  pave. Detox stays **in reserve** — its bridge-idle determinism is worth the gray-box cost
  *only if* an elaborate flow (sync/pairing) turns flaky; the tool-agnostic flow catalog
  makes a later switch cheap. Trade-offs: [`mobile-engine.md`](./mobile-engine.md#harness-tool-trade-offs).
  (Desktop E2E tool — Playwright/Electron — remains a lean, committed at the desktop-E2E step.)
- **`pnpm test` shape = tiered + a `test:all` umbrella (owner-confirmed 2026-07-16).** The fast
  local suite is the default (`pnpm test` = static + unit + integration, no emulator);
  `test:native` / `test:e2e` are the sim/emulator tiers; `test:all` runs everything reachable
  and surfaces the still-*blocked* native/E2E tiers explicitly (principle #6). A summary-printing
  orchestrator (`scripts/test-all.mjs`) owns the tier registry. Rejected: a single `pnpm test`
  that boots an emulator every run (fails the day-to-day-speed test).

### Open (need owner sign-off before building — captured, not yet decided)

These were surfaced but deliberately left open so the strategy is recorded first:

- **Desktop E2E tool: Playwright (Electron) — leaning, commit at the E2E step.** Owner
  decision: record the lean now, choose when the desktop E2E tier is actually built (mirrors
  the Maestro/Detox call above). Playwright's Electron support is open-source, launches the
  *built* app, drives the renderer DOM, and runs the same spec on macOS/Windows/Linux; the
  alternative is WebdriverIO + `wdio-electron-service`.
- **Windows/Linux E2E host provisioning.** *How* the deferred Windows/Linux gates get a
  vendor-neutral host (a local VM/NUC, a self-hosted runner, or — accepting some coupling — a
  device/VM farm). Not needed for the v0.1 gate (iOS+Android+macOS); decide when those
  platforms approach release.
- **Crucial-flow catalog membership.** The exact set of flows (strategy.md §6.1 proposes
  ~5–6: first-run, unlock+re-auth, create person+relationship, record milestone, pair second
  device, recovery code). Confirm/trim before the first harness implements it, so all
  platforms implement one agreed list.
- **Scope/order of the next increment.** Keystone-first (contract suite + desktop run +
  minimal Android native tier) **vs** full mobile trophy in one push. Leaning
  **keystone-first** — it lays the reusable native/E2E harness without boiling the ocean.
- **Contract-suite location & portability.** Framework-agnostic (authored against test
  globals, exported e.g. as `@leapsake/data/testing` so desktop-Vitest and the mobile
  runner share one spec) **vs** desktop-local now, generalize later. Leaning
  **framework-agnostic/shared** to prevent the two drivers from drifting.
- **Mobile unit runner.** Whether/when to stand up a headless RN unit runner (jest-expo or
  Vitest-RN) for mobile-specific component/hook logic — orthogonal to the driver, mostly
  shared logic already lives in `packages/*`.
- **Broad integration parity on mobile.** Whether to also run the ~27 integration suites
  on the mobile engine, or rely on the contract test as the seam proof (see settled finding
  above). Default lean: **rely on the contract test**; revisit if real drift appears.

## Task backlog (recommended order — the "keystone-first" reading)

> Sequenced so each step ships a working layer and nothing is thrown away. Confirm the
> open decisions above before starting the steps they gate.

1. **Author the shared `SqliteDriver` contract suite** — ✅ **done.** Framework-agnostic
   (shared-location decision landed that way): `runDriverContract(testApi, makeDriver)` in
   `packages/data/src/testing/driver-contract.ts`, exported via the `@leapsake/data/testing`
   subpath. Injects `{ describe, it, expect }` (no test-runner import) and a driver factory;
   each case provisions/tears down its own driver (no `beforeEach`/`afterEach` in the API)
   and creates its own throwaway table (schema-independent). 11 cases: run+get round-trip,
   `get()`→`undefined` on miss, `all` returns-all / `[]`-on-empty, `all` ordering, positional
   param binding, BLOB round-trip (type + bytes), multi-statement `exec`, transaction commit /
   rollback-and-rethrow / return-value, NULL round-trip.
2. **Wire it into desktop Vitest** — ✅ **done.** `apps/desktop/test/integration/driver-contract.test.ts`
   runs the spec against the production `encryptedSqliteDriver` via `makeEncryptedTestDriver`.
   Green under `pnpm test` (424 total); verified non-vacuous (breaking desktop `get`'s
   miss-coercion turns the suite red). Owner decision: desktop-encrypted driver only for now
   (no second node:sqlite factory yet).
3. **Stand up the mobile native test tier.** Two halves:
   - **3a — the in-app self-test (✅ done; iOS + Android).** A dev-only screen runs the
     *same* `runDriverContract` spec against the real `expoSqliteDriver` in-process and
     renders PASS/FAIL. Reached by deep link `leapsake://dev-selftest`; `__DEV__`-gated.
     Details in [`status.md`](../status.md). **Assertion contract for the harness (3b):**
     wait for `testID=driver-selftest-status`, assert its `accessibilityLabel` reads
     `PASS` (it is `FAIL` on any failed case *or* a zero-case run, and `ERROR` if the
     suite couldn't start). Key on that stable token, not the human-readable `N/N` count.
   - **3b — the blackbox harness (pending; gated on the Maestro/Detox decision).** Launch
     the app on a simulator/emulator, navigate the deep link, and assert the contract above
     from the command line. **This is what makes the mobile leg terminal** rather than a
     human reading the screen — until it lands, a newly-added contract case that mobile
     *fails* is only caught by a manual open (see *Keeping the contract from going stale*).
4. **Define `pnpm test` orchestration** — 🚧 **in progress** (decision landed: tiered +
   `test:all`). A summary-printing orchestrator (`scripts/test-all.mjs`) owns a tier registry
   and runs each layer's `pnpm test:*` script: `test:format` · `test:lint` · `test:types` ·
   `test:node` (unit+integration) as the ready tiers; `test:native` · `test:e2e` registered
   but **blocked** (reported ⏳, not silently skipped) until steps 6–10 build them. `pnpm test`
   = the fast local suite (static + node, no emulator); `pnpm test:all` = everything reachable.
   Fold the coverage/staleness gate (below) in here.
5. **Close the tsconfig-scope landmine** — make sure every new test dir is in a tsconfig's
   `include` (desktop's `test/` was silently excluded until fixed; mobile's tsconfig globs
   `**/*.ts`, but verify when adding a runner with different type deps).
6. **Author the crucial-flow catalog** — the tool-agnostic list of journeys (strategy.md
   §6.1), confirmed/trimmed with the owner, written so every platform's harness implements
   the *same* list. This is the E2E keystone; do it before any single harness encodes flows.
7. **Found the desktop E2E tier on macOS** — implement the catalog with Playwright/Electron
   against the *built* macOS app. Fully local and unblocked today, so this is the cheapest
   first native-E2E brick (ahead of iOS, which is Xcode-gated).
8. **Mobile E2E flows (Android)** on the chosen harness — implement the same catalog as real
   user journeys on the Android emulator. Reuses the harness from step 3.
9. **iOS native + E2E tier** once the local Xcode gate (16.4+) is lifted — harness/self-test
   are platform-identical, so mostly a build-target add. Completes the **v0.1 gate
   (iOS + Android + macOS)**.
10. **Windows / Linux E2E** — deferred past v0.1. Gated on provisioning a vendor-neutral host
    (open decision above); implement the *same* catalog, no spec changes.
11. **Trophy audit** — per app and package, enumerate which of static/unit/integration/E2E
    exist and where the gaps are; file the gaps as their own increments.
12. **Hosted-CI wiring** — when/if CI exists, port the local umbrella to it (emulator/native
    jobs for the E2E tiers; also the natural home for the Windows/Linux hosts). Out of scope
    while "local MacBook" is the assumption.

## Keeping the contract from going stale

The contract is the *single* spec both drivers run — desktop Vitest and the mobile
self-test screen each call `runDriverContract` rather than copying cases. So **which**
cases run never drifts: add a case to `driver-contract.ts` and it appears in both
consumers automatically, with no edit to the mobile screen, shim, or factory. The real
risk is the *contract* failing to grow when the driver does — two backends could diverge
on a new behavior with no case to catch it. Two levers, neither on the screen:

- **Coverage gate (the authoring forcer).** Run the contract under coverage against the
  driver implementations (`apps/mobile/db/expo-sqlite-driver.ts`,
  `apps/desktop/src/main/db/encrypted-sqlite-driver.ts`) and gate on ~full coverage of
  those files. Then a new driver code path *mechanically* fails CI until a contract case
  exercises it. Lives on the desktop Vitest run (terminal today); protects both drivers
  from one place. Not yet wired — fold into step 4 (`pnpm test` orchestration).
- **The CI matrix runs the one spec on both engines.** Desktop Vitest + the step-3b
  harness both consume `runDriverContract`, so a new case must go green on *both*. Until
  3b lands the mobile leg is a manual gate (a human opens the screen) — this is the
  remaining non-terminal dependency, and closing it is exactly what 3b is for.

The screen guards against one stale-signal trap itself: a zero-case run reads **FAIL**
(`total > 0` required for PASS), so a broken import or no-op shim can't show a vacuous
green that the harness would then assert.

> Future candidate cases (where unrelated native SQLite libs most plausibly diverge):
> type/affinity coercion (int/real/text, BigInt, empty-string vs NULL, boolean), large
> BLOBs, constraint-violation/error shape, nested-transaction behavior, collation/Unicode
> ordering, and any new `SqliteDriver` port method.

## The one rule (same as the rest of `plans/`)

**These are design docs, not a status board.** When work actually lands, record it in
[`status.md`](../status.md) and keep these docs as the stable *why/how*.
