# Android: what still stands between the closed track and production

> `alpha` and `beta` ship today, from the **personal** Play account to the internal and closed
> tracks, from one tag alongside iOS. Everything settled about Play — the rung-to-track mapping,
> the declarations and what invalidates them, the Console facts, decisions and traps — is
> [`apps/mobile/README.md`](../apps/mobile/README.md) → _Android and the Play Console_. This doc
> carries only what is unbuilt. **Delete it when the last item lands.**
>
> The release mechanics under it are changing:
> [`fable-investigation/remote-releases.md`](./fable-investigation/remote-releases.md) moves
> releases to a tag-triggered pipeline, and its per-cell readiness is what lets iOS's marker
> `final` and Android's production `final` share one tag.

## Production access: the tester clock

**Background work. It gates `rc`'s production half and `final`, and nothing else waits on it.**

The bar is 12 testers opted in **continuously** for 14 days, so the clock starts at the twelfth
and resets if the number dips, which is why the target is ~15, not 12. ⚠️ **Being on the email
list is not being opted in**: the list is only permission to _use_ the link, and the count that
matters is people who followed it and joined. A tester who quietly uninstalls on day three costs
the fortnight, and nothing announces it. No tooling can watch this; only the Console's _Testers_
tab has the real number.

⚠️ **One claim still unverified**: that Play's tester wall genuinely exempts organization
accounts. Google scopes the rule to personal accounts and does not discuss orgs.

## Still to build

`scripts/release/targets/android.mjs` is **`ready`**: `alpha` and `beta` ship, `rc` ships its
closed half, `final` refuses. It and `play.mjs` document their own reasoning. What remains:

- ☐ **`rc`'s production half.** One edit can update **several tracks**, which is how `rc` will
  reach the closed track and a held production release with **one** upload and one version code.
  Blocked on production access.

  ⚠️ **The hold is ambient on Play**, unlike iOS where manual release is a property of the
  submission. It depends entirely on _managed publishing_ being on, an app-level Console toggle.
  So this must ship with a preflight that asserts managed publishing is on and **refuses
  otherwise**, or an `rc` run after someone flips that toggle goes **public** with no error.
  Whether the API exposes that state readably is **unverified**; if it does not, the interlock
  has to be something else, decided deliberately rather than papered over with a reminder. (A
  `draft` release was considered and rejected: a draft is not reviewed, which defeats the rung.)

- ☐ **A version-parity preflight.** A tag ships two artifacts claiming to work together
  ([`../CONTRIBUTING.md`](../CONTRIBUTING.md) → _Versioning and releases_), and this is the first
  moment that claim can be wrong. Give it the declarations too: **fail the release when a
  data-safety answer has not been re-confirmed since the behaviour it describes changed**. A
  dated marker is enough, and a preflight is platform-neutral in a way the README's table is not.

- ☐ **Version-controlled listing assets, uploaded only when they change.** Screenshots, feature
  graphic and store icon should live in the repo and be re-uploaded by `pnpm release` **only**
  when the asset actually changed. Today they are uploaded by hand and live nowhere tracked;
  nothing in `scripts/release/` touches listing assets, and the only store _text_ it writes is
  release notes, because those are per-_release_ where these are per-_listing_.

  - ⚠️ **Screenshots are not byte-reproducible, so naive hash-skipping is worthless.** The
    status-bar clock, battery and signal all move between captures. The fix is Android's **SysUI
    demo mode** (`settings put global sysui_demo_allowed 1`, then broadcast a pinned
    clock/battery/signal). Until then the committed PNG is the source of truth and regeneration
    is a deliberate act.
  - **The icon and feature graphic _are_ deterministic**, rendered from vector sources by a
    script, so they hash-skip cleanly.
  - ⚠️ **Play may make local state unnecessary.** Its `Images` resource carries a per-image hash,
    so `edits.images.list` can be diffed against local files with nothing stored on this side.
    **Unverified**: confirm the field before designing around it.
  - **Not git notes.** A receipt is metadata _about a commit_, knowable only after it is built.
    Listing assets are release **inputs**, known beforehand. They belong in tracked files.

- ☐ **An R8 mapping upload**, the day `enableMinifyInReleaseBuilds` is turned on for app size.

- ☐ **dSYMs for React Native's prebuilt XCFrameworks** (`React`, `ReactNativeDependencies`,
  `hermesvm`), without which iOS crash reports will not symbolicate frames inside them. **An iOS
  question**: the App Store generates crashes from strangers, so decide it as part of GA.
  (Android is the happier case: `bundleRelease` ships native debug symbols in
  `BUNDLE-METADATA/`, which Play uses to symbolicate.)

## Still to do in the Console

- **Turn on managed publishing** (_Publishing overview → Managed publishing_) before `rc`/`final`
  mean what the mapping says; internal tracks bypass it. ⚠️ Not before then: with it on, _every_
  approved change waits for a person, including listing edits. See the `rc` bullet above for why
  this toggle is load-bearing and dangerous.
- **Replace the feature graphic before GA.** The 1024×500 asset is a placeholder (frog plus
  wordmark). Batch it with a listing review that is being paid for anyway.
- ☐ **Undecided: _Prevent installs on risky devices_** (currently off, which leaves the Play Store
  protection panel reading 6 of 7). The argument for leaving it off matches the automatic-
  protection decision: it blocks rooted phones, custom ROMs and de-Googled devices, which is much
  of the natural early audience for a local-first privacy app, against a threat model this app
  does not have (no in-app purchases, no server-side secrets). Decide deliberately rather than
  to make the counter read 7.
