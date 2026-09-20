# Store-listing screenshots

Flows that populate the app with a presentable roster and capture the screenshots a store
listing needs. **Not a test tier** — nothing here asserts on behaviour, and nothing runs in
CI. They exist because a listing needs pictures of a _full_ app, and the e2e arc leaves two
people in it.

First used for the Play listing on 2026-09-15. The same captures serve the App Store listing
and the website; only the device driver differs.

## Why not just run the e2e arc

Flows 2–3 leave **Mary and George Bailey, one relationship and one birthday** — correct for
assertions, thin for a store listing: a relationship manager whose roster screenshot holds two
people argues against the product. ⚠️ And the arc's tail is actively destructive here —
`e2e/07b-phrase-door.yaml` **opens by resetting the device**, which would erase exactly the
store you are photographing.

## Prerequisites

A booted device, the dev client installed, and Metro running — the same three
`scripts/lib/mobile-harness.mjs` assumes. `base.mjs` reports whichever is missing.

```sh
pnpm --filter @leapsake/mobile dev        # Metro, from apps/mobile
adb reverse tcp:8081 tcp:8081             # so the emulator reaches localhost
```

## The sequence

Run in order; each builds on the last.

```sh
# 1. Reset, then the base state: Mary + George, a relationship, a milestone, a reminder.
#    Runs a SUBSET of the e2e arc through the harness — flows 01, 02, 03, 05 only.
node apps/mobile/maestro/store/base.mjs --platform=android --device=emulator-5554

cd apps/mobile/maestro/store
M="$HOME/.maestro/bin/maestro"
"$M" --udid emulator-5554 test 01-roster.yaml        # 11 more people + a pet + birthdays
"$M" --udid emulator-5554 test 02-reminders.yaml     # reminders with distinct tags
"$M" --udid emulator-5554 test 03-relationship.yaml  # the hero record's relationship
"$M" --udid emulator-5554 test 04-capture.yaml       # the screenshots
```

⚠️ **The captures do not land in the working directory.** `takeScreenshot` writes relative to
Maestro's own run directory:

```
~/.maestro/tests/<timestamp>/04-capture/takeScreenshot/shots/*.png
```

Find them with `find ~/.maestro/tests -name '06-holidays.png'` rather than guessing the path —
the run directory is timestamped and the newest is not always the one you want.

## Traps these flows encode

Each cost a failed run to find.

- ⚠️ **Never assert on a person's name to know their page has loaded.** `app/_layout.tsx` gives
  a pushed screen **the name the linking screen sent**, so the header reads "Harry Bailey"
  while the body is still empty. `assertVisible: "Harry Bailey"` passed against a completely
  blank page and the capture was a header over nothing — 27KB where a rendered page is 150KB.
  Wait on a **section heading** (`Milestones`, `Relationships`); those exist only after the
  record loads.
- ⚠️ **The holidays list is ordered by date proximity and virtualised.** Only the next few
  weeks are mounted, so waiting on `New Year's Day` in September times out having never
  rendered. Wait on a holiday near _today_. (The apostrophe is not the problem — the stored
  name is plain ASCII.)
- ⚠️ **There is no Holidays tab.** `(tabs)/_layout.tsx` gives gifts, holidays and tags
  `href: null` — they sit in the tab group deliberately _without_ a bar button and are reached
  from Search's browse tiles. `tab-holidays` does not exist; use `browse-tile-holidays`, whose
  key is verified in `lib/search-categories.ts`.
- ⚠️ **Fill a reminder's body BEFORE its title.** A long title typed first wedged the form —
  it closed and returned to the page underneath, and that reminder never saved. The mechanism
  was never pinned down; the ordering avoids it, and a reminder needs only a title to be worth
  showing, so the risky field goes in while the form is fresh.
- ⚠️ **A stuck keyboard survives `openLink`.** Gboard left open by an abandoned form covers the
  tab bar, and Maestro does **not** model the keyboard as occluding anything — so `tab-search`
  is "visible" in the hierarchy and the tap lands on a key. Recovery is two Back keyevents
  (`adb shell input keyevent 4`) then the dev-client link. To _detect_ it, probe for any node
  whose id matches `com.google.android.inputmethod.latin:id/.*`, as `subflows/dismiss-keyboard.yaml`
  does — a hierarchy dump alone will not tell you.

## What is deliberately absent

**Contact methods and gifts.** `components/ContactMethodFields.tsx` and
`components/GiftCaptureForm.tsx` carry no testIDs on their text inputs, so driving them means
text selectors beside unlabelled `TextInput`s — the fragility `subflows/` exists to avoid. The
person page therefore shows "No contact methods yet" and "No gifts yet". Adding testIDs to
those two components is the fix, and it is worth doing before the next listing refresh.

**Real dates on birthdays.** `MilestoneFields.tsx` passes no testID to the Month `SelectField`,
so its options cannot be addressed on either platform and a birthday can only be given a
**year**. `SelectField` suppresses its testID on iOS only, so this is not an iOS-vs-Android
thing — the id simply is not passed.

## Reproducibility

⚠️ **These captures are not byte-reproducible.** The status-bar clock, battery and signal move
between runs, so the same screen captured minutes apart differs (measured: `dfa695e3…` vs
`b171ce0c…`, at different file sizes). That matters if anyone ever wants "upload only if
changed" — see `plans/android-pipeline.md` → `play.mjs`. Android's SysUI demo mode pins the
chrome and is the fix, and is not done.
