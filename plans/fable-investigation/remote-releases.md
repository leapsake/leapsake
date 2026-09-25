# Releases from the remote: a tag appears, the pipeline ships it

**Decision (owner, 2026-09-18).** Releases stop being something a person runs on a local machine.
The trigger is a git tag arriving at the remote; a hosted pipeline runs the gate, builds every
platform, and only then uploads any of them. The local path survives as a guarded backdoor.
The version model changes so the pipeline never has to write to `main`. Alpha, beta and rc
become channels rather than a one-way ladder.

**Written to be read cold.** Every decision is recorded with its reason so an agent arriving with
no context can execute one step without re-deriving or re-litigating. Steps are ordered; each is
one agent's unit of work and lands as small commits. Nothing here is a design record: **delete
this doc when the last step lands**, and move anything durable next to the code.

**Read first:** [`../../AGENTS.md`](../../AGENTS.md) (the comment rule, the agent-shell SQLite
hazard), [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) → _Versioning and releases_ and _The E2E
release gate_ (the rules this changes), and the header of `scripts/release/index.mjs` (the model
this replaces). Do not read `plans/android-pipeline.md` for the release mechanics; it predates
this and its `--only` two-step is retired.

---

## The decisions, and why

Nine questions were put to the owner on 2026-09-18. These are the answers. **Do not reopen
them**; if a step cannot be done under one of them, stop and say so rather than bending it.

| #   | Question                                  | Decision                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | How does a release start?                 | **A release tag pushed to the remote.** A dispatch button on the host is sugar that creates the tag. The local command survives as a backdoor with safeguards (typed confirmation, and it refuses to upload anything whose tag the remote cannot see).     |
| 2   | Where does the version live?              | **Manifests carry only the core (`0.1.0`). The tag carries the rest (`v0.1.0-beta.10`).** No "Cut X" commit; the pipeline never writes to `main`. Condition: versions must stay _visible_ — see _Keeping the version visible_.                              |
| 3   | Can alpha follow beta on one core?        | **Yes: channels, not a ladder.** Each of alpha/beta/rc counts up independently per core. **Only a final closes a core.** The core never goes below the highest core ever tagged.                                                                            |
| 4   | What happens when something fails midway? | **Build every platform, then upload every platform.** A build failure spends nothing and the tag is deleted. An upload failure after another upload succeeded is resumed, never rolled back: re-run the failed job with the same artifact and build number. |
| 5   | A platform that cannot ship a rung yet?   | **Ship the ready ones.** Readiness is per platform × rung. A blocked cell is printed with its reason and skipped; a ready cell that fails a check is a failure. All-or-nothing applies to the ready set.                                                    |
| 6   | Where do the tests run?                   | **Split by platform on GitHub-hosted runners:** iOS on macOS, Android on Linux, one job that requires both before any upload. **The macOS runner is accepted lock-in**, written down as such. A self-hosted Mac is off the table for now.                   |
| 7   | How host-specific may the pipeline be?    | **Workflow files stay dumb.** Every step is one command from the repo. The scripts decide everything, including which jobs exist. Portability rules below.                                                                                                  |
| 8   | Who approves `final`?                     | **`final` is its own deliberate trigger**, as today: it builds nothing, releases what the store already approved, and tags the commit that went live. No host approval feature.                                                                             |
| 9   | What runs when?                           | Push or PR: the fast tiers. Push to `main`: fast tiers plus the device tiers per platform, so `main` is always known-releasable. Tag: the release. The owner does not have to start using PRs; the same workflow fires for both.                            |

**What is explicitly not feasible, so no step tries:** undoing a store upload (a build number is
spent the moment it lands; a TestFlight distribution cannot be unsent; a Play rollout can be
halted, not unpublished); one machine running both device tiers on hosted runners (the Android
emulator needs hardware virtualization, which the Apple-silicon macOS runners are not believed to
offer — step 6 verifies); a hands-off `rc`/`final` (Apple's review and Play's tester clock sit in
the middle).

**Why decision 5 needs a per-cell status when `requires` already exists.** A `requires` check
failing means _misconfigured_ (a missing credential, a wrong key role) and must fail the release;
a rung a platform is _not allowed to ship yet_ (Play has not granted production access) is
policy, must not fail the release, and must not be silently waived either. Those are different
answers and need different expressions. `requires` keeps the first; a per-cell
`status: "blocked"` with a `note` carries the second.

### Portability rules (decision 7)

The host today is GitHub. The next could be GitLab, Codeberg/Forgejo, or anything with a runner.

- Every workflow step is **one command from the repo**. No shell logic, no expressions beyond
  passing a job output into a flag, no marketplace actions beyond checkout, Node setup, artifact
  upload/download, and a cache action.
- **The scripts produce the job matrix** (`pnpm release plan --json`). Adding a platform never
  touches YAML.
