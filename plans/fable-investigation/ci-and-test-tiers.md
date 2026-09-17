# Faster CI without losing confidence: push proof down the trophy

**Decision (owner, 2026-09-16):** the repo relies on E2E for things a lower tier should prove.
Move that proof into hook and integration tests, cut the cost the tests pay for no reason, and
let the E2E arc shrink to what only E2E can show. Measured on 2026-09-16, on the owner's machine.

CI here is local: `pnpm test` in the loop, `pnpm test:all --strict --provision` at every release
rung above alpha. There is no hosted CI, and this doc does not add one.

## Where the time goes

| Tier                                                            | Contents                                     |                                                                      Measured |
| --------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------: |
| Static (format, lint, typecheck, versions, icons, docs, bundle) | 7 scripts                                    |                                                                           ~6s |
| Vitest: 177 files, 2,373 tests                                  | unit + integration + web components          |                                                            25s wall, 145s CPU |
| Mobile native selftest, per platform                            | boot, `expo run` build, Metro, one flow      |                                                     minutes, mostly the build |
| Mobile E2E arc, per platform                                    | 7 flows, 57 assertions, five Argon2id passes | 07b + 07c alone are 2m46s; the arc with provisioning is well over ten minutes |

The inner loop is fine. The release gate is where the minutes are, and until
[`release-targets-per-rung.md`](./release-targets-per-rung.md) lands it pays for every
platform whether or not it ships.

The Vitest figure is post-KDF-injection (landed 2026-09-16; it was 36s wall, 288s CPU). Vitest
runs files in parallel, so the wall clock is the longest file, not the sum, and the longest
files are now `search-service` and `gifts` — real work against real SQLite, not a scrambler.
`apps/server/test/relay.test.ts` is deleted by [`relay-removal.md`](./relay-removal.md). Nothing
else here is worth chasing.

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
uploads. See step 5.

## Steps, each a commit

Order: 1 is independent of everything. 2 to 4 need
[`relay-removal.md`](./relay-removal.md) first, because they touch `core-context.tsx` and the
relay code is most of it.

**Open decision, carried over from the KDF injection that landed:** whether to lower the cost in
E2E too. That needs a distinct `KDF_ALG` recorded in the account row so a cheap-recipe door can
never be mistaken for a real one, and it changes what the door files say. Worth minutes per arc.

### 1. Gate follows the targets

[`release-targets-per-rung.md`](./release-targets-per-rung.md). Listed here so the CI picture is
complete; that doc owns it.

### 2. Extract the unlock loop into `key-custody`

Desktop already has the right shape: `openAppDatabase` in `apps/desktop/src/main/db/open.ts`
runs the `for (;;)` unlock loop with `requestUnlock` injected, and `apps/desktop/test/open.test.ts`
drives it with a scripted answerer. Mobile has the same loop written a second time inside
`CoreProvider` in `apps/mobile/lib/core-context.tsx`, where nothing but Maestro can reach it.

Lift the loop out of both into `unlockStore(ports)` in `packages/key-custody/src/unlock.ts`,
where `ports` is `{ doors, ask, openWithPassword, openWithPhrase }` and `ask` is the one thing
each platform supplies. Move desktop's existing cases into `packages/key-custody/test` and add
the mobile-only ones: wrong password then right password; wrong phrase rejected fast; a door
the store does not have refused with the right message. These are exactly the cases 07b and
07c step through at a minute each.

### 3. A mobile hook tier

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

### 4. Shrink the E2E arc

With 2 and 3 in place, replace 02, 03 and 05 with one `02-smoke.yaml`: add a person, add a
relationship, add a milestone, add a reminder with the `@` splice and a `#tag`, **relaunch the
app** (`subflows/relaunch.yaml` exists), and assert every one of those is still on screen. That
is fewer steps than today's three flows and proves more, because today nothing relaunches
before 04. The arc becomes 01 → smoke → 04 → 07c → 07b. Update `plans/testing/crucial-flows.md`
so the catalog matches the harness, and its rung table so `beta` reads "01, smoke, 04".

Do not remove 01, 04, 07b or 07c. Do not remove the out-of-band custody assertions or the
sabotage rule in `apps/mobile/maestro/README.md`.

### 5. Decide what binary E2E drives

An open decision, recorded here so the fidelity gap is not forgotten. Options:

- **Keep the dev client.** Cheapest; the selftest tier needs it anyway for its `__DEV__`
  route. The gate then proves a dev bundle, and the docs should say so honestly.
- **Release-configuration simulator build for E2E** (`expo run:ios --configuration Release`).
  Closer to what ships, no Metro in the harness, and the custody flows run against the real
  bundle. Costs a second build per run unless the selftest moves off `__DEV__`.

Whichever is chosen, correct `CONTRIBUTING.md` → _The E2E release gate_ to describe it.

### 6. Desktop, when it ships

Not now. When `desktop-packaging.md` lands, the desktop E2E harness is Playwright over the
packaged app, running the same catalog (`crucial-flows.md` is tool-agnostic on purpose), keyed
`mac` in the tier registry, and gated by [`release-targets-per-rung.md`](./release-targets-per-rung.md).
Before that, the cheapest confidence for desktop is the same move as mobile: the router's
inline loaders and actions become named functions that call `CoreApi`, and get integration
tests beside the existing 64.

## Not worth doing

Sharding Vitest, reordering static tiers, moving the Astro site build out of the run, or adding
a hosted CI. The inner loop is already well under a minute.
