# `@leapsake/view-models`

The **headless derivations** every client shows the same way — grouping, partitioning and
ordering over data that has already been loaded. Pure functions: no repo access, no DOM, no
React, no platform. That is what lets the Electron renderer, the Expo app and (later) the web
app share them instead of each keeping its own copy of the same sort.

## Why this exists

Desktop and mobile were maintaining these four derivations twice, byte-for-byte in places: the
gift idea union-and-sort, the observed/addable holiday split, the reminders open/done partition,
and the given-sinks ordering on the Gifts screen. Duplicated _presentation_ is cheap; duplicated
_decisions_ are not — the two clients can silently disagree about which gifts lead the list.

## The boundary against `packages/core`

- **Needs repo or driver access ⇒ `@leapsake/core`** (its `views.ts` keeps those view-models).
- **Pure derivation over already-loaded data ⇒ here.**

Revisit the rule if it starts needing judgment every time; so far it hasn't.

## Shape

Every function is **generic over the caller's row type** and constrains only the fields it
reads (`GiftIdeaRef`, `BearerHolidayFacts`, `ReminderStanding`). Core's row types stay
structurally assignable, each client keeps its own type on the way out, and this package stays
off the data layer — the same posture `@leapsake/ui` takes with core's types.

**The clock is a parameter, never a read.** `partitionReminders` is the first derivation here
that depends on the current time (it holds a snoozed reminder back until the day its snooze
ends), and it
takes `now` so the split stays deterministic and testable; the `Date.now()` default is caller
convenience. Any future time-dependent derivation does the same — a function that reads the
clock itself cannot be tested without faking a global.

**Time-dependent derivations compare civil days, never elapsed milliseconds.**
`bucketReminders` splits the list into belated, today, next 7 days and later;
every comparison in it goes through `daysUntil` over the two ends read as calendar dates, so
the buckets flip at the _viewer's_ local midnight rather than 24 hours after some instant —
the same arithmetic the reminder engine's own window does, and the reason the two can never
disagree about what "today" means.

It is a refinement of `partitionReminders` rather than a replacement: it calls it first,
passes its `done` bucket straight through, and files the snoozed rows by the day they come
back. The reasoning for the sections is under _The reminders list_ below, and
`reminderCountdownOf` chooses the date each row shows so that it matches the order. What it needs beyond `ReminderStanding` is two dates only the
reminder engine can supply (`ReminderTiming`), because the stored row carries neither the
occasion it counts down to nor the day it went on display.

