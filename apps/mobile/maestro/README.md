# Mobile native test tier — Maestro harness

This directory holds the **blackbox harness** for the mobile driver-contract self-test
(see [`../README.md`](../README.md) → _Why the driver test needs a device_). It drives
the in-app self-test on an emulator/simulator and asserts **PASS** from the command line,
so the mobile driver leg is a _terminal, automated_ gate — not a human opening
`leapsake://dev-selftest` and reading the screen (principle #1: automate over manual).

- **`driver-selftest.yaml`** — the Maestro flow: deep-link to the self-test route, wait
  for the async contract run to finish, assert the `driver-selftest-status` element's
  accessibility label is `PASS`. Vendor-neutral: plain open-source Maestro YAML, no
  mobile.dev cloud coupling — it runs on the local `maestro` CLI against any booted
  device, **byte-identical on Android and iOS** (its `id`/`text` selectors map to
  Android resource-id/content-desc and iOS accessibilityIdentifier/accessibilityLabel).
  Keying on the stable `PASS`/`FAIL`/`ERROR` token (not the human-readable `N/N` count)
  makes it non-vacuous: a broken contract case turns the flow RED.
- **`ios-prepare.yaml`** — an **iOS-only** helper flow that gets the dev client from a
  cold launch to the app's home screen (the bundle-load "prepare" step). Android loads
  the bundle with an `adb` deep link; on iOS that deep link is intercepted by a
  SpringBoard "Open in Leapsake?" confirm and ignored, so this flow instead reconnects
  through the dev-launcher's last dev server (set by `pnpm --filter @leapsake/mobile
ios`), clears any SpringBoard/dev-menu overlay, and waits for the Search tab. The
  runner invokes it; you don't run it directly. It does **not** touch `driver-selftest.yaml`.
- **`global-nav.yaml`** — the navigation shell: that the bar holds Home, Search, People
  and Settings; that **each screen's ➕ makes the thing that screen is about** (Home a
  reminder, People a person or pet, Gifts a gift idea); that a browse tile opens a
  tab-less catalog with the bar still under it and no back control; that such a catalog
  carries **both** header glyphs, 🔍 and ➕, in its one right-hand slot; and that a back
  control is absent inside the tab navigator and present one screen up. All of those are
  claims no lower tier can check — nothing below E2E proves a header action is wired to
  the route its tab entry names.

  That last pair is also what holds up `components/AppHeader.tsx`'s single row, which puts
  a screen's actions on the title's line: it is safe only because Back and the glyph pair
  can never share that row, Back coming from the native stack and the glyphs being
  declared only on tab-navigator screens.

  It deliberately does **not** assert the selected-tab tint: that is a colour, and Maestro
  reads the accessibility tree rather than pixels.

  Taps use the tab buttons' `testID`s (`tab-home`, `tab-search`, `tab-people`,
  `tab-settings`) rather than their labels. Text selectors are full-match, so a tab label
  match has to be a loose `.*Search.*` — which would just as happily hit a reminder titled
  "Search for a new camera" on the list behind the bar. The header glyphs are tapped by id
  for a stronger reason: they render as a bare ➕ and 🔍, so their only text is the
  `accessibilityLabel` each sets (`header-new-home`, `header-new-people`,
  `header-new-gifts`, `search-here-<category>`).

  Every assertion in it is about something either on screen or **not mounted at all**. A
  bottom-tab navigator keeps previously-focused screens mounted but hidden, so their text
  stays in the accessibility tree — arrival is therefore asserted on _pushed_ screens (a
  pop unmounts them) and on the tab bar, never on "is Home's title still in the tree".

  Creates nothing, so it needs no per-run tag and can be re-run indefinitely. Not wired
  into `pnpm test:native`, which is built around one flow and a PASS token:

  ```
  maestro --udid <sim> test global-nav.yaml
  ```

- **`staged-gifts.yaml`** — a **UI** flow rather than a contract one: it drives the create
  form through adding a gift as an open row, saving, reading it back on the person's page
  as not-given, then ticking it off on the row itself and reading it back as given. It is
  the regression gate on the two screen-level seams a gift has — that "Add gift" appends a
  row the form's own Save writes, and that the row's own ✓/○ applies where it stands — and
  it is **verified non-vacuous by sabotage**: making `applyEntityForm` skip `value.gifts`
  turns case 2 red, making `GiftsSection`'s `setGiven` a no-op turns case 3 red.

  It used to reopen the whole record's edit form to reach the tick. That form is gone —
  each part of a saved person is now its own small screen, and a gift's tick is not a draft
  at all — so the second half of the flow acts on the detail page directly.

  Not wired into `pnpm test:native`, which is built around one flow and a PASS token. Run
  it directly against a **freshly loaded** app (see _Running the flow directly_ below):

  ```
  maestro --udid <sim> test staged-gifts.yaml
  ```

  ⚠️ **Not yet run on a simulator** — written 2026-08-20 alongside the gift-scope cut and
  revised 2026-08-22 for the per-item edit screens; reviewed against the source both times,
  never executed. It replaces `staged-gift-occasions.yaml` (+
  `subflows/stage-gift-for-occasion.yaml`), which was green on both platforms and drove the
  occasion picker through the five ways a staged occasion could resolve. Occasions left
  v0.1 scope; that flow and its platform-branching `SelectField` subflow went with them, and
  with it the only place a flow here had to branch per platform at all.

  The dev-menu floating button has to be off or this flow cannot pass — see the trap below.

  It needs a clean start because `openLink` to a route **already in the stack reuses that
  screen rather than remounting it** — so a previous failed run's half-filled form is still
  there, and the next run stacks its milestones on top of it. Between its own five cases
  this is a non-issue: each ends in a save, and the add screen `replace`s itself.

  Two traps it encodes, both of which cost a session each and neither of which looks like
  a harness problem when you hit it — see `subflows/dismiss-keyboard.yaml` for the long
  version:
  - **Maestro does not model the keyboard as occluding anything.** An element behind it
    still reads as visible, so `scrollUntilVisible` stops as soon as it has scrolled that
    far and the next tap lands on a key. The step "COMPLETED", nothing happened, and the
    failure surfaces several steps later somewhere unrelated. Dismiss and _assert_ the
    dismissal before reaching for anything low on the screen.
  - **Fixed record names make a data-creating flow degrade with every run.** Run N leaves
    the Nth copy of each name, and the post-save duplicate detector then has to score and
    render every one of them — the review screen grows a row per previous run until the
    flow times out. Stamp created records with a per-run tag instead.

## Run it

```
pnpm test:native                    # every booted platform (Android + iOS)
pnpm test:native --platform=ios     # just one
pnpm test:native --platform=android
```

That runs [`scripts/test-native.mjs`](../../../scripts/test-native.mjs), which owns the
environment prep (the flaky part of driving a dev client) and then invokes the flow. With
no flag it attempts **both** platforms and reports each one's status; a platform whose
device isn't booted (or whose toolchain is absent) prints as **BLOCKED**, never silently
skipped. It **assumes a prepared environment** and fails with the exact command to run if
a piece is missing. Exit codes: `0` = at least one platform passed and none failed; `1` =
a booted device went RED or its env is broken (Metro down / app not installed); `3` =
nothing reachable here (no device booted / toolchain absent) — _blocked_, not a failure.

One-time / per-session setup, Android:

1. **Maestro CLI** (once):
   ```
   curl -Ls "https://get.maestro.mobile.dev" | bash
   ```
   Then restart your shell (or ensure `~/.maestro/bin` is on `PATH`).
2. **A booted Android emulator**, with cores _and memory_ — see
   [Budget the waits for the emulator](#budget-the-waits-for-the-emulator-not-for-the-simulator)
   for why the default AVD is not enough:
   ```
   emulator -list-avds
   emulator -avd <name> -cores 6 -memory 8192
   ```
   Boot **one** device per platform. With two emulators up (or a phone plugged in) the
   harness refuses rather than guessing which to drive, and tells you how to pick:
   `--device=<serial|udid|name>`, or `LEAPSAKE_E2E_DEVICE`. Under `--provision` it shuts
   the extras down instead, since nobody is watching.
3. **The dev-client build installed + Metro running.** The simplest way to get both is:
   ```
   pnpm --filter @leapsake/mobile android   # builds, installs, and starts Metro
   ```
   (or `pnpm --filter @leapsake/mobile dev` to start Metro against an already-installed
   build). The self-test screen is `__DEV__`-only, so this must be a **dev-client** build
   (Expo dev-client + Metro), not a release binary. If you add or remove a native module,
   rebuild with `pnpm --filter @leapsake/mobile android`.

`scripts/test-native.mjs` then sets `adb reverse tcp:8081`, loads the JS bundle into the
dev client (a cold dev-client launch shows the expo-dev-launcher, not the app — the
script deep-links past it deterministically over adb), waits for the app's home screen,
runs the flow, and propagates Maestro's exit code.

### Running the flow directly

`maestro test driver-selftest.yaml` works too, but the flow deliberately does **not**
`launchApp` (a cold dev-client launch lands on the launcher, and the self-test route only
exists once JS is loaded). So first open the app to its home screen against a running
Metro, then run the flow. `pnpm test:native` does this for you.

## iOS (step 9 — done)

The self-test flow (`driver-selftest.yaml`) runs unchanged on iOS. The **prepare** step is
now the same shape as Android's — the harness opens the bundle-load deep link
(`leapsake://expo-development-client/?url=http://localhost:8081`) with `xcrun simctl
openurl` — and `ios-prepare.yaml` only settles overlays and waits for home afterwards.
Per-session iOS setup:

1. **Maestro CLI** — same one-time install as Android (above).
2. **A booted iOS simulator** — e.g. from Xcode, or:
   ```
   xcrun simctl list devices available
   xcrun simctl boot <udid> && open -a Simulator
   ```
3. **The dev-client build installed + Metro running.** The one command that does both:
   ```
   pnpm --filter @leapsake/mobile ios   # builds, installs, launches, starts Metro
   ```
   The self-test screen is `__DEV__`-only, so this must be a dev-client build. If you
   add/remove a native module, rebuild with the same command (a stale build missing a new
   native module redboxes on launch).

`scripts/test-native.mjs` then opens the deep link, runs `ios-prepare.yaml` (which clears
any SpringBoard/dev-menu overlay and waits for the Search tab), runs the self-test flow
with `maestro --udid <sim>`, and propagates its exit code — the same shape as Android.

### The prepare no longer depends on a remembered dev server — keep it that way

It used to. `ios-prepare.yaml` tapped the dev-launcher's **"Continue"**, which reopens the
last dev server _by the absolute URL it was loaded from_ — `http://192.168.1.16:8081`, the
Mac's LAN address at the time. Change networks, or just get a new DHCP lease, and that
address answers nothing: the dev client shows the launcher, "Continue" is not on the screen
at all, and prepare burns its whole budget before reporting "the app's home screen never
appeared". Nothing in that failure mentions the machine's IP, and re-running never helps.
It cost a session on 2026-08-31, with `.16` and `.42` remembered and the host on `.9`.

The deep link names `localhost`, which the simulator resolves to the host, so it is the
same address on every machine and every network. (The deep link _was_ rejected on iOS when
this tier was written — a SpringBoard confirm, and the launcher ignoring the `?url=` behind
it, verified 2026-07-18. Re-verified 2026-08-31 on the same simulator: it now launches the
app straight onto home, no confirm.) To do it by hand:

```
xcrun simctl openurl <udid> "leapsake://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

**Do not put `launchApp` back into `ios-prepare.yaml`.** Maestro force-stops the app as
part of launching it, which throws away the bundle the deep link just loaded and drops the
simulator back on the launcher — the state the flow cannot get out of on its own.

### Editing a test? The deep link does not reload the bundle

`leapsake://dev-selftest` re-opens the route against the **already-loaded** bundle, so a
source edit does not take effect and the screen re-runs the _old_ suite — which looks
exactly like a passing run of the new one. Force a fresh bundle between edits:

```
xcrun simctl terminate <udid> com.leapsake.app
xcrun simctl openurl <udid> "leapsake://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

This bites hardest when deliberately breaking a case to confirm it goes RED: without the
reload the sabotage appears to pass, and a genuinely vacuous suite would read as verified.
[Driving the app by hand](#driving-the-app-by-hand--for-looking-not-for-asserting) has the
rest of that family: how to ask Metro what it is actually serving, and why an edit made
while the red box is up never lands at all.

## Driving the app by hand — for looking, not for asserting

Everything above runs a **fixed flow** and reports a verdict. This section is the other
job: getting the app in front of you and poking it, to see a change working or to chase
something that only happens on device. Nothing here belongs in a committed flow — it is
the exploratory path, written down because rediscovering it costs an hour.

### Getting today's code onto the device without a rebuild

The shared packages export **TypeScript source** (`"exports": {".": "./src/index.ts"}`),
so Metro transpiles them directly and there is no build step to run. If you have not
touched a native module, the dev-client build already installed on the device is still
valid and **only the JS needs to change** — start Metro, launch, reconnect:

```sh
pnpm --filter @leapsake/mobile dev          # Metro, against the installed build
xcrun simctl launch <udid> com.leapsake.app
# cold launch lands on the expo-dev-launcher, not the app:
xcrun simctl openurl <udid> "leapsake://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

⚠️ **A running app does not necessarily hold the code Metro is serving**, and the two
failure modes look identical from the outside: an old bundle, and a correct one you have
not reloaded. Ask Metro what it has rather than guessing —

```sh
curl -s "http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true" \
  | grep -c "some string only your edit has"
```

— and if the string is there but the behaviour is not, the **app** is stale, not Metro.
`/index.bundle` is not the entry point (it answers with an `UnableToResolveError` JSON
blob); `node_modules/expo-router/entry.bundle` is.

⚠️ **Fast Refresh does not apply an edit while the red-box error overlay is up.** The
module stays as it was, so a fix looks like it did nothing and a probe looks like it never
ran — the single most misleading state in this loop. Terminate, launch, reconnect.

### Reading the screen

`maestro hierarchy` dumps the accessibility tree as JSON. ⚠️ **React Native's text is under
`accessibilityText`, not `text`** — walking for `text` finds the status bar and little
else, which reads as an empty screen:

```sh
maestro hierarchy | python3 -c "
import json,sys
def w(n):
    a = n.get('attributes', {})
    t = a.get('accessibilityText') or a.get('text') or ''
    if t.strip(): print(repr(t[:90]), a.get('bounds'))
    for c in n.get('children', []): w(c)
w(json.load(sys.stdin))"
```

Take the picture too — `xcrun simctl io <udid> screenshot out.png` — and **look at it**.
The tree tells you what is there; only the screenshot tells you it is on top of a red box.

### Two ways a `tapOn` lies to you

- ⚠️ **Maestro matches text as a regex, in full.** `tapOn: "Pick yourself."` failed on the
  nudge that used to read _"🙋 Which of these is you? Pick yourself."_ twice over: it is a
  substring (so it must be `.*Pick yourself\..*`) and `.` and `?` are metacharacters. That
  nudge has since been reworded, but the trap has not moved. This is the same family as the
  trailing-space trap above, and it is why the id selectors in `subflows/` are worth their
  verbosity.
- ⚠️ **A point tap goes stale the moment anything writes.** `tapOn: {point: "55%,21%"}` is
  the escape hatch when nothing else addresses an element — but a list re-sorts around a
  write, so a second tap at the same coordinate lands on whatever moved there. Re-dump the
  hierarchy between taps, or use a selector. Home is no longer the worst offender: its rows
  carry no completion checkbox any more and nothing on that screen writes, so a stray tap
  there opens a reminder rather than silently ticking one.

### Reading the store, to tell a render bug from a data bug

While the app is **accountless the store is plaintext**, so `sqlite3` answers directly what
the screen only implies:

```sh
C=$(xcrun simctl get_app_container <udid> com.leapsake.app data)
sqlite3 "$C/Documents/SQLite/stores/local/leapsake.db" \
  "SELECT substr(id,1,8), quote(title), source, quote(completed_at) FROM reminders WHERE deleted_at IS NULL;"
```

(With an account it is at `stores/<accountId>/leapsake.db` and encrypted — see
[`@leapsake/key-custody`](../../../packages/key-custody/README.md).) This is the fastest way
to settle "is the row wrong, or is the rendering of it wrong?", and it has answered that
question the opposite way twice: rows correct on disk, wrong in the list.

⚠️ **Close the app before writing to it.** `xcrun simctl terminate` first; the app re-reads
on boot.

### When the row is right on disk _and_ right out of the engine

There is a third answer to that question, and it cost most of a session before it was
found: **Hermes miscompiled the code between them.** More than one `await` in a single
branch of a ternary makes Hermes discard the branch's value and hand back a leftover
register — a plain number — which then type-checks, buckets and renders until something
reads a property off it. `core.reminders.listInWindow` joined its rows that way, so every
_stored_ reminder reached mobile Home as `0`, while desktop, Node and the whole vitest
suite were fine. `scripts/hermes-await-in-ternary.test.mjs` now bans the shape and explains it.

What actually found it, after a lot of reading of correct-looking source, was **printing
the objects on the device**: `Object.keys(x)`, `Object.prototype.toString.call(x)` and
`JSON.stringify(x)` rendered into the screen as `Text`. Rendering a probe rather than
logging it needs no log plumbing and cannot be lost. Reach for it early — one screenshot
said "this is the number zero", which no amount of reading the source was going to say.

### The deep links worth knowing

Deep links skip the navigation entirely, which is what makes ad-hoc driving bearable. They
are ordinary expo-router paths under the `leapsake://` scheme, so anything in `app/` is
reachable; these are the ones that come up:

| Link                                                        | Lands on                                       |
| ----------------------------------------------------------- | ---------------------------------------------- |
| `leapsake://`                                               | Home, inside the tab navigator                 |
| `leapsake://add`                                            | the combined create form, on its Person half   |
| `leapsake://about-you`                                      | the screen that sets the self-person           |
| `leapsake://relationships/<id>/milestones/new?kind=wedding` | the milestone form, opened on a kind           |
| `leapsake://dev-selftest`                                   | the driver-contract self-test (`__DEV__` only) |

When something behaves oddly, run `maestro test maestro/driver-selftest.yaml` early: it
asserts **PASS** from the driver contract in a few seconds, which rules out the whole layer
under the bug for free.

## `e2e/` — the crucial-flow catalog

`e2e/` holds the [crucial-flow catalog](../../../plans/testing/crucial-flows.md) — the tier
that proves a real user can complete the journeys, as opposed to `driver-selftest.yaml`
which proves the driver contract. It is run by `pnpm test:e2e`
(`scripts/test-e2e.mjs`), a sibling of `pnpm test:native`; both sit on the shared harness
in `scripts/lib/mobile-harness.mjs`, which owns device detection, provisioning, the
dev-client install, Metro, and the per-platform bundle-load prepare.

**These flows are an ordered arc, not a set.** `01` resets the app and asserts a first run,
`02` fills it with Mary Bailey, George Bailey, a milestone and a reminder, and relaunches.
They share app state on purpose (the catalog takes 1→4 as one arc), so the runner stops a
platform at the first red flow rather than reporting three failures that are really one.
**A consequence worth knowing before you debug one:** a flow run _standalone_ after a failed
run may not start, because the app is wherever the last failure left it — a modal still
open, a form still half-filled. `01`'s relaunch is what clears that, so re-run the arc
rather than the flow.

What is here covers the **`beta` rung** — Flows 1, 2 (the smoke) and 4, on-screen assertions only — **plus both
of `rc`'s at-rest doors**, `07c` (password) and `07b` (phrase), and **`rc`'s out-of-band
custody assertions** on Flows 1 and 4. The key-store row is a decided deferral (`simctl
keychain` has no read verb, and an in-app "I am encrypted" screen is refused on principle), and
the catalog becomes a release _check_ rather than a `manual:` sentence when the tag-triggered
pipeline lands (`plans/fable-investigation/remote-releases.md`); see
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md) → _The E2E release gate_ for the rung table.