- **Receipts stay as git notes** (`refs/notes/releases`), which are host-neutral. Attaching
  artifacts to a host's Release page is optional sugar, never the record.
- **The trigger is a tag push.** Every host fires on one. The dispatch button is a separate, tiny,
  host-specific file that only creates the tag.
- **Secrets reach the scripts as environment variables and files**, exactly as `.env.example`
  already specifies. No host identity features (OIDC), no host attestation actions.
- **The scripts never read `GITHUB_*`** except the existing `GITHUB_SHA` fallback in
  `apps/mobile/app.config.ts`, which stays. The workflow passes the tag explicitly.
- **Skipping prompts keys off `CI=true`**, which GitHub, GitLab and Forgejo all set.
- **The one accepted lock-in** is GitHub's hosted macOS runners (free for a public repo). Write it
  down in `CONTRIBUTING.md` as the thing to replace on a move.

---

## Facts an agent needs (verified 2026-09-18 against the code)

- **Today's model.** `pnpm release <stage>` computes the next version from the tag list, writes it
  into every manifest (`scripts/set-version.mjs`), runs `pnpm test:all --strict --provision`,
  commits "Cut X", tags HEAD, then for each ready target runs `build()` then `publish()` in
  sequence. It never pushes. `--from-tag=<tag>` is the runner path: it verifies the tag names HEAD
  and the manifests match, then builds and publishes. `--only=<targets>` still exists in
  `index.mjs`; the owner retired it as a human habit on 2026-09-18, not as a flag.
- **The stores see only the numeric core plus a build number.** `app.config.ts` strips the
  pre-release suffix for `expo.version`; the build number is minutes since 2026-01-01 UTC, pinned
  through `LEAPSAKE_BUILD_NUMBER` so iOS and Android share one number per release. Nothing in the
  apps reads the suffix: the only version reads are `app.config.ts` (core) and two mobile screens
  reading `Constants.expoConfig.version` (core).
- **What refuses alpha-after-beta is `monotonic` in `scripts/release/preflight.mjs`**, by semver
  precedence. The stores never cared: build numbers order uploads, and the version string is the
  same `0.1.0` either way.
- **Receipts** (`scripts/release/receipts.mjs`) are one JSON line per shipped target on a
  `refs/notes/releases` note against the tagged commit. `final` on iOS reads them to find the
  commit behind the build Apple approved. Two receipts exist today, on `v0.1.0-beta.9`.
- **Per-target policy lives in `scripts/release/targets/*.mjs`** with the contract in
  `targets/index.mjs`: `preflight`, `tiers[stage] = { name, requires, manual, external?,
storeSubmission?, marker? }`, `build(ctx)`, `publish(ctx)`, and `release(ctx)` for a marker
  rung. Android `final` currently carries an always-failing `productionAccess` check in
  `requires`; `index.mjs` refuses a `final` that mixes a marker target with a building one.
- **The gate is one process on one machine.** `scripts/test-all.mjs --strict --provision` runs
  every tier including `native-ios`, `native-android` and `e2e`, which drives both a simulator and
  an emulator. Under `--strict` a tier that cannot reach its device fails. There is no platform
  filter; `test-e2e.mjs` and `test-native.mjs` already accept `--platform=<x>`.
- **The E2E tiers are heavy.** Flow 7b alone is 4m45s; the arc with provisioning is well over ten
  minutes per platform, and `expo run:<platform>` is a full native build unless cached. Flow 4's
  Argon2id pass went **bimodal on a starved emulator** (`EMULATOR_SIZE` in
  `scripts/lib/mobile-harness.mjs` asks for 6 cores and 8 GB). Expect hosted runners to be smaller.
- **iOS signing today assumes the distribution certificate is in the login keychain** (the archive
  passes `CODE_SIGN_IDENTITY=Apple Distribution` and a profile _name_). A runner has neither; the
  script must import a `.p12` and a `.mobileprovision` from paths first. Routine, but not written.
- **Three keychains, and only one is an obstacle for a hosted runner.** The _simulator's_
  keychain, which the mobile flows touch, lives inside the device's data container
  (`expo-secure-store`, `AFTER_FIRST_UNLOCK`, no `requireAuthentication`), needs no host login
  session and no signing identity, so Flows 1, 4 and 7 can run on a hosted macOS runner; cost and
  horsepower are the question, not capability. The _host login_ keychain is desktop's:
  `safe-storage-keystore.ts` derives its key from a real macOS Keychain item, so a macOS E2E tier
  wants an unlocked login keychain in a user session (`security create-keychain` /
  `unlock-keychain` / `set-key-partition-list`, unverified here), and on Linux
  `isEncryptionAvailable()` returns `true` over a `basic_text` fallback, so a green test there
  proves less than it appears to. The _signing_ keychain is step 7's `.p12` import, routine.
