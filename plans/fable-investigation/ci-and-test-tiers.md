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

**Nothing on mobile's boot path is reachable only through E2E any more** (step 5): which
store opens, the keyless first run, and the recovery-door rewrite are tested in Vitest.

**A fidelity note the docs overstate.** `CONTRIBUTING.md` says E2E drives "the production app
binary on that OS image". It drives the dev client loading a dev-mode bundle from Metro
(`scripts/lib/mobile-harness.mjs` requires Metro and says so). That is not the artifact `rc`
uploads. See step 4.

## Steps, each a commit

**Order: 6 → 4b → 4c → 4d → 4e** (4a and 5 landed), with 7's parts slotted in anywhere.

- **6 is unblocked**: 5 has replaced the recovery-door rewrite test that 6 removes.
- **6 before 4c and 4d**, so each platform switch moves three flows, not five, and
  builds the merged Flow 4 on `lose-keys.yaml` once, rather than porting 07b and 07c only to
  delete them.
- **4c waits on `remote-releases.md` step 6 closing** ([`README.md`](./README.md) → _Where 3
  and 4 pull on each other_): the switch invalidates that step's numbers.
- **7's four parts** are independent of each other and of 4–6. 7c waits on the
  `RelationshipFields` row of [`shared-form-logic.md`](./shared-form-logic.md).
- Ideally all of 4–6 land before `remote-releases.md` step 7 wires the gate into `ci.yml`:
  every push pays for whatever the gate costs from then on.

**Open decision, carried over from the KDF injection that landed:** whether to lower the cost in
E2E too. That needs a distinct `KDF_ALG` recorded in the account row so a cheap-recipe door can
never be mistaken for a real one, and it changes what the door files say. Worth minutes per arc.

### 4. E2E drives a release-configuration build

**Decided (owner, 2026-09-24):** E2E drives a **release-configuration build** of the app, not
the dev client. **iOS first, then Android, and Android is part of this step, not a follow-up.**
**No build-time budget:** fidelity outranks run time; if the gate gets slow, pull other levers
(the KDF question above, caching, fewer flows) rather than go back to the dev client.

**Why.** The gate exists to protect data at `rc`, and today it proves a dev bundle served by
Metro, which is not what `rc` uploads. Release-only failures (Hermes bytecode, minification,
code behind `__DEV__`) are invisible to it. And the dev client is itself a source of flake:
[`remote-releases.md`](./remote-releases.md) step 6 measured three stoppers that came only
from it (the dev-menu onboarding sheet over the app, the launcher entry vanishing mid-tap,
Metro bundle waits). About a third of `scripts/lib/mobile-harness.mjs` (1,713 lines, no tests)
exists only to drive the dev client, and this step deletes it.

**The split, by activity:** the harness (`pnpm test:e2e`, `pnpm test:native`) always drives the
release build. Driving the app by hand and scratch flows keep the dev client and Metro, where
quick JS reloads actually help (`apps/mobile/maestro/README.md` → _Driving the app by hand_).

**The three decisions this step rests on:**

1. **Test-only screens are gated by a build-time flag, and a release check refuses any store
   bundle that contains them.** The three `__DEV__` routes (`dev-selftest`, `dev-clear-dbkey`,
   `dev-export`) currently redirect home in any release build, which would silently break
   `test:native` and the door flows. They move to a build-time flag (for example
   `EXPO_PUBLIC_E2E=1`) that only the E2E build sets. ⚠️ **`dev-clear-dbkey` deletes the
   database key and is reachable by deep link from any app or website**, so the flag leaking into
   a store build must be impossible, not merely unlikely: `scripts/release/` gains a preflight
   that inspects the bundle about to be uploaded (for both platforms) and fails if any test-only
   route is present. Prove it bites by building once with the flag on and watching it refuse.
2. **On iOS, key loss comes from outside the app; the route is never in an iOS build.**
   `xcrun simctl keychain <udid> reset`, reached from a flow as Maestro's `clearKeychain` step,
   replaces `dev-clear-dbkey` on iOS. That loses the **whole** keychain (db-key, recovery key, device
   id, enclave), which is what a new phone or the transfer to the company account actually
   costs someone, so it also exercises the device-identity repair no flow reaches today. Gate
   `dev-clear-dbkey` so an iOS bundle cannot contain it at all (flag **and** Android only).
   **Android keeps the route behind the flag**, because nothing outside an Android app can
   delete its keystore entries on a non-debuggable build. There, the flows tap **Clear
   everything**, not **Clear db-key**, so both platforms rehearse the same disaster. (Root on an
   emulator image might allow an outside reset later. That is unverified, and not needed for
   this step.)
3. **Android E2E uses a new `e2e` build type, signed with the debug key.** It matches `release`
   in everything that changes behaviour (minified, Hermes, JS bundled in, no dev tools) and
   differs only in its signature. The upload key stays off CI runners. Play rejects a
   debug-signed build, so an `e2e` build cannot be uploaded by accident, and
   `plugins/with-android-release-signing.js`'s rule that `release` never falls back to the debug
   key stays exactly as it is. Keep the same `applicationId`, so the Maestro `appId` and the
   harness paths do not fork. The signature does not affect the Android Keystore or anything
   else the flows exercise; that it is signed correctly for Play is the upload step's check.

**Two consequences to design for:**

