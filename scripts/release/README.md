# `scripts/release/`

The release command, `pnpm release`. [`CONTRIBUTING.md`](../../CONTRIBUTING.md) → _Versioning and
releases_ states the policy; this file is the reasoning behind the code that enforces it, kept
beside that code. `pnpm release --help` prints the commands.

It lives in `scripts/` rather than a package because it has one consumer, and its pure logic
(the version and tag algebra) carries tests because its mistakes are permanent: a store version
cannot go backwards.

## The iOS target (`targets/ios.mjs`)

App Store Connect, from a local archive, with no Xcode session anywhere: `expo prebuild`
generates the project, `xcodebuild` archives and exports it, and `altool` uploads it with an
API key rather than an Apple ID. Two constraints shape it, both learned on the first upload,
which was done by hand:

- **`apps/mobile/ios/` is generated** and gitignored, so nothing may originate there: team,
  signing identity and build number are all passed at invocation, which is also what makes a
  runner viable. `build()` deletes `ios/` before prebuilding, because an artifact for strangers
  must be reproducible from a commit, not from whatever the last Xcode session left.
- **Manual signing, always.** Automatic signing resolves development _and_ distribution
  profiles before archiving, so a machine with no registered device fails for an unrelated
  reason, and Apple's device list resets only once a membership year.

**Cutting the tag is the consent gesture.** From `beta` up, `publish()` goes past the upload:
it attaches _What to Test_, adds the build to the external group and submits it for beta
review. `beta` _means_ external TestFlight, so leaving those calls to a browser would add a
chore, not a decision. What stays manual is choosing a new audience: creating the tester group
and adding people to it. Beta review sits between submission and testers as a backstop. `rc`
also submits the version for App Review, with `releaseType: MANUAL`, so an approved version
waits in _Pending Developer Release_ until `final` releases it; a version record made by hand
defaults to release-on-approval, which `final` cannot follow, so the code corrects it.

**Preflight fails in seconds what would otherwise fail after a twenty-minute archive**, when
the build exists and the version number is spent:

- **Export compliance** (`ITSAppUsesNonExemptEncryption: false` in `app.json`), at every rung:
  without it every upload sits at _Missing Compliance_, undistributable even internally. It is
  a declaration that Leapsake's standard algorithms are exempt _(owner, 2026-08-26)_; the check
  keeps it from silently disappearing, and `app.json` is the one place to change it.
- **`release-notes/what-to-test.txt`** (plain text, since TestFlight renders no Markdown) and
  the App Store's _what's new_, which strangers read and so is a separate file, capped at
  Apple's 4,000 characters. The very first version of an app has no _what's new_: Apple rejects
  the field, so it is reported and skipped.
- **One live probe of the account**, several requests on one session: the key's role (a
  _Developer_ key uploads fine and can do nothing after; a role change means a new key, since
  the `.p8` downloads once), the tester group (matched by name, and never an _internal_ group,
  which would skip beta review and quietly deliver `beta` to the alpha audience), and the
  record's Test Information and Beta App Review details, including `demoAccountRequired: false`,
  the one field whose default fails review. A network that is down is reported as such, not as a
  bad key. At `rc` it also reads what App Review will: the record's information and the
  version's listing, screenshots and price. The App Privacy answers are not in Apple's API,
  so the rung lists them as a manual step.
- Full Xcode (a Command Line Tools install cannot archive), CocoaPods before a prebuild deletes
  the project, and the API key. altool is given the key by path, so its filename is not
  load-bearing; keep the `AuthKey_<id>.p8` name anyway, since `.gitignore` excludes that shape.

