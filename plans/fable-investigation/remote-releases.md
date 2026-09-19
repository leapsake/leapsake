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

### Step 5 — The repo goes public (owner)

Already `shipping.md` → Part 1, step 2: the history scan is done; the remaining item is reading
the security findings as a stranger would, then flipping visibility. Needed before step 6 because
hosted macOS minutes are free only for a public repo. **Not an agent's step.**

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

Script pieces first, each testable without a runner:

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
  `ci-and-test-tiers.md` step 5. Step 6 here measures the dev client because that is what exists.