- **Play's edit is transactional; Apple's upload is not.** `play.mjs` `withEdit` commits at the end
  or abandons; `altool --upload-app` is spent on success. Both sides have a pre-upload validation
  (`altool --validate-app`; Play `:validate` in the `consolePreconditions` check).
- **Vitest runs `scripts/**/\*.test.mjs`**, so the release-path tests are part of `pnpm test`.
- **The website deploys on push, outside the version set**, and stays that way.
- **Two existing decisions this must not disturb:** the rung-to-track mapping on Play (`beta`
  ships to the API track named `alpha`; nothing ever targets Play's `beta`, which is open testing)
  and `releaseType: MANUAL` on the App Store submission.

---

## The target picture

### The commands (`scripts/release/index.mjs` becomes a dispatcher)

```
pnpm release cut <alpha|beta|rc|final> [--push] [--dry-run]
    compute the next tag for HEAD on that channel, print the plan, confirm, create it (and push it)
    `final`: resolve the commit the store approved (receipts), tag *that* commit
pnpm release plan --tag=<tag> [--json]
    what the tag would ship: every target × this rung as ready / blocked (+ why); the build number
pnpm release gate --platforms=<ios,android> [--tag=<tag>]
    the suite for those platforms only, --strict --provision
pnpm release build --tag=<tag> --only=<target> --build-number=<n> --out=<dir>
    phase A for one target: artifact + <dir>/<target>.json; spends nothing
pnpm release publish --tag=<tag> --from=<dir> [--only=<target>] [--receipts-out=<dir>]
    phase B: upload everything <dir> holds; writes one receipt file per target
pnpm release record --tag=<tag> --from=<dir> [--push]
    append receipt files to refs/notes/releases on the tagged commit (single writer)
pnpm release abandon --tag=<tag>
    delete the tag locally and at origin — refuses if any receipt names it
pnpm release ship --tag=<tag> --here
    the local backdoor: plan → gate → build all → publish all → record, in one process, guarded
pnpm release --help
```

`--only` is now the runner's per-job selector. A person never types it in the normal flow.

### Where the version comes from

- Manifests: the core, written by `scripts/set-version.mjs patch|minor|major` (or an explicit
  `X.Y.Z` that must be one of those three successors). Starting a new train is one ordinary human
  commit. `pnpm test:versions` keeps every manifest on the same core and refuses a suffix.
- The release version: the tag. `cut` computes it; every other command takes `--tag`.
- Inside the app: the release script sets `LEAPSAKE_RELEASE=<full version>` for the build;
  `app.config.ts` puts it in `extra.release`; the About/data screen shows that. Unset → `dev`.

### Keeping the version visible (decision 2's condition)

`git tag` / `git describe` on any checkout; the pipeline run named after the tag; the receipts and
the Play release name (already the full version); and the app's own About screen showing
`0.1.0-beta.10`, not `0.1.0`. If all four hold, nothing is more hidden than today.

### The pipeline on a tag

```
plan ──► gate-ios (macOS) ──┐        ┌──► publish-ios (macOS) ──┐
     └─► gate-android (Linux)┤        │                          ├──► record (always) ──► abandon (on failure)
         build-ios (macOS) ──┤──► all green? ──► publish-android (Linux) ──┘
         build-android (Linux)┘
```

`plan` decides the build number once and passes it to every build job, so both stores get the
same number. A marker rung (`final`) has empty gate and build matrices; its publish jobs call
`release()`. `record` runs whether or not publishing succeeded, so a half-shipped tag keeps its
receipts; `abandon` then refuses to delete it, and the fix is re-running the failed publish job,
which reuses the uploaded artifact and the same build number.

---

**Before starting, read [`README.md`](./README.md) → _Where 3 and 4 pull on each other_**:
`ci-and-test-tiers.md` steps 1–3 make this doc's gate cheaper, and its step 4 belongs before
step 7 here.

## Steps, each a commit series

Every step ends with `pnpm test` green (or, in a sandboxed agent shell, the two commands under
_Verification_ below). Steps 1–4 are script-only and need no CI, no secrets, and no public repo.
Step 5 is the owner's. Steps 6–8 need the repo public.

### Verification, in an agent shell

```sh
pnpm exec node scripts/test-all.mjs --only=format,lint,typecheck,versions,icons,bundle
pnpm exec vitest run scripts     # after restoring the Node SQLite ABI: AGENTS.md → *The native SQLite ABI*
pnpm release plan --tag=v0.1.0-beta.9 --dry-run   # once step 2 exists; reads only
```

⚠️ Never run `pnpm release ship`, `publish`, `cut --push` or `abandon` from an agent shell. They
spend build numbers, reach real stores, or touch the remote.

### Step 1 — The version comes from the tag; channels replace the ladder ✅ landed 2026-09-18

Manifests are at `0.1.0`; `pnpm release beta --dry-run` names `v0.1.0-beta.10` and `alpha`
names `v0.1.0-alpha.4`. See `git log -- scripts/set-version.mjs scripts/release`. Two things
it left for later steps:

- **Nothing in the mobile UI shows the version.** `extra.release` is stamped into exports
  only; condition 4 of _Keeping the version visible_ still needs a visible line (step 8, or
  sooner).
- **Tags cut before this step can't be re-shipped with `--from-tag`.** Their commits' manifests
  carry a suffix, which `test:versions` and `tagMatchesManifests` now refuse. That's harmless
  because they are never rebuilt, but step 2's `plan --tag=v0.1.0-beta.9` must only read.

### Step 2 — Two phases, an artifact directory, per-cell readiness ✅ landed 2026-09-18

`scripts/release/phases.mjs` + the dispatcher in `index.mjs`; see `git log -- scripts/release`.
What later steps need to know:

- **`plan --no-checks`** exists because a Linux `plan` job cannot run iOS's preflight (Xcode,
  CocoaPods). Step 7's `plan` job passes it; `build` runs the cell's checks on its own host
  either way. `publish` runs no checks: the build already did.
