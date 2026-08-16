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

## The 30-day horizon is not enforced here — it falls out of the caller's data

iOS caps pending local notifications at 64 and silently drops the rest. That looks like the
dominant constraint; it isn't, because a `system` reminder doesn't exist in the store until its
due date is within `@leapsake/reminders`' `LEAD_DAYS` (30) of today. So `planNotifications` reads
reminder rows as-is and applies no independent horizon filter — the bound is a property of what
the composition root hands it, not something this package re-derives. A far-future `user`
reminder just adds one more candidate; `each` mode's `NOTIFICATION_BUDGET` (60, not 64 — headroom
for a stray notification scheduled elsewhere) is the real backstop.

## `digest` vs `each` — same schedule, different tap targets

Every reminder due on a given day fires at the same `deliveryMinute` in either mode: `each` is not
more timely, it is _digest, exploded, with a tap target per item_. `planNotifications` reflects
that directly — both modes derive from the same eligible-reminder set and the same per-day
grouping; `each` just skips the bundling step. Digest copy (`digestCopy` in `planner.ts`) is
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