- **Key loss happens mid-flow, with no shell.** The door acts need the key lost partway
  through one `maestro test` process, because the phrase it captured cannot leave that process
  (step 6). A flow cannot run a shell command, and does not need to. Maestro 2.8.0's built-in
  **`clearKeychain`** step (iOS only) runs `xcrun simctl keychain <udid> reset`, the same
  command the harness's wipe uses. `subflows/lose-keys.yaml` branches with `when: platform:`:
  - **iOS:** `stopApp` → `clearKeychain` → `launchApp`. Stop first, so the next launch reads an
    empty keychain rather than a key still held in memory.
  - **Android:** open `leapsake://dev-clear-dbkey` → **Clear everything** → relaunch.

  Verify in 4c: the app sees a reset made mid-session without the simulator rebooting (the
  wipe only ever resets before a first launch), and `launchApp` behaves in a release build
  (`ios-prepare.yaml`'s warning against it is about the dev client discarding Metro's bundle).
  **For any future host-side need,** check Maestro's built-in host steps first (`clearKeychain`,
  `clearState`, `addMedia`, permissions, location). `runScript`'s `http` client calling an
  endpoint the harness serves also works in 2.8.0, but it adds a server to the harness. Use it
  only when no built-in fits, and say why in the commit.
- **Release builds show no LogBox, so a `console.error` would stop failing anything.** That is
  how the shared-object race was found (a failed reminder regeneration only logs). Under the E2E
  flag, make any `console.error` fail the flow: for example, render a marker with a `testID` the
  harness asserts is absent after every flow. Keep it inside the flag, so store builds carry
  none of it.

**Commits** (interleaved with 5 and 6 per _Order_ above):

- **4a. The flag and the release check. ✅ Landed 2026-09-24.** Each test-only screen lives in
  `apps/mobile/test/screens/` and carries `TEST_ONLY_MARKER`. Its route in `app/` loads it
  only when `__DEV__ || process.env.EXPO_PUBLIC_E2E === "1"` (`dev-clear-dbkey` also needs
  Android), decided at bundle time, so a store bundle leaves the module out.
  `scripts/release/test-only.mjs` refuses an `.ipa` or `.aab` whose bundle contains the marker.
  **Keep the condition written inline in each route:** it is only removed at build time while
  Metro can fold it in place, and a shared constant imported from another module would not be.
  To check a change to it in about ten seconds, run `pnpm exec expo export --platform <p>` with
  and without `EXPO_PUBLIC_E2E=1`, and grep the `.hbc` for the marker.
- **4b. `console.error` fails a flow**, under the flag.
- **4c. iOS switches.** The harness builds a Release-configuration simulator app with the flag
  and drops Metro, the launcher and dev-menu handling on the iOS path (`ios-prepare.yaml` should
  shrink to a readiness wait, or go). Key loss goes through `lose-keys.yaml`. The flows can use
  `launchApp` again (`ios-prepare.yaml`'s warning about it is specific to the dev client). Arc
  green, and **record the build time and the arc time in the commit message**, as numbers, not as
  a gate.
- **4d. The Android `e2e` build type**, the Android half of `lose-keys.yaml` (Clear everything),
  and the Android path switched. The harness's `run-as` step for dev-menu prefs goes: `run-as`
  needs a debuggable build, and there is no dev menu left to settle.
- **4e. Delete what is left of dev-client handling in `mobile-harness.mjs`**, and correct the
  docs: `CONTRIBUTING.md` → _The E2E release gate_ (its "production app binary" sentence becomes
  true), `apps/mobile/maestro/README.md` (_Run it_ and the dev-client traps), and
  `apps/mobile/README.md` where it says the self-test needs a dev-client build.

**With step 6.** Either can land first. Whichever lands second uses `lose-keys.yaml`. Step 5's
tests must cover both key-loss shapes: db-key only (the recovery key survives, so the recovery
door is rewritten) and everything lost (no recovery key, so "read, never mint" leaves the door
as it was).

**It will not fix dropped input by itself.** React Native does a JS round trip per keystroke,
so a busy JS thread still loses characters; the flows keep their read-back retries
(`maestro/subflows/type-checked.yaml`). Dropping Metro frees the thread, it does not remove it.

**Two alternatives were checked and rejected.** _Pasting_: Maestro 2.8.0 has no
`setText`/`replaceText`; `pasteText` only pastes what `copyTextFrom` took from an element
already on screen, so arbitrary text needs the device clipboard set from outside the flow
(`simctl pbcopy` on iOS; Android has no simple `adb` equivalent). _Seeding fixtures through a
dev route_: worth little here, because the arc already shares state (later flows inherit Mary
rather than retyping her), and the typing that remains is what each flow exists to prove.

### 5. Extract mobile's boot sequence out of `CoreProvider`

**✅ Landed 2026-09-24.** `openActiveStore` in `apps/mobile/lib/open-active-store.ts` takes
its IO as ports (key store, roster, doors, store opener, the `ask` bridge) and decides what
opens and with which key; `CoreProvider` calls it with the expo adapters
(`apps/mobile/db/open-store.ts`). The "read, never mint" rewrite is `resealRecoveryDoor` in
`packages/key-custody/src/recovery-door.ts`, which desktop's `open.ts` calls too.
`apps/mobile/lib/open-active-store.test.ts` covers a keyless first run with zero key-store
writes, an Authenticated open without asking, a password unlock after losing everything (door
untouched) and after losing only the db-key (door resealed under the surviving key; both
still open with the original phrase), and a phrase unlock re-adopting the recovery key.
Desktop's unlock condition (the file is ciphertext) still differs from mobile's (a door
exists); only the rewrite is shared.

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