- **`record` creates a marker's tag** (`v0.1.0`) on the commit its receipts agree on, if the tag
  does not exist. Step 4's `cut final` tags that commit first, and `record` then finds it
  already there. Keep the one code path, or remove this branch when `cut final` lands.
- **No command computes the next tag** until step 4's `cut`. Meanwhile a person runs
  `git tag -a` by hand (`apps/mobile/README.md` says so). `LOCAL_CHECKS` in `preflight.mjs` is
  unused until `cut` picks it up.
- `ship` builds into a fresh `os.tmpdir()` directory and prints the `publish --from=` line to
  resume from it.

### Step 3 — The gate runs only the platforms in the release, and can run alone ✅ landed 2026-09-18

`pnpm release gate --platforms=<list>` (or `--tag=<tag>`, which takes the platforms of the cells
that build) runs `test:all --strict --provision --platforms=<list>`. `ship` passes its building
cells' platforms. Verified by `scripts/test-all.test.mjs` and by selection only: no device tier
was run while landing it.

### Step 4 — The local backdoor gets its safeguards; `cut` exists ✅ landed 2026-09-18

`pnpm release cut <channel>`, `scripts/release/guards.mjs`, and receipts carrying `via`. What
later steps need to know:

- **`cut --no-checks`** skips the cells' checks, like `plan --no-checks`. `cut.yml` on Linux
  needs it for any channel but `final`, since iOS's preflight wants Xcode.
- **`cut final` needs App Store Connect read credentials** (it calls the iOS target's
  `approved()`), as step 7's `cut.yml` note says.
- **The final tag now exists before its release runs**, so `plan`/`ship` check it like any
  other tag (`FROM_TAG_CHECKS`: the tag must name HEAD). Locally that means
  `git checkout v0.1.0` before `ship --tag=v0.1.0 --here`. `record` refuses a receipt whose
  commit is not the one the tag names. `MARKER_CHECKS` is only for `cut final`.
- The upload guard checks `git ls-remote` against `origin` by name.

### Step 5 — The repo goes public (owner) ✅ done 2026-09-19

`leapsake/leapsake` is public. GitHub now reports Dependabot alerts on it (53 on 2026-09-19);
reading them is the owner's, outside this plan.

### Step 6 — A throwaway workflow measures the device tiers on hosted runners

**Goal:** know, with numbers, whether GitHub's runners can carry the gate before anything
depends on it. This is the one unknown that could change decision 6.

**Files:** one `.github/workflows/measure.yml`, deleted when step 7 lands; findings go into this
doc's _Facts_ list and then into `CONTRIBUTING.md`.

1. Job `ios` on `macos-latest`: checkout, Node, `pnpm install`, then
   `pnpm release gate --platforms=ios`. Cache what is cacheable (`~/.cocoapods`, the pods dir,
   Xcode DerivedData for the dev client, `~/.expo`, the Metro cache). Record: provisioning time,
   `expo run:ios` time cold and warm, arc time, and whether Flow 4 is bimodal over three runs.
2. Job `android` on `ubuntu-latest`: enable KVM (the udev rule GitHub documents for
   hardware-accelerated emulators), install the SDK and an AVD matching
   `scripts/lib/mobile-harness.mjs`'s expectations, then `pnpm release gate --platforms=android`.
   `EMULATOR_SIZE` asks for 6 cores and 8 GB; the runner has 4 and 16. Record the same numbers,
   and whether the harness's warning about an under-sized emulator fires.
3. Both: three runs each, on the same commit. Anything that fails twice is a finding, not a flake.

#### Where step 6 stands (updated 2026-09-24)

