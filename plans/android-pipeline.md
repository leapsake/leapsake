# Android: the release target, and the Play account that publishes it

> **In flight** *(owner, 2026-09-13)*. Android ships from the **personal** Play account to the
> internal and closed tracks; a later app transfer moves it to the company for $25. The build
> half, the Console paperwork, the closed track and the whole scripted upload path are done
> *(2026-09-16)* — `git log` has how each was built. **What is left is the first real run, and
> then recruiting the 12 testers whose 14 days are the long pole.**
>
> **This doc is written to be read cold** — by a person or an agent arriving with no context —
> because the work spans a repo and a web console and neither half makes sense alone. It carries
> only what is *unbuilt or still true forward*; anything settled has moved next to its code.
>
> Two things it deliberately does not repeat. **Credentials** are named by path in `.env` and
> every preflight that needs one says which variable and points at `.env.example`, so a missing
> credential explains itself. **Agent-shell hazards** — chiefly that a sandboxed `pnpm test:*` can
> be SIGKILLed and *delete* the SQLite native binary — are in
> [`../AGENTS.md`](../AGENTS.md) → read it before running the suite.
>
> **Delete it when the work lands.** How to cut a build then belongs in
> [`apps/mobile/README.md`](../apps/mobile/README.md); the rules belong in `scripts/release/`,
> which documents itself. ⚠️ *Play declarations and their revisit triggers* below must be **moved,
> not deleted** — it outlives this document.

## Next: the first scripted release

Everything below is one-time. `pnpm release beta` is the goal; these are the steps that keep the
first one from being an expensive way to find a bug.

### 1. Prove the Android path alone, on the internal track

```sh
pnpm release alpha --only=android
```

⚠️ **`build()` and `publish()` have never executed.** Dry runs exercise preflights only — the
prebuild, Gradle, the keytool fingerprint check, the upload and `tracks.update` are unproven. And
`index.mjs` ships targets in order, **iOS first**, so a `beta` that fails on Android fails *after*
iOS has uploaded, distributed to TestFlight, entered Beta App Review and cut the tag. There is no
undo for that half.

`alpha --only=android` risks one version code against a track with no review and no audience but
the owner. That is not waste: it is the rung that means "internal", used for what it is for.

⚠️ **It is a real release, not a rehearsal.** It runs `pnpm test:all` (not `--strict` — `alpha` is
the one rung that does not gate on unbuilt tiers), sets every manifest to the new version, commits
*Cut 0.1.0-alpha.N*, and cuts that tag. Nothing is pushed. Expect ~4 minutes of Gradle on top of
the suite, and a prebuild that deletes and regenerates `apps/mobile/android/`.

**Then check the Console**, because one thing is unverified: that *Closed testing* still lists its
countries and testers. `publish()` uses `tracks.update`, a **PUT**, and whether replacing a
track's releases leaves its configuration alone has not been proven. The internal track is the
cheap place to find out.

### 2. Run the gate separately, before it runs inside a release

```sh
pnpm test:all --strict --provision
```

⚠️ `beta` and above run this, and **`--strict` fails the release on any blocked tier**. It boots a
simulator *and* an emulator. Whether the Android emulator tier has ever been green on this machine
is unknown, and twenty minutes into a release is the expensive moment to learn it.

### 3. `pnpm release beta`

What it does that cannot be taken back:

- **iOS** — distributes to external testers and submits for Beta App Review. Strangers, not you.
- **Android** — rolls out to the closed track and enters Google review.
- Both spend a version number permanently.

The tag is cut locally and nothing is ever pushed, so that half stays reversible.

### 4. Recruit, and start the clock

The opt-in link is on *Test and release → Testing → Closed testing → **Testers** tab*, below the
tester list, as "Copy link". Testers must already be on the email list to use it.

The 14 days do not begin until testers are opted in, so this is the long pole rather than the
upload. ⚠️ **Send the two-account instruction with the link** — see *Traps*. Play does not reliably
email testers on your behalf; assume distributing the link is yours to do.

---

## Facts established the hard way — do not re-derive these

- **The 12-tester/14-day wall gates *production access* only.** It binds personal accounts created
  after 2023-11-13 (ours). You run a closed test and *then* apply. It is not a tax on uploading.
  **The wall is earned rather than dodged**: the closed-track uploads `beta` makes are exactly the
  activity that accumulates the credit.
