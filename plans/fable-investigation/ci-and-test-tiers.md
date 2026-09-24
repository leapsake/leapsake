# Faster CI without losing confidence: push proof down the trophy

**Decision (owner, 2026-09-16):** the repo relies on E2E for things a lower tier should prove.
Move that proof into hook and integration tests, cut the cost the tests pay for no reason, and
let the E2E arc shrink to what only E2E can show. Measured on 2026-09-16, on the owner's machine.

CI here is local today: `pnpm test` in the loop, `pnpm test:all --strict --provision` at every
release rung. Hosted CI is [`remote-releases.md`](./remote-releases.md)'s job; this doc makes the
tiers cheaper wherever they run.

## Where the time goes

| Tier                                                            | Contents                                     |                                                                      Measured |
| --------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------: |
| Static (format, lint, typecheck, versions, icons, docs, bundle) | 7 scripts                                    |                                                                           ~6s |
| Vitest: 177 files, 2,373 tests                                  | unit + integration + web components          |                                                            25s wall, 145s CPU |
| Mobile native selftest, per platform                            | boot, `expo run` build, Metro, one flow      |                                                     minutes, mostly the build |
| Mobile E2E arc, per platform                                    | 7 flows, 57 assertions, five Argon2id passes | 07b + 07c alone are 2m46s; the arc with provisioning is well over ten minutes |

The inner loop is fine. The release gate is where the minutes are, and until
[`remote-releases.md`](./remote-releases.md) step 3 lands it pays for every platform whether or
not it ships.

Vitest runs files in parallel, so the wall clock is the longest file, not the sum, and the
longest files are `search-service` and `gifts` — real work against real SQLite, not a scrambler.
Nothing else here is worth chasing.

## Where the trophy is the wrong shape

The middle is right. The 64 suites in `apps/desktop/test/integration` are the shared-logic
tests for `data` and `core` against the real SQLite engine (745 tests); packages carry 1,051
unit tests; `packages/ui` has 244 component tests. The driver contract and its coverage forcer
are exactly the narrow, high-value gates the trophy asks for. **Do not touch any of that.**

Three places are inverted or empty:

1. **Mobile has no component or hook tier.** 116 pure tests in `apps/mobile/lib`, then
   nothing until Maestro. The E2E flow headers admit it: Flow 2 says the mobile component layer
   "has no test at any tier", and Flow 5 says `ChipTextField` and `ReminderForm` "are not
   tested anywhere below this". Those flows are not proving something only E2E can prove; they
   are standing in for a missing tier.
2. **The unlock loop and account flows are tested only by Maestro.** All of
   `apps/mobile/lib/core-context.tsx` (2,166 lines) is exercised only by flows 04, 07b and 07c.
   Those flows found four bugs, which is the best argument for E2E in the repo. Three were
   native UI (no repaint during derive, a missing accessibility id, the keyboard covering
   Unlock). One was a state-machine bug (the previous door's error not retracted on switch)
   that belongs in a hook test that runs in a second.
3. **Desktop's app glue has no tests and no E2E.** `router.tsx` (1,652 lines of inline
   loaders and actions), `Settings.tsx`, and `main/index.ts` are untested at any tier. Web
   component tests are the whole of desktop's UI confidence. Acceptable while desktop is a
   v0.2 platform; not acceptable when it ships.

## What the E2E arc is really carrying

| Flow                           | Only E2E can prove this?                                                                             | After the hook tier                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 01 First run mints nothing     | Yes: the out-of-band custody read is unique                                                          | Keep                                                    |
| 02 Person + relationship       | No: form → core → render is hook + integration territory                                             | Fold into one smoke                                     |
| 03 Milestone persists          | Weakly: it navigates away rather than relaunching, so it does not prove persistence across a process | Fold into the smoke, **with a real relaunch**           |
| 04 Account turns encryption on | Yes: a live store swap under a running app, plus custody bytes                                       | Keep                                                    |
| 05 Reminder @mention + #tag    | Half: the native text-input splice is E2E; the backlinks are integration                             | Keep the splice in the smoke, drop the backlink screens |
| 07b, 07c The doors             | Mostly: the pre-database boot path in the real runtime                                               | Keep, after the state machine is extracted              |

**A fidelity note the docs overstate.** `CONTRIBUTING.md` says E2E drives "the production app
binary on that OS image". It drives the dev client loading a dev-mode bundle from Metro
(`scripts/lib/mobile-harness.mjs` requires Metro and says so). That is not the artifact `rc`
uploads. See step 4.

**Before starting, read [`README.md`](./README.md) → _Where 3 and 4 pull on each other_**:
steps 1–3 here make `remote-releases.md`'s gate cheaper, and step 4 has an ordering constraint
against its step 7.

## Steps, each a commit

Order: 1 to 3 touch `core-context.tsx`, which is free to work in now that its relay half is
gone. 4 is independent of them and now has step 6's evidence behind it.

**Open decision, carried over from the KDF injection that landed:** whether to lower the cost in
E2E too. That needs a distinct `KDF_ALG` recorded in the account row so a cheap-recipe door can
never be mistaken for a real one, and it changes what the door files say. Worth minutes per arc.

### 1. Extract the unlock loop into `key-custody` ✅ landed 2026-09-24

`unlockStore(sidecars, ask)` in `packages/key-custody/src/unlock.ts`; both clients call it.
Only `ask` is injected (the real crypto is cheap under Vitest). Desktop's `open.test.ts` keeps
its file-level door cases; the loop's own cases are `packages/key-custody/test/unlock.test.ts`.

### 2. A mobile hook tier ✅ landed 2026-09-24 (the gate; form hooks follow `shared-form-logic.md`)