**Both of step 6's questions are answered: hosted runners can carry the gate.** Flow 4 is not
bimodal on either platform, and the Android emulator runs accelerated on Linux (table below).
What was holding the bar back was the Android crash in open item 3, now patched:
**`35990530595` (80cc189) was iOS 3/3 and Android 3/3 through the whole catalog, no crash** —
its one red a self-test wait budget, since raised. **One more clean run** (the next push that
touches `apps/mobile/**`) takes the crash to six clean jobs, and then step 6 is only the owner's
decision below. The arc it measures is now 01 → smoke → 04 → 07c → 07b; the table's arc times
are from the old seven-flow arc. Everything else here is history worth keeping only until then.

**Reading a run:** `node scripts/ci/measure-results.mjs <run>`, then `<run> "<job>"` for one
job's detail. The green one is `35558802346`; before it, every run from `35466401578` onward
is a record of one fix each, summarised in the open items below.

| | Android, `ubuntu-latest`, 4 cores, KVM | iOS, `macos-latest`, 3 cores, iPhone 17 Pro |
|---|---|---|
| Device boot | 62–78s | not timed |
| Cold `expo run` | 256–402s | 507–1170s |
| `native` tier | 393–541s | 348–1970s |
| E2E arc, all flows green | 884s (35558802346) | 1307s (35558802346) |
| Flow 4 (Argon2id) | 157–187s: **not bimodal** | 151–162s: **not bimodal** |
| Slowest flow (7b) | 549–623s | 404–425s |
| Whole job | ≈ 40 min | ≈ 60 min |

The under-sized-emulator warning has never fired. Every non-device tier passes on both.

**Determinism first, retries second** (owner, 2026-09-20). A step-level retry with a
post-condition is synchronization and stays; a re-run of a whole flow or job is flake-hiding
and does not enter the gate. What removes the need for either: animations off (Android
`*_animation_scale 0`, iOS Reduce Motion), a pinned simulator model
(`LEAPSAKE_IOS_SIMULATOR`, default iPhone 17 Pro — the runner image's default iPhone can
change under us), and a frozen status bar. All landed 2026-09-20. **Not pinned: the
timezone** — the simulator takes the host's, and `simctl` has no knob for it, so a runner
(UTC) and the owner's Mac (ET) still differ on anything date-shaped. The structural fix for
the rest is dropping the dev client (`ci-and-test-tiers.md` step 4), which this week's
failures argue for: the dev menu, the launcher and Metro caused four of them.

**Open, in the order to take them:**

0. **An iOS crash we could not read** (35550536039 iOS 2): Maestro reported "App crashed or
   stopped while executing flow" in Flow 1 and the harness printed no crash report — it looks
   for one written in the last ten minutes, and the report lands a beat after Maestro gives up.
   It now waits up to 10s and matches by file name too. Whether this is the store-handle crash
   again or something new is **unknown**; read the next one.
0. **Maestro's own session fails on the building job** — `MaestroSessionManager.newSession`,
   twice, both times on the job that ran the cold build (35527913453, 35546805924). Maestro
   installs and launches a UITest runner the first time it drives a simulator, and that is what
   fell over; the first *flow* then took the blame. `prepare` now waits for a `hierarchy` call
   to answer before running anything (`maestroReady`), so the wait is explicit and a genuine
   failure says so.