### The out-of-band half: what the bytes say, not the screen

Every assertion in a `.yaml` here reads the accessibility tree, which means **a build that
rendered "your data is encrypted" and encrypted nothing would pass all of them**. So Flows 1
and 4 carry a second half that runs in Node the moment the flow goes green:
[`scripts/lib/custody-assertions.mjs`](../../../scripts/lib/custody-assertions.mjs), wired in
[`scripts/test-e2e.mjs`](../../../scripts/test-e2e.mjs). It reads the store's first sixteen
bytes, the roster and the doors out of the simulator's own container — never through the app,
which is the point (`plans/testing/crucial-flows.md` → _Asserting on custody_). You will see
one line per flow:

```
  ✓ out-of-band custody: asserted on disk — key store: not asserted …
  ⚠ out-of-band custody: not asserted on Android — no app data-container path
```

**How to confirm the checks still bite**, which is worth doing after touching either file —
an assertion that never fires looks exactly like one that passes. The unit test
(`pnpm exec vitest run scripts/lib`) is the durable answer; against a real container, point
them at bytes they should reject:

```sh
C=$(xcrun simctl get_app_container <udid> com.leapsake.app data)/Documents/SQLite
# After a wipe: must report "no account roster…"
node -e 'import("./scripts/lib/custody-assertions.mjs").then(m=>console.log(m.custodyAuthenticated(process.argv[1])??"PASS"))' "$C"
# After Flow 4: must report "an account store exists on a first run"
node -e 'import("./scripts/lib/custody-assertions.mjs").then(m=>console.log(m.custodyUnauthenticated(process.argv[1])??"PASS"))' "$C"
```