Dependencies: `@leapsake/schema` and `@leapsake/reminders` (for `onboardingRouteOf`, the
well-known-id lookup behind an onboarding nudge's CTA). Never `core` or `data`.

## The reminders list

**Snooze is a display filter, and must stay one.** `partitionReminders` holds a snoozed row back
until the civil day in `snoozedUntil` begins; completion wins over snooze. A deferral done in the
engine, as "stop desiring the row", would be pruned to a tombstone by `reconcile`, and a tombstone
is never resurrected, so "not now" would silently mean _never_. The hide never re-ranks: an
un-snoozed row sorts exactly as before. The `snoozed` bucket is returned rather than dropped, so
whether search should find a snoozed row stays open.

`bucketReminders` splits the open rows into four sections _(owner, 2026-09-11)_:

- **Belated**: everything overdue, in two kinds under one heading. First a deadline that blew
  while the occasion is still ahead (the card missed its post, but the birthday is Tuesday),
  because acting on it still has the most value on the screen; then occasions that have gone,
  where only acknowledgment is left. Only the occurrence tells the two apart, which is why
  `occurrenceDate` travels with the row; an overdue user reminder has none and counts as
  salvageable. Each row's countdown already says which kind it is, so one heading serves.
- **Today**: **everything that can be done now**, not only what is due today. A month-long gift
  errand is on Today, known by its "Due in N days", and leaves by being done, dismissed or put off.
  So `owed`, belated plus today, is everything actionable, and reaching zero is a real finish line.
  **Dateless rows lead** (onboarding nudges, the duplicates nudge, an undated user reminder;
  _owner, 2026-09-04_): each has been owed since it appeared and time will never move it up, so a
  busy morning cannot bury the getting-started steps.
- **Next 7 days** and **Later**: rows not on display yet, and rows put off, by the day each next
  enters Today (`landingDayOf`). _Later_ is not everything beyond a week: a system row exists only
  inside the engine's display window, while a user's own reminder can be months out.

**Each section is ordered by the date that moves a row out of it**: Today by due date, the later
sections by the day a row enters Today, and belated, with nowhere further to go, by the date each
row shows. The countdown a row shows is that same date, so the numbers on screen read in order; a
`plan` question on Today shows its deadline as _due_, not its occasion, so it never reads as the
birthday.

**What a row offers** (`reminderCtaOf`, `reminderActionsOf`), in order of escalating finality:

- **Do it**: one main call to action, the highest that applies: an onboarding nudge's step; the
  duplicates review; a `🗓 plan` prompt's answer, carrying its offer set so the answer needs no
  second read; a `🎁 gift` reminder's recipient, then on completion logging what was given; a
  partnership question's missing date, opening the form on the right kind; a couple's occasion
  missing its partner; and last, a `🎉 wish` for someone with **no way to
  reach them**. That last is a nudge, never a wall: the reminder stays completable with no
  contact method, and a reachable person gets their methods as buttons instead. Completion stays
  the plain Done, with no modal.
- **A second call to action** may sit beside the first _(owner, 2026-09-05)_: "who is this
  wedding with?" completes a _record_ rather than doing the errand, so it never competes with the
  row's point. Queued behind the main CTA, it appeared only for the few days a year nothing
  outranked it.
- **Just the day**: a `plan` prompt's one-tap answer, the commonest, which writes the **full**
  offer set with only `wish` enabled, so it counts as answered. A client that renders the prompt
  as only a link to a settings screen has lost the trade the prompt makes.
- **Remind me in…**: one per `SNOOZE_PRESET_DAYS` preset (tomorrow, three days, a week; _owner,
  2026-09-11_) that `snoozeTargetOf` allows, on any row. Never on a row due today or belated,
  never past the due date, never on a row not yet on display.
- **Don't ask again**: offered from the first encounter _(owner, 2026-09-11)_, and only on rows
  Leapsake asked unbidden (nudges, `plan` prompts, partnership questions), since an ordinary
  reminder's Remove is already a permanent tombstone. With nothing retiring by being put off, it
  is the one way a question goes for good. A `plan` prompt's is **Don't ask again…**
  (`stop-asking`) _(owner, 2026-10-01)_: _this year_ retires only this year's question, and
  _ever_ stops its milestone asking at all.

A completed reminder offers its CTA and nothing else.

## What stays with the client

Routes and copy. `reminderCtaOf` returns the _decision_ — an onboarding nudge, the duplicates
nudge, or a gift reminder pointing at its recipient (flipped once done) — and each client maps
that to its own router path and its own user-visible label, because the two routers spell the
same screen differently and the label is translatable text.

`reminderActionsOf` widens that seam from one call to action to the _list_ of things a row
offers — do it, remind me in…, don't ask again — with the CTA as one entry in it. The same
division holds: this package decides which are offered and for how many days
(`SNOOZE_PRESET_DAYS`); “Remind me tomorrow” and “Don't ask again” are copy, so they stay with
the client.

`reminder-row.ts` takes the row the rest of the way. `reminderOfferLabelOf` names which words
an offer wears, as a key (`"linkSpouse"`, `"remindMe"`), and `reminderRowOf` says whether a row
shows Remove and whether removing it is a delete or a “don’t ask again”. An open nudge or
`🗓 plan` prompt shows no Remove, since its own dismiss is the same tombstone. Each client keeps
a table from those keys to its own words (desktop's links end `→`, mobile's `›`), and its own
path per call to action.