1. **iOS: the dev menu opens itself over the app** (2 of 4 jobs — 35470466445 iOS 2,
   35476256905 iOS 1). The `on screen:` line shows the menu and its onboarding sheet
   ("This is the developer menu…" / Continue) instead of the app, and the driver-contract
   self-test goes red. Cause: `EXDevMenuShowsAtLaunch` registers `true` and
   `EXDevMenuIsOnboardingFinished` `false` on iOS (`expo-dev-menu`'s
   `Modules/DevMenuPreferences.swift`), so a simulator that has never run the dev menu opens
   it at launch. Invisible on a developer's machine, where both are long since set.
   `settleDevMenuIos` now writes all three keys and `app.json`'s `infoPlist` carries them.
   Earlier iOS stoppers: the AutoFill preflight (8307729) and `relaunch.yaml` (6f1f25e) hold.
   **Flow 1's factory reset is the persistent one** (35476256905 iOS 2, 35507495771 iOS 2):
   the Data screen sits there with "Factory reset…" on it and the confirmation never opens,
   so the tap is swallowed. Neither the animation wait (22ee3ae) nor a point inside the
   element (e263172) stopped it; the whole opening is now retried, which is what fixed the
   same class in `ios-autofill.yaml`.
   **A typed name can lose everything but its first keystroke** (35507495771 iOS 1): Flow 2
   saved a person called "M Bailey" and went red on "Mary Bailey" not being visible.
   `add-person.yaml` now erases, types, and reads the field back, twice if it has to.
   **A swallowed tap is the whole family**, not three separate bugs: 35514492654 lost a
   *tab* tap on both platforms in one run (Flow 3 on iOS, Flow 7b on Android), each failing
   one step later on a tile that was never going to be there. Every tab tap now goes through
   `subflows/tap-checked.yaml` (or its `-text` twin), which re-taps only while the target is
   still on screen. Animations off (885b002) should remove most of the cause; the checked
   tap is what makes a swallowed one fail honestly instead of one step later.
   **Animations off did not end it** (35518189593: iOS 3 lost a tap on a dev-clear button,
   iOS 1 never reached the self-test screen). The dev-clear taps are checked now too. The
   remaining suspect is the JS thread: on a 3-core runner with Metro attached, a dev client
   that is busy cannot answer a touch, and no amount of waiting in the flow fixes that —
   the release-configuration build (`ci-and-test-tiers.md` step 4) does.
   **Typed text is the same story as taps** and now has the same answer: 35527913453 lost a
   username (Flow 4 submitted a form with an empty field under a filled password) and a
   reminder title (Flow 5, twice now). `subflows/type-checked.yaml` types and reads back;
   `add-person`, `create-account` and Flow 5 use it. **A dropped secret is real** —
   35530663975's iOS 2 lost a password, `submit()` returned early, and Flow 7b waited on a
   "Checking…" that could never come — **but a masked field cannot be read back**. An attempt
   to assert it renders as dots (`•+`) failed on *both* platforms and took all six jobs of
   35534331965 down; reverted in 1dad725. **Do not retry it without evidence**: what a masked
   field exposes to the hierarchy is unknown, and the next `on screen:` line that catches a
   recovery gate is where to look. Until then the 15s "Checking…" guard catches it late.
   **A non-device tier failed for the first time** in the same run: `master-key-repair.test.ts`
   hit vitest's 5s default while an emulator had the cores. The default is now 15s.
2. **The Android dialog fix works, and earns its keep.** Two of the three Android jobs in
   35483355076 logged `! dismissed "System UI isn't responding" with Wait` and then passed
   everything; 35476256905's job 2 logged it too. The dialog is common on a hosted runner,
   not rare, and the home-screen timeout has not recurred in nine gate jobs.
3. **Android: the app dies natively on a cold boot — diagnosed and patched 2026-09-24, not
   yet confirmed on a runner.** `SIGSEGV` on `mqt_v_js` at `MountingCoordinator.cpp:103`, the
   virtual call on a mounting override delegate, with frame #00 in freed heap (`SEGV_ACCERR`).
   On the stable release level React Native registers no override delegate of its own, so the
   one it reached is react-native-screens' `RNSScreenRemovalListener`. `ScreensModule`
   installs it twice on a cold start (`initialize()` on the JS thread, and the `onHostResume`
   that `addLifecycleEventListener` posts to the UI thread), and `NativeProxy` assigns and
   copies the `shared_ptr` with no lock, so a torn copy registers a freed listener. Upstream
   fixed exactly this in #4413, released in 4.28.0; Expo SDK 56 pins 4.25.2, so it is
   backported (`patches/README.md`). **What confirms it:** no Android crash across at least
   six jobs (the old rate was about 1 in 6). **3 of 6 so far:** 35990530595 (80cc189) ran all
   three Android jobs through 7c and 7b with no crash; iOS was 3/3. Its one red was the
   driver self-test's 120s wait on a slow emulator (the run finished, 38/38, just after); the
   budget is now 300s. One more clean run closes it. **Ruled out before
   this:** SQLite handles (f6121a3, d2dd420, c0b7eb0) and expo's registry race (a Kotlin
   exception, patched separately). iOS crashed natively twice (35483355076, 35554646445) and
   has been clean since 2026-09-21; the patch is Android-only, so an iOS recurrence is a
   different bug. `node scripts/ci/measure-results.mjs <run> "android"` prints a tombstone.
4. **iOS Flow 5, once** (35470466445, job 3): `.*Send a card.*` not visible; the screen shows
   Home with the reminder's `@Mary Bailey #birthday` line present.
5. **The build cache never saves — stop here, let `ci.yml` own it.** The `tar` probe came back
   clean on the runner (only "Removing leading '/'"), so the archive is fine and what is left is
   the cache service, whose reason is in the job log behind a login. Every build being cold
   costs 5–10 min a job and **did not stop step 6 answering its question**. Step 7's `ci.yml`
   should set caching up properly, with logs the owner can read. The history: ("Cache save failed" on every job). Three causes have been
   addressed and the sizes are now measured (`scripts/ci/measure-cache.sh`, its own annotation):
   one key per platform meant parallel jobs collided (keys are now per job index); no
   `restore-keys` meant any lockfile edit went cold with no fallback (now a prefix chain); and
   **size is real** — 35546805924 reported ~2 GB of paths per iOS job *without* `DerivedData`,
   and three jobs each saving that exceeds the repo's whole 10 GB budget. **Only job 1 saves
   now**; the others restore. **That was not it either** — 35550536039's job 1 still failed to
   save ~2 GB. `measure-cache.sh` now writes a throwaway `tar` over the same paths and prints
   what the archiver says, since the save step's own reason is in the job log, which needs a
   login. If `tar` is clean, the cause is the cache service: stop caching in this throwaway
   workflow and let step 7's `ci.yml` own it. The lever after that is dropping
   `apps/mobile/ios` (1.2 GB, regenerated by prebuild) and keeping only CocoaPods.
   **`DerivedData` is still out**, which is what would make the *compile* warm; decide once a
   save succeeds.