The sharpest one: copy a real plaintext `stores/local/leapsake.db` over a scratch copy of
`stores/<accountId>/leapsake.db` in a temp tree and run `custodyAuthenticated` against it. It
prints `this build encrypted nothing` — the encrypting-nothing build, simulated with bytes
the app itself wrote and no code change. The `e2e` tier in `scripts/test-all.mjs` is `ready` — it went `ready` only
once the _whole_ beta bar was there, because a partial catalog that ran and went green would
read as the gate being met.

Two shapes the checks must respect, each pinned by a unit test so nobody "fixes" them:

- **"Gone" means the file, not the directory.** After a conversion or a Forget, `stores/local/`
  and the old `stores/<accountId>/` remain as **empty directories** while their `.db` files are
  deleted. An assertion written as "the directory does not exist" goes red against a correct app.
- **Assert on rows, not on a doors file.** `doors.ts` and `roster-storage.ts` both run
  `CREATE TABLE IF NOT EXISTS` on _every_ open, read included, so an empty `door` or `roster`
  table is a state a correct app reaches. And the checks must **create nothing**: a bare
  `new DatabaseSync(path)` creates the file, so a check asking "does the roster exist?" could
  otherwise answer by planting one.

**Two of the seven do not fit the "ordered arc" description above, and the exceptions are the
point.** `07c` must _follow_ `04` — it needs the store, the data and the password `04` leaves
behind. `07b` must run **last** and inherits nothing at all: the 24 words it needs cannot cross
a flow boundary, so it resets the device and builds its own account, which destroys what `04`
and `07c` were standing on. The whole iOS arc is **13 minutes**; the two door flows are 7 of
them, and that is four Argon2id passes doing what they are designed to cost.

