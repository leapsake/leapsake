# `@leapsake/notifications` — the local-notification planner

What this package owns, and the decisions that constrain anyone changing it. The API surface is
documented on the exports themselves (`src/index.ts`); this file is the design behind them.
Built as `08 Inc 2` (`plans/v0-1_08_local-notifications.md`); Inc 3 (the mobile adapter and UI)
is tracked in [`plans/status.md`](../../plans/status.md).

## The shape: a second reconcile behind the first

`@leapsake/reminders`' `regenerateSystemReminders` computes the desired set of `system` reminders
for today and reconciles the store to it. This package is **the same move, one layer out**:
compute the desired set of pending OS notifications, diff it against what is actually scheduled,
cancel and schedule the delta. `planNotifications` is the compute half; `reconcile` is the diff
half — split so the composition root can read `pending` from the OS between the two.

Same idempotence, same triggers (boot, foreground, post-write) — a client wires both engines to
the same reconcile points and gets no new plumbing for completion, dismissal, snooze, milestone
edits, or sync-pulled changes; they already kick the first reconcile, which is upstream of this
one's inputs.

## Store what happened, never what to do next

The OS pending set is **derived state**, rebuilt from reminder rows on every reconcile. Nothing in
this package persists "the next digest fires on 15 August" — `planNotifications` recomputes the
whole desired set from scratch every call, keyed on `now`.

## Which days notify _(owner, 2026-09-11)_

A reminder notifies on its **due day** — the one that matters most — and on **every day it enters
Today**: the day it goes on display (`activeFrom`) or the day a snooze ends, whichever is later. A
day that is both is one notification. So putting a row off schedules its own return the moment it
is set, with no new plumbing: the post-write reconcile already runs then.

⚠️ **A snoozed row stays in the plan.** It used to be dropped while snoozed, which cancelled its
due-day notification until some later reconcile re-added it — and on a device nobody opened in
between, never. Completed, deleted and onboarding rows stay silent. The rule is one function,
`notifyDaysOf` in `src/planner.ts`.

## The horizon is the caller's, the budget is this package's

`planNotifications` applies no horizon filter of its own — how far ahead to look is a property of
what the composition root hands it. Historically that made the horizon ~30 days by accident: a
`system` reminder isn't a row until its own action's `activeDays` puts it on display, so planning
from stored rows could only reach that far. That was a bug, not a design: notifications
are only ever scheduled while the app is running, so a device left unopened worked through 30 days
of plan and then went quiet — failing exactly the user a reminder app exists for. Callers now pass
a year's worth via `listNotifiableReminders`, which computes the reminders that _will_ exist
without writing them (see `@leapsake/reminders`' `NOTIFICATION_WINDOW_DAYS`).

What this package does own is the **budget**: both modes are capped to the soonest
`options.budget`, defaulting to `NOTIFICATION_BUDGET` (60 — the tightest platform ceiling, iOS's
64 minus headroom; each platform's real number lives with the code that knows its platform). The
cap applies to `digest` as well as `each`, because the 30-day bound that made digest hard to
overshoot no longer exists — and never covered far-future `user` reminders anyway.

## One slot is spent telling the user the schedule is running out

The plan reserves a slot for a **service notice** (`tripwireFor` in `planner.ts`) that fires 30
days before the last scheduled notification: _"Your reminders are running out — open Leapsake to
keep them coming."_ Coverage lapsing is otherwise indistinguishable, from the outside, from having
no birthdays coming up.

Three properties it gets from the reconcile design rather than from logic of its own: it can only
fire if the device is genuinely dormant (every app open re-plans it further out), it cannot nag
(scheduling requires a running app, so a dormant device gets exactly one), and its `fireAt` tracks
coverage rather than `now`, so a steady-state reconcile stays a no-op.

The slot is taken back only if a notice is actually warranted — holding one unconditionally would
burn it on nothing whenever coverage is already too short to warn about, which is the
heaviest-user case that can least afford it.

This is the **one** app-generated notification allowed through; onboarding nudges are still barred
(`onboardingRouteOf`). The distinction to hold: a service notice reports that something the user
asked for is about to stop working; re-engagement tells them they'd get more out of coming back.

## `digest` vs `each` — same schedule, different tap targets

Every reminder notifying on a given day fires at the same `deliveryMinute` in either mode: `each`
is not more timely, it is _digest, exploded, with a tap target per item_. `planNotifications`
reflects that directly — both modes derive from the same (reminder, day) pairs `notifyDaysOf`
yields; `each` just skips the bundling step. Digest copy (`digestCopy` in `planner.ts`) is
computed at plan time and is **provisional wording** — free to change without touching the
reconcile mechanics, which only care about the `title`/`body` shape, not their content.

## Fire time is local wall-clock math, not the due-date storage convention

A due date is stored as UTC midnight of a timezone-free civil day (`@leapsake/schema`'s
`dueDateMs`/`civilFromDueMs`). A notification's `fireAt` is a real instant the OS fires at, so it
is built with the local `Date` constructor instead — "the current zone at schedule time," per the
plan. Travel or a DST shift is corrected by the next reconcile re-deriving `fireAt` from scratch,
never by adjusting a previously-scheduled instant.

## The reconcile has no update-in-place

An OS local notification generally can't be edited once scheduled — only cancelled and
re-scheduled. `reconcile` compares each desired entry against the pending one at the same `id` by
full content (`fireAt`/`title`/`body`); a byte-for-byte match is left alone (steady-state issues no
scheduler calls), and any drift cancels-then-reschedules rather than trying to patch it.

## What is deliberately not here

- **No OS calls, no `@leapsake/core` / `@leapsake/data` dependency.** The scheduler is the
  injected `NotificationScheduler` port; Inc 3 supplies the real one
  (`expo-notifications`), and a future desktop applier (Electron's `Notification`) can share this
  package unchanged.
- **No device policy storage.** `notification_settings` (migration 29) and its repo are
  `@leapsake/data`'s; this package only reads the `mode`/`deliveryMinute` shape (`NotificationPolicy`)
  off whatever row the caller passes.
- **No permission handling.** Asking for OS permission, and what to do on denial, is Inc 3's.