- **Internal testing sits outside it entirely** — no minimum testers, no review wait.
- **App transfers are routine**, not one-way doors. Package name, users, statistics, ratings,
  reviews and listing all move: $25 on the receiving side, ~2 business days. ⚠️ **The app signing
  key stays with the app unless the receiving account requests a key upgrade — never request
  one**, or Android buys the entire iOS re-key cost ([`shipping.md`](./shipping.md) → *What the
  transfer costs*) for nothing. The **Change key** button on the App signing page is that trap.
  ⚠️ Two things do **not** ride along: the service account's grant, which must be re-invited to
  the receiving account's *Users and permissions* (the Cloud project itself can stay), and
  **Android developer verification**, which every account needs on its own and which no account
  reaches production without.
- ⚠️ **The Play Developer API cannot create an app.** It only edits an app that already has a
  bundle, which is why the first AAB went through the Console by hand. No tooling removes this for
  the *next* new app either.
- **Play has one review gate where Apple has two.** Apple separates Beta App Review from App Store
  Review; Play reviews a release when it rolls out to a track, with no separate "submit" action.
- ⚠️ **Google's own API documentation is not reliable here.** The
  [APKs and Tracks](https://developers.google.com/android-publisher/tracks) page calls the internal
  track `qa` and never says which of `alpha`/`beta` is closed. `edits.tracks.list` against the app
  is the authority — it answered `internal`, `alpha`, `beta`, `production`.

## Decisions already made — do not relitigate

1. **Ship from the personal account now**, transfer to the company later.
2. **Automatic protection stays OFF** (*Protected with Play*). It injects installer and anti-tamper
   checks and has Google re-sign modified APKs — which sits badly against an AGPL-3.0 repo about to
   go public, against self-host parity, and against the `LeapsakeCommit`/receipts provenance chain,
   since it ships bytes we did not build.
3. **Testers are an email list, not a Google Group** *(2026-09-16)*. The Group argument was
   convenience; the email list wins on privacy, since Group members can see each other by default.
   ⚠️ A Group *can* be configured not to leak (*Who can view members → owners and managers*), so
   this is reversible — but **switch before the 14-day clock starts**, since whether changing tester
   method preserves tester continuity was never established.
4. **The closed track targets all countries.** It is invite-only regardless, so restricting it buys
   nothing and adds a third way a tester silently fails. ⚠️ Adding countries later is free;
   removing one strands whoever already installed.
5. ☐ **Undecided:** *Prevent installs on risky devices* (currently off, making the Play Store
   protection panel read 6 of 7). The argument for leaving it off is consistent with #2 — it blocks
   rooted phones, custom ROMs and de-Googled devices, which is much of the natural early audience
   for a local-first privacy app, against a threat model this app does not have (no in-app
   purchases, no server-side secrets). Decide deliberately rather than to make the counter read 7.

## How the rungs map to Play tracks — settled *(owner, 2026-09-13)*

**A rung means the same thing on every platform, and each store's vocabulary bends to fit it.**
Where a store cannot express a rung, the rung is **withheld** — never redefined.

| Rung | Play track | What happens |
| ---- | ---------- | ------------ |
| `alpha` | `internal` | ≤100 testers, live in minutes, no review wait |
| `beta` | `alpha` *(closed)* | the tester list; reviewed; testers join by opt-in link |
| `rc` | `alpha` *(closed)* — **plus a held production release, once possible** | testers get it, Google reviews it, it waits |
| `final` | `production` | publishes what review approved; the tag names the commit that did |

⚠️ **The rung named `beta` ships to the API track named `alpha`.** Play's `alpha` is closed
testing and its **`beta` is open testing — the whole internet**. No rung here may ever target it;
`android.release.test.mjs` asserts that, because drifting by one name would publish a beta to
strangers and report success.

**`final` refuses on Android** until production access exists, from the preflight pass rather than
mid-release. `rc` is closed-only for the same reason.

---

# Operational: the Play Console half

## Navigating the Console

- **There is no global search box.** Do not look for one.
- **The Console is two-level.** The account-level sidebar (Policy status, Users and permissions,
  Developer account…) does *not* contain app pages. Click **View app →** first. Conversely
  *Users and permissions* is **not** reachable from inside an app.
- **App signing lives somewhere non-obvious:** *Protected with Play → Play Store protection →
  Manage Play app signing* (slug `/keymanagement`). It is **not** under *Test and release*.
- **Deep links** follow `play.google.com/console/u/0/developers/<accountId>/app/<appId>/<slug>`.
  Read both IDs from the address bar rather than hunting through menus.
- **The app Dashboard's "View tasks" flow is the authoritative setup path.** Prefer it to any
  click-path written down here, including this one.

## Still to do in the Console

**Turn on managed publishing** — *Publishing overview → Managed publishing → on*. Required before
`rc`/`final` mean what the mapping says; internal tracks bypass it. ⚠️ Not before then: with it on,
*every* approved change waits for a person, including listing edits. See the `rc` bullet under
*Still to build* for why this toggle is load-bearing and dangerous.

**Replace the feature graphic.** The 1024×500 asset in the listing is a placeholder — frog plus
wordmark — and it is required, not optional.

## Play declarations and their revisit triggers

**This table outlives this document.** When the rest is deleted per the header, move it to
[`apps/mobile/README.md`](../apps/mobile/README.md) → *Cutting a release*. Each row is answered for
**what ships**, which is correct — and each becomes wrong on a specific event. A declaration that
no longer matches the app is a policy problem, not stale paperwork.

| Declaration | Answered | Becomes wrong when |
| --- | --- | --- |
| Data safety | no data collected, no data shared | the **relay** ships (`multiDevice`, v0.2) |
| Sign in details | No — nothing restricted | the **relay** ships: a relay login is a real sign-in. Also if a device lock is ever forced at first run |
| Content rating | *Everyone*, All Other App Types | **purchases**, §11 **sharing**, or **multimedia** land |
| Target audience | **18 and over** only | GA, *if* teens ever become an audience worth designing for |
| App Store **App Privacy** (iOS) | mirrors Data safety | the **relay** ships — ⚠️ same event, *different store* |

⚠️ **The relay is one event that invalidates three declarations across two stores.** Updating Play
alone and shipping a stale iOS declaration is the failure this table exists to prevent — so the
trigger is not Play-only, and should not live here permanently (see *the version-parity check*).

⚠️ **Sequence declaration updates with the release, not after it.** The violation is never "the
declaration changed" — declaring for *what ships* is the only correct answer. The violation is a
live version whose behaviour has outrun its declaration. Declaration changes also go through
review, so they cannot be flipped on rollout morning.

Four answers are right for non-obvious reasons, recorded so a later reader does not "correct" them:

- **Sign in details → No**, and *not* because v0.1 has no login. It ships a **local account** — a
  username and password whose creation is what turns encryption on. The answer is No because
  nothing is *restricted*: there is no launch gate, every `hasAccount` read is a branch rather than
  a door, every feature works without one, and there is no server-side account to provision for a
  reviewer. ⚠️ A **mandatory** PIN/password/biometric at first run would genuinely put this in
  play — and would first have to reverse `plans/encryption/model.md` §7's constraint that
  "first-run onboarding must not force account/password setup."
- **Cash rewards / gift cards → No** despite the Gifts feature: those are private records of
  presents, not instruments of transferable value.
- **Web browser or search engine → No** despite the Search tab: it searches local records.
- **User Content Sharing stays No even after `multiDevice` ships** — sync moves one user's data
  between their own devices, which is not exchanging content with *other* users. Only §11 sharing
  changes it.

⚠️ **Target audience is 18+, with "restrict users Google determines to be minors" left OFF.** The
declaration says who the app is *designed and marketed for* and is not an access control — teens
remain free to install it. *That checkbox* is the access control, and it would block minors from an
app rated **Everyone** for no benefit. The reconsideration point is **GA with multimedia**, not now.
Answer *Store presence* consistently, since contradicting the target-age answer is its own flag.

⚠️ **Purchases are the sharp one.** Answering yes to digital goods does not merely move the rating —
it pulls in Play billing policy.

## Traps that have already cost time

- **Testers must match in two independent places.** The Google account in the **browser** that opens
  the opt-in link joins the test; the account **active in the Play Store app** performs the install.
  If they differ the app silently does not appear, with no error. ⚠️ **Send this instruction along
  with the opt-in link**, or a 12-tester drive quietly stalls at 9.
- **A first test link takes hours to propagate**, sometimes into the next day. "Item not found"
  after opting in is the expected symptom, not a misconfiguration. ⚠️ **Do not republish to "fix"
  it** — each attempt burns a version code that can never be reused.
- **"Not reviewed" on an internal release is normal.** Internal testing requires no review.
- **Play's "no deobfuscation file" warning is expected** — see *Still to build*.

---

# Still to build

`scripts/release/targets/android.mjs` is **`ready`**: `alpha` and `beta` ship, `rc` ships its
closed half, `final` refuses. It and `play.mjs` document their own reasoning; the target contract
is in `scripts/release/targets/index.mjs`. What remains:

- ☐ **`rc`'s production half.** One edit can update **several tracks**, which is how `rc` will
  reach the closed track and a held production release with **one** upload and one version code.
  Blocked on production access.

  ⚠️ **The hold is ambient on Play**, unlike iOS where manual release is a property of the
  submission. It depends entirely on *managed publishing* being on — an app-level Console toggle.
  So this must ship with a preflight that asserts managed publishing is on and **refuses
  otherwise**, or an `rc` run after someone flips that toggle goes **public** with no error.
  Whether the API exposes that state readably is **unverified**; if it does not, the interlock has
  to be something else, and that is a decision to make deliberately rather than paper over with a
  reminder. (A `draft` release was considered and rejected: a draft is not reviewed, which defeats
  the whole point of the rung.)

- ☐ **A version-parity preflight, with a second job.** A tag now ships two artifacts claiming to
  work together — the point of the single-version rule
  ([`../CONTRIBUTING.md`](../CONTRIBUTING.md) → *Versioning and releases*) and the first moment it
  can be **wrong**, since identical version numbers say nothing if the two builds resolve
  `@leapsake/flags` differently.

  Give it the declarations too: the revisit table above is a *reminder*, and reminders are what
  fail years later when someone flips a flag for an unrelated reason. The check is already reading
  flag state, so it costs almost nothing to **fail the release when `multiDevice` is on and the
  declarations have not been re-confirmed** — a dated marker is enough. That turns "remember to
  revisit" into "the release refuses until you do", and a preflight is platform-neutral in a way
  this document is not.

- ☐ **Version-controlled listing assets, uploaded only when they change** *(owner, 2026-09-15)*.
  Screenshots, feature graphic and store icon should live in the repo and be re-uploaded by
  `pnpm release` **only** when the asset actually changed. Today they are uploaded by hand and
  live nowhere tracked. ⚠️ Nothing in `scripts/release/` touches listing assets — the only store
  *text* it writes is release notes, because those are per-*release* where these are per-*listing*.

  Three things to know first:

  - ⚠️ **Screenshots are not byte-reproducible, so naive hash-skipping is worthless.** Two captures
    of the same screen differ — the status-bar clock, battery and signal all move (measured
    2026-09-15: the same Home screen gave `dfa695e3…` and `b171ce0c…`). The fix is Android's
    **SysUI demo mode** (`settings put global sysui_demo_allowed 1`, then broadcast a pinned
    clock/battery/signal). Until that exists the committed PNG is the source of truth and
    regeneration is a deliberate act.
  - **The icon and feature graphic *are* deterministic** — rendered from vector sources by a
    script, so they hash-skip cleanly. Only screenshots need the above.
  - ⚠️ **Play may make local state unnecessary.** Its `Images` resource carries a per-image hash, so
    `edits.images.list` can be diffed against local files with nothing stored on this side.
    **Unverified**: confirm the field before designing around it.

  **Not git notes.** `receipts.mjs`'s header explains why it uses them — a receipt is metadata
  *about a commit*, knowable only after that commit is built. Listing assets are the opposite:
  release **inputs**, known beforehand. They belong in tracked files.

- ☐ **An R8 mapping upload**, the day `enableMinifyInReleaseBuilds` is turned on for app size.
  Until then Play's "no deobfuscation file" warning is correct and harmless.

- ☐ **dSYMs for React Native's prebuilt XCFrameworks** (`React`, `ReactNativeDependencies`,
  `hermesvm`), without which iOS crash reports will not symbolicate frames inside them. ⚠️ **An
  iOS question, no longer hypothetical** — the App Store generates crashes from strangers. Decide
  as part of GA, not here. *(Android is the happier case: `bundleRelease` ships native debug
  symbols in `BUNDLE-METADATA/`, which Play uses to symbolicate, so its crash reports arrive
  legible.)*