### What the app's own state looks like from here

- **Every run starts from a wiped app, and the harness is what guarantees it.** Before the
  first flow, `mobile-harness.mjs` → `wipe` clears the app's data from _outside_: `adb
shell pm clear` on Android, and on iOS a delete of `Documents/SQLite` (stores, doors,
  roster) plus `simctl keychain reset` (expo-secure-store's secrets). That is what makes a
  run's verdict independent of the run before it — the arc ends on Flow 4 with an account
  and keys, and a wedged app cannot be driven to its own reset screen at all.
- **The blunt tools are still the wrong ones**, which is why the iOS wipe is assembled by
  hand: `clearState` and `simctl uninstall` take the whole data container, including
  `Library/Preferences` — the dev-menu preferences the runner just settled and the
  dev-launcher's own state. The wipe above touches neither.
- **`subflows/factory-reset.yaml` stays, and is not redundant.** The harness wipe is the
  _precondition_; the subflow is the _coverage_ — the only thing in the suite that drives
  the erase a user would perform, on a store whose contents are known. It also means the
  reset always takes its "Factory reset" branch rather than "Forget account", because the
  device now always arrives unauthenticated.
- **A factory reset is not a first run, and its aftermath is racy.** The reminders engine
  reconciles asynchronously and the in-place provider rebuild does not wait for it: reset
  twice and Home comes back once empty and once already showing the `import-contacts`
  nudge. The subflow relaunches and _waits_ for the nudge, which is deterministic. Assert
  nothing about the screen between the erase and the relaunch.
- **Assert specific expected text, never emptiness or counts.** Home is time-dependent —
  the reminders and holidays engines mint `system` rows by date — and it is _not_ empty on
  a first run: the `import-contacts` nudge is there, and it is the better assertion
  because it also proves the engine ran.

### Three selector traps this tier added to the list below

- **A list row's accessibility text carries a trailing space.** The hierarchy reads
  `"Mary Bailey "`, and Maestro matches in full, so `assertVisible: "Mary Bailey"` fails
  against a row that is plainly on screen while the same string passes on the detail page,
  where it is the screen title. Wrap anything selected out of a list: `.*Mary Bailey.*`.
- **A filter box makes its own text a decoy.** Type "Friend" into a picker's filter and the
  _input_ now matches `tapOn: "Friend"` as well as the option row does — Maestro takes the
  input, iOS raises its Paste/Select callout, and the modal stays open. The failure then
  lands two steps later on a field that is behind the modal. Constrain the row with
  `below: {id: <the filter's id>}`.
- **On Android the keyboard is a _second_ decoy for the same word, and `below:` does not
  escape it.** Gboard's suggestion strip offers the word you just typed, and the strip sits
  below the filter — so it satisfies the very constraint that separates the row from the
  box. Maestro picked the suggestion (`resource-id=com.google.android.inputmethod.latin:…`,
  `accessibilityText=Friend`), tapped it, reported **COMPLETED**, and selected nothing; the
  sheet stayed open and Flow 2 failed two steps on. It reads as a slow list, because the
  identical two commands pass by hand a minute later — the strip has stopped offering the
  word by then. `maestro.log` is what identifies it: the `Tapping on element:` line names
  the keyboard package outright.

  There is no selector-shaped fix — anything matching the label matches all three. **Give
  the rows ids.** `PickerField` now does (`<field testID>-option-<key>`, e.g.
  `relationship-other-role-option-friend`), which is the same answer as the secure fields
  below, for the same reason.

### Budget the waits for the emulator, not for the simulator

The flows are byte-identical across platforms; their **timeouts** still have to suit the
slowest device the suite runs on, and that is the Android emulator. Flow 4's wait on the
account conversion was 60s and green on the iOS simulator four runs running; on Android the
button was still reading "Encrypting your data…" when Maestro gave up, and the reveal
appeared shortly after. Argon2id is deliberately slow and an emulator is the slowest place
we run it.

A generous budget is the cheap mistake here. Too long costs a couple of extra minutes on a
build that is genuinely broken; too short turns the gate red on a build that works, which is
the failure that gets a gate ignored.

**But fix the emulator before you touch a timeout.** Android Studio creates AVDs with as
little as **one CPU core and 2GB of RAM**, and a React Native dev client on one of those is
not merely slow — it is a different machine. Both halves of that were measured on this
repo's own `Medium_Phone_API_36.0`, one commit, one emulator image, 2026-08-31:

- **Cores.** With `hw.cpu.ncore=1`, a factory reset's relaunch needed over 90s to reach the
  tab bar — 13-second GC pauses in the logcat — and Flow 1 went red on a 60s wait. Booted
  with `-cores 6`, the same commit reached the app home in **7s**.
- **Memory, which was much harder to see.** At `-memory 4096` the guest sat at ~3.7GB of
  4GB with ~800MB in swap, and Flow 4's account conversion went **bimodal**: ~50s when it
  fit in RAM, **four to seven minutes when it did not**, red about half the time on a build
  that was working. Argon2id is _memory-hard_ by design — a 19MiB buffer touched at random —
  so it is the worst thing in the suite to page out. `adb shell cat /proc/vmstat` is what
  identifies it: `pswpout` had passed 1.4M pages (~5.6GB) on an emulator up for an hour. At
  `-memory 8192` the suite passed three runs running, conversion back at ~50-80s.

`--provision` now boots with `-cores 6 -memory 8192` (`EMULATOR_SIZE` in the harness), and
the Android prepare warns when it lands on a device with fewer than four cores — an
emulator someone else started, from Android Studio or `expo run:android`, still gets
whatever its AVD config says. Boot it yourself with:

```
emulator -avd <name> -cores 6 -memory 8192
```

or raise both in Android Studio → Device Manager → Edit. A suite tuned to pass on a starved
emulator is one that can no longer tell slow from broken, which is why the knob to reach for
is the device.

### When the device is already right, budget for the machine and guard the cheap failures

The section above fixes the device. It does not make Flow 4's conversion _predictable_, and
on 2026-09-05 the beta release gate went red on a properly provisioned emulator — 6 cores,
8GB, `hardware-qemu.ini` confirming both — with nothing wrong at all. The evidence that the
app was healthy, collected in the order worth repeating:

- the failure screenshot showed the button still reading "Encrypting your data…", no error
  beside the form and no crash;
- `logcat` filtered to the app's own pid held nothing between the tap and the timeout but
  routine GC — no exception, no `ReactNativeJS` line;
- `adb shell top -H -p <pid>` showed **`mqt_v_js` pegged at 100%** with `/proc/vmstat`'s
  `pgmajfault` flat beside it: compute, not paging, so the memory story above did not apply;
- the same commit then converted in **48.3s** and **48.8s** on the same emulator minutes
  later, and in **108.8s** with all twelve host cores deliberately saturated by `yes`;
- and then, an hour into that emulator's uptime with the host idle, in **294.5s — watched
  all the way to the reveal**, correct, on the same commit again.

That last one settles it. Six times the median, finishing properly, and red under any budget
this flow has ever carried: it is the degraded mode the memory section above first measured
as "four to seven minutes", reached with the emulator sized exactly as `--provision` sizes
it. Nothing about the build changes between a 48s conversion and a 294s one, so what the
budget has to cover is not the conversion but the machine it is sharing — and this tier is
the **last** one of a suite that has just spent fifteen minutes compiling, type-checking and
driving two devices. Flow 4's wait is therefore `480000`, set past the worst degradation ever
measured rather than a little above the median.

A budget that generous is only affordable if the _cheap_ failures stop paying it, which is
the other half of the change. Every way the form can be refused leaves the submit button
reading "Protect my data" and the app doing nothing, so the flow now asks that question
first and separately:

```yaml
- tapOn:
    id: "account-submit"
- extendedWaitUntil: # the form was accepted at all
    notVisible: "Protect my data"
    timeout: 15000
- extendedWaitUntil: # ...and only then, the conversion
    visible: "Save your recovery phrase"
    timeout: 480000
```

The same saturation run showed why: `inputText` dropped characters into the two password
fields, the form said "The passwords don't match", and the old single wait spent its entire
budget on a reveal that was never coming and then blamed the reveal. Fifteen seconds now buys
a red that names the form.

Two shapes were tried on the way here and are worth not re-deriving:

⚠️ **Do not loop `while: visible: "Encrypting your data…"`.** It is the obvious phrasing for
"wait while the app says it is working" and it is racy. `tapOn` returns as soon as the view
hierarchy changes, which on a loaded machine is _before_ React has committed the re-render,
so Maestro reads the button still saying "Protect my data", skips the loop and falls straight
through — measured doing exactly that with the host cores saturated, which is the one
condition such a loop would exist for.

⚠️ **`repeat` does not give you repeated waits.** Inside a `repeat`, Maestro honours
`extendedWaitUntil`'s timeout on the **first iteration only**: a `60000 × 8` loop measured
59s on its first tick and ~0.3s on each of the next seven, so the flow went red at 75s
believing it had waited eight minutes. Nothing warns you — the console prints eight
iterations either way. If a wait needs a ceiling, write the ceiling as the timeout.

(And the flat trap underneath both: `extendedWaitUntil` is an _assertion_, not a sleep. Unmet
at its timeout it fails the command and ends the flow, unless you mark it `optional: true`.)

### Do not leave both devices booted at once

The two platforms run in sequence; their **hardware** did not, until 2026-08-31. An Android
emulator and an iOS simulator booted together are two VMs on the same cores and the same
RAM, which is the pressure the section above shows Flow 4 cannot absorb.

This is the smaller half of that story — the emulator's own memory mattered more — but it
compounds, and it crosses platforms in a way that is very hard to read from a log: an
Android phase cut off mid-conversion leaves the app burning a core, and the **iOS** phase
after it then fails on a Maestro `testmanagerd` snapshot timeout that has nothing to do
with iOS. That happened, and it is why the harness now stops the app on the way out of a
platform however it ended.

`--provision` also shuts each platform's device down as soon as its flows are done —
**every platform, including the last**, so a provisioned run is boot → run → shut down and
inherits nothing from the run before it. Running the suite by hand, the devices are yours,
so it only warns: **run one platform at a time**, with only that platform's device booted.

```
pnpm test:e2e --platform=android    # with the simulator shut down
pnpm test:e2e --platform=ios        # with the emulator shut down
```

### Screens that are pushed _over_ the tab navigator

`app/data.tsx`, `app/settings.tsx` and `app/people/[id]/` are root-level routes: they are
pushed over the tabs and have a Back control instead of a tab bar, so **`tapOn: {id:
tab-home}` fails from any of them**. Hop back with `openLink: "leapsake://"` first. The
fourth tab is also a _menu_ (`app/(tabs)/menu.tsx`) rather than the account screen — its
rows read "<glyph> <label>", so reaching the account screen is `tab-settings` then
`.*Account.*`.

## Driving forms and fields — the traps, in the order you'll hit them

These cost several sessions to find. All of them look like "the app is broken" and are not.

### The dev client's floating menu button swallows taps — on **both** platforms

It is an **overlay**, so a `tapOn` underneath it reports **COMPLETED** while the dev menu
opens instead, and the flow then fails somewhere unrelated, one or more steps later. This
is the single most expensive trap in this directory: it cost two flows their whole run and
looks nothing like its cause in either case.

- **Android**, `global-nav.yaml`: case 3's `tapOn: search-here-people` hit the bubble, and
  the run went red two lines on at the filter chip's `assertVisible`.
- **iOS**, the retired `staged-gift-occasions.yaml`: the button's _stored position_ sat over
  the add screen's holiday row, so `stage-christmas`'s tap on the holiday field hit it and
  the flow died three cases in. Hiding it took that flow from red to **green on all five
  cases** with no edit to the flow itself.

`pnpm test:native` now settles this on both platforms before loading the bundle — see
`settleDevMenu()` / `settleDevMenuIos()` in
[`scripts/test-native.mjs`](../../../scripts/test-native.mjs). Android writes the three
prefs a **fresh install** gets wrong (`showFab`, `isOnboardingFinished`, `showsAtLaunch`)
over `adb run-as`; iOS writes `EXDevMenuShowFloatingActionButton` over `simctl spawn
defaults`.

**On iOS the build itself now carries the setting** — `ios.infoPlist` in `app.json` — so a
fresh install has the button off before anything runs, including a flow run directly. That is
a _registered default_, though: an **explicit** `UserDefaults` value wins over it, so a
simulator where the button was ever toggled by hand keeps whatever it was toggled to. Clear it
once and the build's default takes over:

```sh
xcrun simctl terminate <udid> com.leapsake.app
xcrun simctl spawn <udid> defaults delete com.leapsake.app \
  EXDevMenuShowFloatingActionButton
```

**Android has no build-level equivalent** — the pref is only ever read from
SharedPreferences — so `pnpm test:native` is the only thing that sets it, and **running a
flow directly bypasses that**. Once per install: dev menu (`Ctrl+m`) → **Tools button** → off.

Two more first-run overlays in the same family, both Android:

- the **dev-menu onboarding panel** ("This is the developer menu"), which covers the app on
  the first launch after an install until it is dismissed — handled by
  `isOnboardingFinished` above;
- the system's **stylus handwriting** dialog ("Try out your stylus"), which opens over the
  app the first time a text field takes focus. It made `add-person.yaml` fail on
  `person-last-name` with _element not found_ — the id really was absent, because the whole
  app was behind a system dialog. Disable it per emulator:
  ```sh
  adb shell settings put secure stylus_handwriting_enabled 0
  ```

### A secure field needs a `testID`, not a better tap

Two `secureTextEntry` fields on one screen (password + confirm password) carry **identical,
empty accessibility text**, so a driver has nothing to tell them apart by. Tapping the second
one by text or by point reports **COMPLETED** and types into nothing — the form then fails its
own "passwords don't match" check, or the submit button stays disabled, and it reads as a
platform limitation on secure input. It isn't: it is a selector problem.

The account form carries ids for exactly this reason (`app/settings.tsx`):
`account-username`, `account-password`, `account-confirm-password`, `account-submit`. Target
those and the form fills first try. **Add ids to any other form you need to drive** — that is
the anchor set the crucial-flow catalog calls for, grown one flow at a time.

The unlock gate is the second form to need them (`lib/core-context.tsx` → `RecoveryGate`, added
for Flow 7c): `recovery-gate` on the container, `recovery-secret` on the field's **wrapper** (see
the next section for why it is not on the input), and `recovery-submit` on the button, whose
label `Unlock` is a prefix of the screen's own title `Unlock your data` and flips to `Checking…`
mid-submit. One id serves both doors because only one field is mounted at a time; which door you
are on is read off the visible label beside it.