6. After those: three clean runs per platform, then the owner decides (below).

**Fixed along the way, each found only on a hosted runner:** `expo run` never exits when no
Metro is up (now `--no-bundler`, capped at 60 min); `emu kill` returned before the emulator
left; the AutoFill preflight neither waited for its switch nor survived a slow Settings (now a
self-checking retry); the AVD was created under `XDG_CONFIG_HOME` where the emulator does not
look; tests and formatting depended on the owner's global git identity and
`~/.editorconfig`; one website test ran `astro build` twice in 5s.

#### How to run and read a measurement

- **A push to `main` that touches `measure.yml`, `scripts/ci/**`, `scripts/lib/**` or
  `apps/mobile/**` starts a run.** (Neither the flows nor the app were in that list until
  2026-09-20, so a push that fixed either measured nothing. The app is in scope because the
  gate is *about* the app.) Otherwise: Actions → *measure* → *Run workflow*. Each platform runs its three jobs
  **in parallel**, so a run is one job long — they were sequential to give runs 2 and 3 a warm
  cache, which is worth nothing while the cache never saves (open item 5; put `max-parallel: 1`
  back when it does). `measure-gate.sh` stops a hung gate at 120 min so the job still reports.
- **Read results with `node scripts/ci/measure-results.mjs`** (the latest runs) and
  `node scripts/ci/measure-results.mjs <run> [job]`. It reads check-run annotations, which the
  public API serves without a login; job logs and artifacts need one, and the owner does not
  want `gh` installed. Anonymous calls are capped at **60 an hour**: poll every 10 minutes, not
  every minute.
- **Each job's annotation** carries the harness's timing lines, the tier summary, Maestro's
  15 lines before any red flow, what was on screen when a wait failed, and the gate's last 25
  lines.
- **Pushing:** the agent does not push. The standing permission given for this measuring work
  on 2026-09-20 was withdrawn on 2026-09-21; commit locally and say what is waiting. A run takes 1–2 hours; cancel a superseded one in the Actions tab
  (the API cannot, without auth).

**Decide from the numbers** (owner): if Flow 4 is bimodal on the runner, the options are the
cheap-KDF-in-E2E decision that `ci-and-test-tiers.md` leaves open, or a paid larger runner. If
the Android emulator cannot run accelerated on Linux either, decision 6 needs revisiting; do not
work around it in YAML.

**Done when:** the numbers are in this doc and the owner has picked.

### Step 7 — The three workflows, and the two script pieces they need

**Goal:** the pipeline in _The target picture_, as three dumb YAML files, plus the credential
plumbing done in the scripts so the YAML stays dumb.

**Files:** `.github/workflows/ci.yml`, `release.yml`, `cut.yml`; `scripts/release/targets/ios.mjs`
(keychain import); `scripts/release/checks.mjs` or a new `credentials.mjs`; `.env.example`.

**Leave the door open to fastlane.** It is deferred, not ruled out
([`dependency-balance.md`](./dependency-balance.md) → _Evaluated and kept_ has the trigger).
If it comes, it replaces only what is inside `targets/ios.mjs` and `targets/android.mjs`. Three
rules keep it that way:

- **The scripts own the version and the build number.** A future lane takes both as inputs;
  never fastlane's `increment_build_number` or version bumps, which write to project files.
- **The keychain import stays one self-contained function** in the iOS target, so fastlane's
  `setup_ci`/`import_certificate` can replace it whole. No certificate-sharing scheme of our
  own; that is `match`'s job if it is ever needed.
- **Receipts are written from what `build()`/`publish()` return**, never from a tool's output.

Script pieces first, each testable without a runner. **Both landed 2026-09-24**
(`targets/ios-signing.mjs`, `materialize.mjs`); the keychain import has not yet run against
a real `.p12`.

1. **Keychain import in the iOS target.** When `IOS_DIST_CERT_P12_PATH` and
   `IOS_DIST_CERT_PASSWORD_PATH` are set: create a temporary keychain, import the `.p12`, set the
   partition list, add it to the search list, copy `IOS_PROVISIONING_PROFILE_PATH` into
   `~/Library/MobileDevice/Provisioning Profiles/`. Tear down after the export. When they are not
   set (a local machine), today's behaviour. Add the three variables to `.env.example` under iOS.
