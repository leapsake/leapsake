# Faster CI without losing confidence: push proof down the trophy

**Decision (owner, 2026-09-16):** the repo relies on E2E for things a lower tier should prove.
Move that proof into hook and integration tests, cut the cost the tests pay for no reason, and
let the E2E arc shrink to what only E2E can show.

**Decision (owner, 2026-09-24):** "crucial" is now defined by an **admission rule**, not by
"no lower tier reaches it" — that wording rewarded putting logic where only E2E could see it.
The rule is written once, in [`../testing/crucial-flows.md`](../testing/crucial-flows.md) →
_What earns a flow here_; read it before any step below. Under it, the arc becomes three
flows (01 → smoke → 04-with-both-doors), and the four one-off flows in `apps/mobile/maestro/`
leave the E2E tier.

CI here is local today: `pnpm test` in the loop, `pnpm test:all --strict --provision` at every
release rung. Hosted CI is [`remote-releases.md`](./remote-releases.md)'s job; this doc makes the
tiers cheaper wherever they run.

**Before starting, read [`README.md`](./README.md) → _Where 3 and 4 pull on each other_**:
this doc's steps make `remote-releases.md`'s gate cheaper, and step 4 has an ordering
constraint against its step 7.

## Where things stand

**Already landed (2026-09-24), so do not redo it:**

- The unlock loop is `unlockStore` in `packages/key-custody/src/unlock.ts`, used by both
  clients. `packages/key-custody/test/unlock.test.ts` covers both doors, a wrong secret of
  each kind, and the doors' independence.
- A mobile hook tier: `apps/mobile/lib/use-recovery-gate.ts` with a jsdom test beside it
  (`@testing-library/react`, hooks only, no React Native rendering). Which door shows, error
  retraction on switch, and Unlock re-enabling after a failure are tested there.
- `e2e/02-smoke.yaml` replaced the old flows 02, 03 and 05, and relaunches before asserting.

**The arc today** is 01 → smoke → 04 → 07c → 07b, about 13 minutes on iOS, of which the two
door flows are 7. `scripts/test-e2e.mjs` runs the whole arc at **every** rung; the rung table
in `CONTRIBUTING.md` grades which flows must be green, not which run.

**What each file in `apps/mobile/maestro/` is carrying, judged by the admission rule:**

| File                                   | Verdict                                                                                                                         | Step |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `e2e/01-first-run.yaml`                | Keep. Cheap, and it is the arc's reset                                                                                          | —    |
| `e2e/02-smoke.yaml`                    | Keep. The one every-layer-at-once flow, across a relaunch                                                                       | —    |
| `e2e/04-create-account.yaml`           | Keep, and absorb both doors                                                                                                     | 6    |
| `e2e/07c-password-door.yaml`           | Merge into 04. Its happy path already runs inside 07b; its negatives are `unlock.test.ts`'s                                     | 6    |
| `e2e/07b-phrase-door.yaml`             | Merge into 04. Most of its cost is re-creating an account only to see the phrase                                                | 6    |
| `driver-selftest.yaml`                 | Keep. It is unit tests that need the real engine, not E2E                                                                       | —    |
| `ios-prepare.yaml`, `ios-autofill.yaml` | Harness, not tests                                                                                                              | —    |
| `store/`                               | Screenshot tooling, not tests                                                                                                   | —    |
| `staged-gifts.yaml`                    | Leave the tier. **It has never been run**                                                                                       | 7a   |
| `unpublished-people.yaml`              | Leave the tier. Its claims are query behaviour                                                                                  | 7b   |
| `anniversary-partner.yaml`             | Leave the tier. Its claims are form state                                                                                       | 7c   |
| `global-nav.yaml`                      | Leave the tier. Its claims are route and header configuration                                                                   | 7d   |

None of the four one-off flows is wired into any runner, so retiring them costs no gate
anything; what they hold is claims that deserve a test somewhere cheaper.