### A `multiline` field has no id at all — put it on a wrapper

Worse than the secure-field problem above, and it looks nothing like a selector bug. A
`multiline` `TextInput` is a **`UITextView`** on iOS, and the node XCUITest exposes for it
carries **no accessibility identifier whatsoever** — dump the hierarchy and you find a scroll
view with two scroll bars where your field should be, while the screenshot shows the field
rendering perfectly. `testID` on the input is simply lost.

Flow 7c hit this on the gate: the password door's field (single-line, secure) resolved first try,
and the phrase door's, reached by switching, did not exist as far as the driver was concerned. A
plain `View` **does** carry its id, so the fix is to wrap the input and put the anchor there — a
tap at the wrapper's centre lands on the field and focuses it. Do it on both branches of a form
that switches field kinds, so a flow does the same thing whichever one is up.

When a `tapOn` by id fails on a field that is plainly on screen, read the hierarchy before
theorising: `~/.maestro/tests/<run>/<flow>/screen-hierarchy/*.json`, alongside a screenshot of
the same moment. The attribute is `resource-id`, and its absence is the whole story.

### The gate's keyboard, and a bug the harness found rather than worked around

`dismiss-keyboard.yaml` works by tapping a plain `Text` and relying on the enclosing scroller's
`keyboardShouldPersistTaps="handled"` to blur. `RecoveryGate` had no scroller, and its phrase
field is `multiline` — so `pressKey: Enter` inserted a newline instead of dismissing, the
fallback tap blurred nothing, and the keyboard sat over **Unlock**.