`apps/mobile/lib/use-recovery-gate.ts` and its jsdom test beside it. `apps/mobile` now carries
`@testing-library/react`, `jsdom` and `react-dom` (matching its `react`) as dev dependencies.

`apps/mobile` gets `@testing-library/react` and a jsdom docblock, the same setup
`packages/ui` uses, for **hooks only**: no React Native rendering, no `jest-expo`. What gets
tested:

- `useRecoveryGate` (extracted from `RecoveryGate` in `core-context.tsx`): which door shows,
  whether the error belongs to the door showing, when Unlock is enabled. This is the fourth
  bug 07b found, as a test that runs in milliseconds.
- The form hooks from [`shared-form-logic.md`](./shared-form-logic.md), which are already
  planned to live in `@leapsake/ui/headless` and are tested there. This step only adds the
  mobile-specific hooks that cannot live in `ui`.

The screens themselves stay untested below E2E. That is deliberate: once state is in hooks, a
screen is a rendering of hook output and the smoke flow is the right test for it.

### 3. Shrink the E2E arc

With 1 and 2 in place, replace 02, 03 and 05 with one `02-smoke.yaml`: add a person, add a
relationship, add a milestone, add a reminder with the `@` splice and a `#tag`, **relaunch the
app** (`subflows/relaunch.yaml` exists), and assert every one of those is still on screen. That
is fewer steps than today's three flows and proves more, because today nothing relaunches
before 04. The arc becomes 01 → smoke → 04 → 07c → 07b. Update `plans/testing/crucial-flows.md`
so the catalog matches the harness, and its rung table so `beta` reads "01, smoke, 04".

Do not remove 01, 04, 07b or 07c. Do not remove the out-of-band custody assertions or the
sabotage rule in `apps/mobile/maestro/README.md`.

### 4. Decide what binary E2E drives

An open decision, recorded here so the fidelity gap is not forgotten. Options:

- **Keep the dev client.** Cheapest; the selftest tier needs it anyway for its `__DEV__`
  route. The gate then proves a dev bundle, and the docs should say so honestly.
- **Release-configuration simulator build for E2E** (`expo run:ios --configuration Release`).
  Closer to what ships, no Metro in the harness, and the custody flows run against the real
  bundle. Costs a second build per run unless the selftest moves off `__DEV__`.

Evidence from the dependency audit ([`dependency-balance.md`](./dependency-balance.md), which
owns nothing else here — it looked at the harness, found **no library replaces it**, and left it
to this step): `scripts/lib/mobile-harness.mjs` is the repo's largest bespoke file, about 1,500
lines with no tests, and roughly a third of it exists only to drive the dev client — waiting on
Metro, settling the dev menu, deep-linking past the launcher. The second option deletes that
third; the first keeps it and its maintenance. The audit's recommendation is the second, with
the selftest route gated on a build-time flag instead of `__DEV__` so one build serves both
tiers.

Whichever is chosen, correct `CONTRIBUTING.md` → _The E2E release gate_ to describe it.

**What [`remote-releases.md`](./remote-releases.md) step 6 added to this, 2026-09-20.** Two days
of hosted-runner measurement is the strongest evidence this decision has, and it costs work to
re-derive:

- **The dev client caused three separate stoppers** that a release build would not have: the
  dev-menu onboarding sheet opening over the app, the launcher's entry vanishing mid-tap, and
  Metro bundle waits. Each cost a run to find. **The fourth, a LogBox banner over the tab bar,
  was a real bug** (expo's shared-object registry race, patched 2026-09-24) that a release build
  would have hidden, because a failed reminder regeneration only logs. That counts _for_ keeping
  console errors visible: whichever build E2E drives, a `console.error` should fail the flow.
- **Three `__DEV__` routes are load-bearing, not one.** `dev-selftest` (driver-contract tier)
  **and `dev-clear-dbkey` (Flows 07b and 07c)** both redirect home when `__DEV__` is false, so a
  release build breaks the custody flows too, silently. The build-time flag has to cover both.
- **Android is where the work is.** An iOS _simulator_ Release build needs no signing. Android's
  release build type deliberately has **no debug-key fallback**
  (`plugins/with-android-release-signing.js`; "a debug-signed release build is the failure that
  looks like success"), so an Android release-variant E2E build needs either the upload keystore
  on the runner or a new E2E variant signed with the debug key. That decision is this step's.
- **It will not fix dropped input by itself.** React Native does a JS round trip per keystroke,
  so a busy JS thread still loses characters; the flows keep their read-back retries
  (`maestro/subflows/type-checked.yaml`). Dropping Metro frees the thread, it does not remove it.
- **Two alternatives were checked and rejected.** _Pasting_: Maestro 2.8.0 has no
  `setText`/`replaceText`; `pasteText` only pastes what `copyTextFrom` took from an element
  already on screen, so arbitrary text needs the device clipboard set from outside the flow
  (`simctl pbcopy` on iOS; Android has no simple `adb` equivalent). _Seeding fixtures through a
  dev route_: worth little here, because the arc already shares state — later flows inherit Mary
  rather than retyping her — and the typing that remains is what each flow exists to prove.

### 5. Desktop, when it ships

Not now. When `desktop-packaging.md` lands, the desktop E2E harness is Playwright over the
packaged app, running the same catalog (`crucial-flows.md` is tool-agnostic on purpose), keyed
`mac` in the tier registry, and gated by [`remote-releases.md`](./remote-releases.md)'s per-cell readiness.
Before that, the cheapest confidence for desktop is the same move as mobile: the router's
inline loaders and actions become named functions that call `CoreApi`, and get integration
tests beside the existing 64.

## Not worth doing

Sharding Vitest, reordering static tiers, or moving the Astro site build out of the run. The
inner loop is already well under a minute.