**The one piece still reachable only through E2E** is the boot orchestration left in
`CoreProvider` (`apps/mobile/lib/core-context.tsx`): choosing which store to open, the
first-run path that must mint no keys, and the recovery-door rewrite after an unlock ("read,
never mint"). Desktop's equivalent is `apps/desktop/src/main/db/open.ts`, tested by
`apps/desktop/test/open.test.ts`. Step 5 gives mobile the same.

**A fidelity note the docs overstate.** `CONTRIBUTING.md` says E2E drives "the production app
binary on that OS image". It drives the dev client loading a dev-mode bundle from Metro
(`scripts/lib/mobile-harness.mjs` requires Metro and says so). That is not the artifact `rc`
uploads. See step 4.

## Steps, each a commit

**Order.** 4 is independent of everything else here. **6 depends on 5**: 6 removes the only
test of the recovery-door rewrite, and 5 is what replaces it. 7's four parts are independent of
each other and of 4–6; 7c waits on the `RelationshipFields` row of
[`shared-form-logic.md`](./shared-form-logic.md). Ideally 5 and 6 land before
`remote-releases.md` step 7 wires the gate into `ci.yml`, for the same reason 4 should: every
push pays for whatever the gate costs from then on.

**Open decision, carried over from the KDF injection that landed:** whether to lower the cost in
E2E too. That needs a distinct `KDF_ALG` recorded in the account row so a cheap-recipe door can
never be mistaken for a real one, and it changes what the door files say. Worth minutes per arc.

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


### 5. Extract mobile's boot sequence out of `CoreProvider`

**Why:** it is the last thing only E2E can reach, and step 6 cannot drop 7c's and 7b's
separate acts until the behaviour they guard is tested here.

**What moves.** The part of the bootstrap effect in `CoreProvider` that decides _what opens and
with what key_: read the roster and pick `stores/local/` or `stores/<accountId>/`, read the
doors, ask for a secret through `unlockStore` when the enclave key is gone,
`establishKeySession`, and the recovery-door rewrite after an unlock. It becomes a named
function with its IO passed in (key store, store opener, doors, roster) and returns what the
provider sets in state. The provider keeps React state, the `ask` bridge to `RecoveryGate`, and
everything after the core is built (holiday seeding, reminders, notifications).

**Where it goes.** Mirror desktop's split: whatever both clients do identically — the rewrite
rule especially — goes in `packages/key-custody` beside `unlockStore` and is tested there, the
way step 1 did it. Only expo-specific IO stays in `apps/mobile`. Compare with
`apps/desktop/src/main/db/open.ts` before writing anything; if desktop has the same sequence
inline, extracting it once for both is the preferred outcome.

**The tests it must carry**, each a claim E2E holds today:

- **A first run mints nothing.** Against a fake key store that records writes: no store, no
  roster → a plaintext store at `stores/local/`, and **zero** key-store writes. This is the
  Keychain row `crucial-flows.md` defers on device, so it is a real gain, not a move.
- **A password unlock leaves the phrase door opening.** After a password unlock, the rewritten
  recovery door still opens with the original phrase. This is the clause 07b exists for
  (`e2e/07b-phrase-door.yaml`'s third act has the reasoning): a rewrite that sealed under a
  freshly minted recovery key would pass every other check.
- **A phrase unlock re-adopts the recovery key** and writes it to the key store.
- **An Authenticated store with its enclave key present opens without asking.**

**Also:** `e2e/07c-password-door.yaml`'s header says the unlock loop lives in
`core-context.tsx`; that stopped being true with step 1. It is deleted in step 6, so do not
fix it here.

**Done when:** the four tests pass under `pnpm exec vitest run`, `CoreProvider` calls the new
function, and the arc is green on one platform (it exercises the same path end to end).

### 6. Merge 07c and 07b into Flow 4

**Depends on 5.** Once 5 lands, what the two door flows prove that nothing else does is one
thing: **the boot gate opens a real store in the real runtime, by each door.** Negatives are
`unlock.test.ts`'s and `use-recovery-gate.test.ts`'s; the rewrite is step 5's.

**The shape.** Flow 4 already watches the phrase appear, so it captures it (07b's `repeat` +
`copyTextFrom` + `output` pattern, `apps/mobile/maestro/README.md` → _Capturing a secret the app
shows once_). The door acts then run **in the same `maestro test` process** — as subflows of
Flow 4, so `output.phrase` survives — in this order:

1. create the account and capture the phrase (today's 04, unchanged),
2. `dev-clear-dbkey`, relaunch, unlock with the **password**, Mary is readable,
3. `dev-clear-dbkey`, relaunch, unlock with the **phrase**, Mary is readable.

Password first, then phrase, is what makes act 3 also prove step 5's rewrite rule end to end.
No UI negatives: wrong secrets are covered two tiers down, and each wrong password costs an
Argon2id pass. What disappears: 07b's factory reset, its second account and second store
conversion, and the arc's ordering constraints (`scripts/test-e2e.mjs`'s long comment about
07c following 04 and 07b running last).

**Check:** `custodyAuthenticated` runs after the flow goes green, which is now after two
unlocks rather than straight after creation. It should still hold (same store, same roster,
both doors); confirm it rather than assume it.

**Measure** the arc before and after on iOS and record both numbers in the commit message.

**Update in the same commit:**

- `scripts/test-e2e.mjs`: the flow list and its ordering comment.
- `plans/testing/crucial-flows.md`: Flow 4 gains the two door acts; 7b and 7c are folded into
  it; 7a stays as the one Flow 7 variant; the matrix loses two rows.
- `CONTRIBUTING.md` → _The E2E release gate_: the rung table and the paragraph after it both
  name 7b and 7c.
- `apps/mobile/maestro/README.md` → _`e2e/`_: "Two of the seven do not fit…" and every mention
  of 07b and 07c.
- `apps/mobile/maestro/store/README.md` says `base.mjs` runs "flows 01, 02, 03, 05"; it runs 01
  and 02. Fix it while there.

**⚠️ Open, ask the owner before committing:** the rung table grades Flow 4's _screen_ half at
`beta` and the doors at `rc`. Since the runner already runs everything at every rung, merging
does not change what runs. It does change whether the table can still name the doors
separately. Either keep the grading as prose ("Flow 4's door acts gate at `rc`") or collapse
it. It is a policy line dated 2026-08-28, so it is not this step's to decide.

### 7. Retire the one-off flows

Four independent commits. None of these flows is wired into a runner. Each commit: write or
confirm the lower-tier test, sabotage it once to prove it bites (the flow headers name the
sabotage), delete the flow, and delete its entry in `apps/mobile/maestro/README.md`'s opening
list. When the last one goes, that list is the self-test and the two iOS helpers.

**7a. `staged-gifts.yaml`: delete it.** It has never been run, so it provides no confidence
today. Its two claims: "the create form's Save writes staged gifts" (sabotage:
`applyEntityForm` skips `value.gifts`) and "the row's tick writes where it stands" (sabotage:
`GiftsSection`'s `setGiven` a no-op). Check `apps/desktop/test/integration/gifts.test.ts` for
the first. The second is a mobile component calling a core method: if a hook falls out of
`shared-form-logic.md`'s gift row, test it there; otherwise, accept that the smoke is enough.

**7b. `unpublished-people.yaml`.** `apps/desktop/test/integration/unpublished-people.test.ts`
and `entity-repo.test.ts` already exist. Confirm the flow's four claims are there: an
unpublished person is (1) created by a relationship save, (2) absent from `list()`, (3) absent
from the relationship picker's query, (4) found by search as "matched on" through their
subject (`search-service.ts`'s `attached` pass). Add whichever is missing, then delete the flow.
Accepted residual risk: a screen calling the wrong query.

**7c. `anniversary-partner.yaml`.** Its claims are `PartyField`/`PartnerField` state (Edit
appears only once a role is picked; Save after Edit revises that relationship rather than
adding a second; Remove on a person Edit wrote deletes them). They belong in the headless hook
[`shared-form-logic.md`](./shared-form-logic.md) plans for `RelationshipFields`; the writes are
already `apps/desktop/test/integration/link-partner.test.ts`'s. **Waits on that hook.** Keep the
flow's vCard-seeding recipe (its header) as a few lines in `apps/mobile/README.md`'s hand-driving
section: it is how you get a dated contact onto a simulator.

**7d. `global-nav.yaml`.** Its claims are configuration: four tabs; each tab root's ➕ targets
the create route for that tab's content; catalogs reached from browse tiles sit in the tab
navigator (bar visible, no Back); each catalog's 🔍 narrows search to its kinds, People's to two.
The header wiring is in `apps/mobile/app/(tabs)/_layout.tsx`; the chip kinds are in
`lib/search-categories.ts` (already tested). If the ➕ targets are inline JSX, lift them to a
table beside `search-categories.ts` and test the table. The Back claims hold up
`components/AppHeader.tsx`'s single row: Back and the 🔍/➕ pair never share it, because the
glyphs are declared only on tab-navigator screens. That is structural, so assert the structure
(no route outside `(tabs)` declares header actions), not the rendered Back. After a navigation
redesign, check it on the simulator with a scratch flow, and do not commit that flow.

### 8. Desktop, when it ships

Not now. When `desktop-packaging.md` lands, the desktop E2E harness is Playwright over the
packaged app, running the same catalog (`crucial-flows.md` is tool-agnostic on purpose), keyed
`mac` in the tier registry, and gated by [`remote-releases.md`](./remote-releases.md)'s per-cell readiness.
Before that, the cheapest confidence for desktop is the same move as mobile: the router's
inline loaders and actions become named functions that call `CoreApi`, and get integration
tests beside the existing 64.

## Not worth doing

Sharding Vitest, reordering static tiers, or moving the Astro site build out of the run. The
inner loop is already well under a minute.