**That was not a harness problem to route around.** Measured on an iPhone 16 Pro: field at
y419-507, Unlock at y520-565, keyboard from ~538. A real user who reached for their 24 words
typed them and then had no way to press the button, and no way to put the keyboard away either.
The gate is now a `ScrollView` with `keyboardShouldPersistTaps="handled"`, which fixes the app
and makes the subflow work anchored on `"Unlock your data"`. Worth the habit: when a flow cannot
reach a control, check whether a user could.

**On Android the subflow was blind, and the first Android run of 7c found it** (2026-09-10).
Its keyboard probe was `id: Return` — the iOS keyboard's key — which Gboard never has. So the
fallback tap never ran and the closing `assertNotVisible` passed with the keyboard still up.
The reminder flow had been passing over the same hole because its next tap, **Save**, sits above the
keyboard. On the phrase door, **Unlock** does not: the tap on `recovery-submit` resolved to the
button's bounds from the hierarchy, landed on Gboard at the same point, and opened **Gboard's
Settings**. The screenshot of that failure shows no app at all. The subflow now probes each
platform's keyboard by its own id: on Android, anything whose `resource-id` is in
`com.google.android.inputmethod.latin`. The rule it leaves: **a keyboard probe that can't
see the keyboard passes every time**, so check each new probe against a keyboard that is
actually up on every platform.