**Talking to App Store Connect** follows Apple's fixed order, and **every step tolerates having
already happened**, because a retried call may have landed before its socket died and a
rejection is resubmitted against the same version record. Processing comes first and is the
slow step (5 to 20 minutes, allowed 40); a freshly uploaded build is not even queryable at
first, and `INVALID` is fatal rather than waited out. A localization is PATCH-or-POST, since
Apple sometimes seeds one; a build already in the group, or already submitted (Apple often
submits implicitly on adding it), is success. A version must be in an editable state to take
a build, and the refusal names the state rather than surfacing a bare 409; a 409 on adding to
a submission is asked about, since it means both "already there" and "not reviewable". The
version's attached build number is the only key Apple gives back to a commit, which is why
[receipts](#receipts) exist.

## The macOS target (`targets/mac.mjs`)

Blocked: desktop distribution is not part of v0.1, though the app itself is alive and its
integration tier still runs. **Xcode is not in this path at all.** The app is Electron, so
packaging is electron-builder, and the Apple half is `codesign`, `xcrun notarytool submit
--wait`, `xcrun stapler staple` and `spctl -a -vvv -t exec`, all in the Command Line Tools. The
iOS target's App Store Connect key authenticates notarization.

## The App Store Connect client (`apple-app-store-connect.mjs`)

`altool` uploads the `.ipa` and stops; everything after (processing, notes, the group, review)
is only reachable over this API. The client is the **transport, not the policy**: it signs,
retries and reports, and `targets/ios.mjs` decides what a release does with it, so another
caller can reuse it without inheriting TestFlight's rules. It has no dependency: `node:crypto`
signs the ES256 JWT, with one trap, `dsaEncoding: "ieee-p1363"`, since JWS wants the raw
`R‖S` pair and Node's default DER reads to Apple as a wrong key. It uses the same three
variables as `altool`, so one key uploads and distributes and a wrong role shows up in one
place. A token lives Apple's maximum 20 minutes and renews a minute early, since processing
alone can take that long.

**Retries are not method-aware, on purpose.** Losing the distribute half costs a fresh archive
and upload, so a dropped connection is retried up to four times; the first beta lost it to a
bare `fetch failed`. Only transport failures (matched by name, so a real bug still crashes) and
429 or 5xx are retried, honouring `Retry-After` up to 60 seconds; every other status is a
verdict. Every write it makes is safe to repeat, so a new write must be idempotent too or opt out.
Retry notices go to stderr, so a pause does not read as a hang.

## Receipts (`receipts.mjs`)

The build number is a clock reading: collision-free, and **opaque**, since Apple names a build by
number and nothing else. So which commit a build came from is recorded at the only moment both
are known, right after a target publishes, as one JSON line per shipment in a **git note** on
`refs/notes/releases`. Going live needs it, to tag the commit that actually reached the public
rather than a later HEAD, and so would resuming a partial release.

A note rather than a tracked file, because a receipt is only knowable after its commit is tagged
and built, and a second commit would move HEAD past the tag it describes. The cost is that the
notes ref is pushed explicitly. `git notes append` separates entries with a blank line, which the
parser skips; the commit is not a field, since the note's attachment is the claim. Reading is
**tolerant** (a hand-mangled line costs only itself), writing **never fails a release** (the
artifact is already uploaded), and a lookup **never guesses**: two receipts for one build number
answer `null`, like none, so a person decides.

## The Android target (`targets/android.mjs`)

Google Play from a local bundle: `expo prebuild --clean`, `./gradlew bundleRelease` signed with
the upload key, then one edit through the Developer API. Play's traps and the Console's setup are
in [`apps/mobile/README.md`](../../apps/mobile/README.md) → _Android and the Play Console_; the
code's own rules:

- **`--clean`, always**: `app.config.ts` bakes the version code and commit at prebuild, so a stale
  `android/` ships stale values from a current checkout. The commit is checked in the manifest
  before Gradle runs, and the AAB's certificate against the upload key's fingerprint after, since
  a debug-signed bundle installs fine and is refused only at upload.
- **The notes are `whats-new.txt` at every rung**, capped at Play's 500 code points: Play has one
  field, shown in the store listing, unlike Apple's two.
- **One edit per publish**, naming the release by the tag's version so the Console tells rungs
  apart; when `rc` can add its production half, it joins the same edit, so one version code
  covers both. Until the account has production access, `rc` is `beta` with a louder notice, so
  an iOS `rc` is never blocked by it.

## The command

A release is a tag: manifests carry only the core, set by `scripts/set-version.mjs`, and the
tag carries the channel and counter (`v0.1.0-beta.10`). `alpha`, `beta` and `rc` count up
independently per core, and a `final` closes it. Every command takes the tag it acts on. Beyond
what `--help` lists:

- `--first-release` when the repository has no release tags yet, and `--commit=<sha>` to name the
  live commit by hand for a marker rung.
- `--if-approved` exits 0 having done nothing while the store has not approved the version, or
  when its final tag already exists: it is what the hourly schedule runs.
- `--no-checks` skips the targets' checks (their host tools), never the tag's own.
- Credentials come from `.env` or the environment, which wins. Off a runner (`CI=true`), uploading
  needs `--here`, a tag the remote already has, and the tag typed back; `cut` and `abandon` need
  the tag typed back too. There is no `--yes`.
- Exit codes: `2` for a usage error, `1` for a refused or failed step, `0` otherwise.

Every precondition is a check, `{ name, check(ctx) }`, returning `undefined` or **a string saying
what is missing and how to supply it**: that string is read at the moment it matters, by whoever
is shipping, so no release rule lives only in prose. Checks run in order, cheapest first, and may
be async; all are offline but the iOS target's one live probe. The build number is a clock reading
from `app.config.ts`, so the first target pins it (`LEAPSAKE_BUILD_NUMBER`) for the rest, or iOS
and Android would ship numbers an archive apart under one tag.

## Adding a target

A target is a file in `targets/` plus a line in `targets/index.mjs`, with this shape:

| Field           | What it is                                                                        |
| --------------- | --------------------------------------------------------------------------------- |
| `id`            | the `--only` selector                                                             |
| `label`         | what the summary calls it                                                         |
| `platform`      | what it ships for; `host` is the OS its build needs (`"macos"` or `"linux"`)      |
| `status`        | `"ready"` or `"blocked"`, with a `note` when blocked: then every cell is blocked  |
| `preflight`     | the checks every building cell needs                                              |
| `tiers`         | per stage: `{ name, requires, manual, status?, note?, marker? }`                  |
| `build(ctx)`    | returns `{ files: { name: path }, buildNumber, bundleId }`; spends nothing        |
| `publish(ctx)`  | uploads `ctx.artifact`, that result with its files copied                         |
| `release(ctx)`  | a marker rung's whole work, returning `{ commit, buildNumber }`                   |
| `approved(ctx)` | the commit `release` would mark; throws an error named `NotApproved` until then   |

A cell whose tier is `status: "blocked"` is policy: reported ⏳ with its note, and skipped. A
ready cell whose `preflight` or `requires` fail is misconfigured, and fails the release.