2. **Secrets as files.** A runner holds secrets as strings; the scripts want paths. One small
   command, `pnpm release materialize --into=<dir>`, reads `LEAPSAKE_SECRET_<NAME>_B64` variables,
   writes each to `<dir>/<name>`, and prints the `*_PATH=` lines to export. Portable: every host
   can set an environment variable. Document the names next to the paths in `.env.example`.

Then the workflows. Each step is one command; the matrices come from `plan --json`.

- **`ci.yml`** — `on: [push, pull_request]`. Job `fast` on Linux: `pnpm test`. On push to `main`
  only: jobs `gate-ios` (macOS) and `gate-android` (Linux, KVM) running `pnpm release gate
--platforms=<x>`. The caches from step 6.
- **`release.yml`** — `on: push: tags: ['v*']`. `plan` (Linux): full fetch with tags, `pnpm
release plan --tag=$TAG --json` as a job output. `gate-<platform>` and `build-<platform>` from
  the matrix (`--build-number` from `plan`'s output; `build` uploads `<dir>` as an artifact named
  by target). `publish-ios` (macOS: `altool` needs it) and `publish-android` (Linux), both
  `needs` every gate and build job, each downloading its artifact and running `publish
--from=<dir> --only=<t>`, uploading its receipt. `record` (`if: always()`, Linux): download
  receipts, `pnpm release record --from=<dir> --push`. `abandon` (`if: failure()`, after `record`):
  `pnpm release abandon --tag=$TAG`, which refuses if anything shipped. Marker rungs: `plan`'s
  matrices are empty, so only the publish jobs run. Host sugar allowed: a `concurrency` group per
  tag, and attaching the artifacts to the host's Release page.
- **`cut.yml`** — `workflow_dispatch` with a `channel` choice. One job: full fetch, `pnpm release
cut $CHANNEL --push`. For `final` it needs the App Store Connect read credentials; the others
  need only a token that can push a tag. This is the one file whose loss on a host move costs
  nothing.

**What only the owner can supply**, before `release.yml` can ship anything: the repo's Actions
secrets, one `LEAPSAKE_SECRET_<NAME>_B64` per credential file (`.env.example` → _On a runner_
lists them), plus `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_BETA_GROUP`, `APPLE_TEAM_ID`,
`IOS_PROVISIONING_PROFILE` and `LEAPSAKE_ANDROID_KEY_ALIAS` as plain values. The iOS
distribution identity has to be exported from the login keychain as a `.p12` with a password,
and the profile downloaded as a `.mobileprovision`; neither exists as a file today.

**Permissions the pipeline needs, and no more:** push a tag, push `refs/notes/releases`, delete
a tag. It never writes to `main`. Write that sentence in `CONTRIBUTING.md`.

**Done when:** a `cut beta` from the button produces a tag, the tag runs the pipeline to two
uploads and a pushed note, and a deliberately broken build (a bad `--build-number`) ends with
the tag deleted and nothing uploaded.

### Step 8 — Docs, then delete this file

- `CONTRIBUTING.md`: principle 6 says what is now true — the dev machine can still run
  everything, and the release runs on hosted runners, with the macOS runner named as the accepted
  lock-in; _Versioning and releases_ rewritten for channels, core-only manifests and the tag
  trigger; "the script never pushes" becomes "the pipeline pushes a tag and a note, never a
  branch".
- `scripts/release/index.mjs` header: the model, in the new shape.
- `plans/android-pipeline.md`: delete the `--only` two-step paragraphs; the "final is
  structurally mixed" item is resolved by per-cell readiness; the `rc` production-half item stays.
- `apps/mobile/README.md` → _Cutting a release_: the everyday path is the button or a tag; the
  local path and its guards.
- `.env.example`: the header line still says `--only=<target> --dry-run`; make it `plan`.
- Delete this doc and its row in `README.md`; update `plans/README.md`, `plans/shipping.md` step
  4 and `plans/status.md` where they point here.

---

## Out of scope, deliberately

- **Android `final` as a promotion** of the `rc` bundle from the closed track to production, and
  the managed-publishing interlock. Blocked on production access; `plans/android-pipeline.md`
  owns it. When it lands it fits step 2's shape as a `release()` on a marker-style cell.
- **Provenance attestation** over the artifacts. Host-neutral tooling only, later.
- **Continuous alpha** (a scheduled `cut alpha` when `main` moved). Add as a fourth workflow if
  the owner wants it; nothing here prevents it.
- **Listing assets, dSYMs, R8 mapping** — `plans/android-pipeline.md` → _Still to build_.
- **What binary E2E drives** (dev client vs release-configuration simulator build) —
  `ci-and-test-tiers.md` step 4, which now carries step 6's evidence. Step 6 here measures the
  dev client because that is what exists.