### iOS does not draw the dots in a `newPassword` field under automation

A field with `textContentType="newPassword"` holds the value you typed but renders **empty**
in a screenshot. Judge by a side effect instead — the password-strength hint below the field,
or the submit button enabling — never by looking for dots. Its sibling trap:

### AutoFill Passwords: a real precondition, enforced by a preflight

With **Settings → AutoFill & Passwords** on, iOS's "Automatic Strong Password" cover view
swallows keystrokes into `textContentType="newPassword"` fields entirely.

**It comes back**, and two different things bring it back: installing the iOS 26.5 (23F77)
runtime did on 2026-09-08, and a `simctl erase` does (2026-09-17). Both times Flow 4 reddened
on a form whose code had not changed, naming the _password length_ rather than the cover view.

There are two manifestations, and they are not equally survivable. The one-shot **"Use Strong
Password?" card** is defeated by `subflows/create-account.yaml` typing the password, tapping
away, and typing it again — iOS does not offer the card twice. The persistent **cover view**,
which is what a freshly erased simulator produces, is not: the second attempt is swallowed
too. This section used to say the toggle was "a convenience, not a precondition" on the
strength of the first; the second cost a `pnpm release beta` 22 minutes into its suite on
2026-09-17.

So the toggle is now a precondition and the harness enforces it. `ios-autofill.yaml` reads the
switch through the Settings app — the setting is in no preference plist, so its own UI is the
only reader — and `scripts/lib/mobile-harness.mjs` runs it before the catalog: it fails in
seconds naming AutoFill, and under `--provision` turns it off instead. Keep the double-type in
the subflow; it costs a second and still covers the card.

**Nothing in the harness can see the card**, which is why the fix is unconditional rather
than guarded: it is drawn by a system process and absent from the hierarchy Maestro reads, so
`runFlow: when: visible:` has nothing to key on. Neither chunked `inputText` nor
`pasteText` avoids it, and neither does changing the field's `textContentType` or
`autoComplete` — iOS offers the card for a signup-shaped form regardless (all measured
2026-09-08).

### Never edit app source while a suite is running

Metro is watching. A source edit mid-run — even a comment-only one — pushes a Fast Refresh into
the app under test, and the flow loses whatever transient state it was standing on. Hit while
building Flow 7c: an edit landed during Flow 1 and the factory-reset confirmation it had just
armed was gone, so the red read `Element not found: Erase everything` and named the app rather
than the edit. There is no signal in the log that a refresh happened. Edit between runs.

### Flows do not share state, and `pasteText` will not smuggle it

**Each flow is its own `maestro test` process** (`scripts/lib/mobile-harness.mjs` runs one per
entry in the suite), so `output.*` and `maestro.copiedText` do not survive from one flow to the
next. Only the _device_ carries state forward — the app's own store, keychain and roster — which
is exactly why `e2e/` is an ordered arc rather than a set.

**`pasteText` is not a clipboard read**, and this is worth knowing before it costs you an
afternoon: `Orchestra.pasteText` replays Maestro's _own_ `copiedText` field through
`Maestro.inputText`. It never touches the device pasteboard, so a value the app put there — the
recovery reveal's **Copy** button, say — is invisible to it (verified against
`~/.maestro/lib/maestro-orchestra.jar`, Maestro 2.8.0).

Together those two decide the shape of any flow that needs a secret the app shows **once**: it
has to be the same flow that watched the secret appear. That is why Flow 7c inherits `04`'s
password (a constant this repo already knows) while Flow 7b creates its own account rather than
reusing the one `04` made — see [`../../../plans/testing/crucial-flows.md`](../../../plans/testing/crucial-flows.md)
→ _The phrase-capture rule_.

### Capturing a secret the app shows once: `repeat` + `copyTextFrom` + `output`

This is how `e2e/07b-phrase-door.yaml` gets the 24 recovery words off the reveal, and it cost
**4 seconds** for the whole grid on the first attempt — no scrolling, and no new app surface,
which is why the catalog's proposed `recovery-phrase` anchor was never built and the phrase is
still never exposed as a single string anywhere in the app.

The grid renders 24 numbered `Text` nodes (`1. abandon`), so the loop walks them by number:

```yaml
- evalScript: ${output.n = 0}
- evalScript: ${output.phrase = ""}
- repeat:
    times: 24
    commands:
      - evalScript: ${output.n = output.n + 1}
      - copyTextFrom:
          text: "${output.n}\\. .*"
      - evalScript: '${output.phrase = output.phrase + " " + maestro.copiedText.replace(/^\d+\. /, "")}'
- evalScript: ${output.phrase = output.phrase.trim()}
```

Four things make it work, and three of them are not obvious:

- **`repeat` has no loop index.** The counter has to live in `output` and be incremented as the
  first command inside the loop.
- **Text selectors are full-match**, which is what makes numbering safe: `1\. .*` matches
  `1. abandon` and never `11. abandon`. A substring matcher would have silently captured the
  wrong word.
- **An `evalScript` must contain no `{` or `}`.** Interpolation closes a `${...}` at the _first_
  `}` it finds, so a brace inside the script truncates it and the error is a syntax error in
  something you did not write. Avoid object literals and braced arrow bodies entirely.
- **`maestro.copiedText` is readable from `evalScript`** (`GraalJsEngine` binds it), which is the
  whole mechanism. It still does not survive the flow — see above.

Follow the loop with `assertTrue` on the shape, not just on the lookup: a `copyTextFrom` that
finds nothing fails its own step and names the word, but a prefix that failed to strip would sail
through and be rejected much later by the codec, naming the door instead.

```yaml
- assertTrue: '${output.phrase.split(" ").length == 24 && output.phrase.indexOf(".") < 0}'
```

### `eraseText` cannot clear a `multiline` field, and no count fixes it

`eraseText` presses backspace, so it deletes **backwards from the caret** — and `tapOn` puts the
caret where it taps, which is the element's **centre**. On a single-line field that is the end of
the value and the distinction never shows. On the gate's four-line phrase field it is the middle
of the text.

Flow 7b lost two runs to this. Its negative case types a 210-character wrong phrase; a bare
`eraseText` (50 backspaces) and then `eraseText: 250` both left a tail, `inputText` inserted the
real phrase at the caret, and the field ended up holding `<24 real words> abandon … art`. The
door rejected that correctly, so **the red landed several steps later on the unlock** and named
the door rather than the erase. Only a screenshot showed it.

**Clear the field through the app's own state instead.** On the gate that means leaving the door
and coming back — `switchTo` does `setSecret("")` — which is deterministic, needs no new surface,
and is a round-trip a real user takes. Where no such affordance exists, relaunch. Reach for a
backspace count only on a field you know is single-line and short.

### A wrong password costs exactly what a right one costs

The password door derives Argon2id from a salt carried **inside the sidecar**, so there is no
cheap rejection path: a deliberately wrong password in Flow 7c pays the same 19MiB memory-hard
pass as the real one — 25s each on the iOS simulator, and `04`'s notes document how much worse a
loaded machine gets. Budget every unlock wait like `04` budgets its conversion, and put the
negative case first so a build that is broken anyway fails on the cheaper end of the flow.

The **phrase** door is the opposite: it unwraps raw key material and derives nothing, so a wrong
phrase comes back in ~0.12s. Its waits do not need the big budget.

And a busy label only helps if it reaches the screen. The gate's "Checking…" did not, at first:
resolving into a synchronous Argon2id pass hands the work a _microtask_, which runs before React
commits, so the button kept reading "Unlock" for the whole derivation. If you are guarding a slow
step with its busy text — worth doing, it is what turns an eight-minute mystery into a
fifteen-second failure — check the app actually paints it before trusting the guard.

### Selector and keyboard miscellany

- Maestro text selectors are **full-match**: the tab bar wants `.*Settings.*`, not `Settings`.
- `hideKeyboard` fails on secure fields. Use `pressKey: Enter`, or tap a static label.
- With two account forms on screen, every duplicated label ("Username", "Password") needs an
  explicit `index` — or, better, an id.

### The Forget-account confirmation _is_ drivable now

This section used to say the **last-device Forget-account confirmation** could not be driven —
the keyboard covers "Delete all data", and dismissing it was thought not to help because the
layout reflows as the keyboard goes and the tap lands on whatever moved under it. Retried while
building the E2E arc _(2026-08-28)_ and it works, with the same two things the Factory-reset
confirmation needs: an `id` on the confirm field, and `dismiss-keyboard.yaml` anchored on a
plain `Text` _above_ the reflow — the section title, not the button.
`subflows/factory-reset.yaml` drives it, which is what makes the arc re-runnable: Flow 4
leaves an account behind, and this is the only in-app way back.

The screen would still be better with a `KeyboardAvoidingView`; that is now a UX preference
rather than a harness blocker.
