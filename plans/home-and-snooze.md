# Home sections + "Remind me in…" — implementation plan

## Context

Home splits open reminders into Belated / Today / Available / Coming. The Available↔Coming line
lives in a date no row shows (`activeFrom`), and a month-long errand in Available means a day never
has an earned finish line. Snooze is a per-kind nag budget (`snoozeCount` + repetitions) that
*retires* prompts after two "not now"s, is only offered on nudges and prompts, and silently drops a
snoozed row's due-day notification until the app is next opened.

Owner decisions (2026-09-11):

- **Today** absorbs Available. Everything on display is owed; clear it (do / snooze / dismiss) and
  the day is done.
- **Coming** → a closed **Next 7 days** section which, expanded, reveals a closed **Later**.
- **"Remind me in…"** replaces every "not now": Tomorrow / In 3 days / Next week, always to the
  **start** of that day, never past the due date, never on a row due today or belated. Available
  on every origin. Build it on an arbitrary day count so a user-chosen duration is UI-only later.
- **`snoozeCount` goes.** Nothing retires by being put off; only an explicit dismiss hides a row.
  "Don't ask again" is offered from the first encounter.
- A snoozed row allows every usual action; **completing clears the snooze**.
- A **dated user reminder enters Today on its due date** (today: on display from creation).
- **Notifications**: a row notifies on every day it **enters Today** (start day, snooze-end day)
  **and** on its **due day** (the more important one). Onboarding nudges stay silent.
- Wording: Today → "Due in 5 days" (questions too); Later sections → "Back in 3 days" for snoozed
  rows, "In 3 days" otherwise. Rows sort by the date that moves them to the next section.
- Lands **before App Store submission**.

## Design decisions made in planning

- **A snooze end is a civil day**, encoded like `dueDate`/`activeFrom` (epoch-ms UTC midnight,
  `dueDateMs`/`civilFromDueMs` in `packages/schema/src/reminder-schedule.ts`). Every date the list
  buckets on is then one encoding, synced devices agree on the day, and "start of tomorrow" is
  exact. The two instant comparisons change to civil ones: `partitionReminders`
  (`packages/view-models/src/reminders.ts:58`) and `isNotifiable`
  (`packages/notifications/src/planner.ts:245`) — a row is snoozed while
  `daysUntil(today, civilFromDueMs(snoozedUntil)) > 0`.
- **Order so every commit is shippable**: notifications first. If snooze widened before the
  planner learned to keep snoozed rows, a snoozed birthday errand could lose its due-day
  notification in between.
- **"Remind me in…" is three full-sentence buttons**, not a sheet: "Remind me tomorrow", "Remind me
  in 3 days", "Remind me next week" — one tap, no Android 3-button `Alert` limit, and only the
  options that fit before the due date render. One label function of `days`, so a custom duration
  reuses it.
- **Snooze offered only on rows on display or already snoozed** — not on not-yet-started rows,
  where it would change nothing.

### Consequences worth knowing (follow from the rules, not new decisions)

- A dated **user** reminder is only on Today on its due day, and due-today rows can't be snoozed —
  so **user reminders are never snoozable** (only done / edited / deleted). Same for any system row
  that starts on its due day (the day-of wish). Snooze is for lead-time rows and dateless rows.
- Two notifications per lead-time row (start + due) spends the 60-slot iOS budget faster; the
  existing tripwire (`tripwireFor`) already covers running short.

## Steps — each a commit (or two), each shippable on its own

### 0 · Put the plan in the repo
- `plans/home-and-snooze.md` — this plan (deleted in step 5).
- `plans/shipping.md` Part 1: new step before **6 — Submit** (renumber Submit to 7).
- `plans/status.md` *Next, in order*: insert before ④ Submit.

### 1 · Notifications: due day + every day a row enters Today
`packages/notifications/src/planner.ts`
- `NotifiableReminder` gains `activeFrom?: number | null` (already on `WindowedReminder`, which
  `listNotifiable` returns — mobile passes it straight through at `apps/mobile/lib/core-context.tsx:556`).
- Replace `isNotifiable` + per-mode planning with one expansion to **(reminder, civil day)
  events**: due day (if dated); entry day = the later of `activeFrom`'s day and the snooze-end day
  (if any). Dedupe on (reminder, day). Snoozed rows are **kept** — only events before the snooze
  ends are dropped. Dateless rows notify on their snooze-end day only. Onboarding still excluded
  (`onboardingRouteOf`), completed/deleted still excluded.
- `planEach`: id becomes `each:${reminderId}:${iso}` (one reminder can now have two). `planDigest`
  groups events by day, a reminder at most once per day. Copy unchanged (provisional per its doc).
- Snooze already triggers a reconcile (post-write kick, `core-context.tsx:530`), so tomorrow's
  notification is scheduled the moment it is set — no new plumbing.
- Tests: `packages/notifications/test/planner.test.ts` — due day; start day; snooze-end day; start
  == due dedupes; snoozed row keeps its due-day entry; dateless snoozed row; onboarding silent;
  digest groups both kinds.
- Docs: `packages/notifications/README.md` rule statement.

### 2 · The snooze model
**2a — rule + write** (`@leapsake/reminders`, `@leapsake/data`, `@leapsake/schema`, `@leapsake/core`)
- `packages/reminders/src/engine.ts`: replace `snoozePolicyOf` with
  `snoozeTargetOf(row, days, now) → number | null` — `dueDateMs(today + days)`, or `null` when the
  row is completed, dated and due today/past, or the target day is after its due day. Delete
  `snoozeDurationDays`/`snoozeRepetitions` from `ONBOARDING_STEPS`, `hasSpentItsSnoozes`,
  `PARTNERSHIP_SNOOZE_*`, `PLAN_PROMPT_SNOOZE_*`, and both retire-by-budget branches in reconcile
  (`engine.ts:1949`, `:1997`). Export from `packages/reminders/src/index.ts`.
- `packages/schema/src/reminder.ts`: drop `snoozeCount` from `reminderSchema`; drop its clause from
  `reminderHasHistory`; `snoozedUntil` comment → civil day; replace `snoozeUntilSchema` with a
  `snoozeDaysSchema` (int ≥ 1).
- `packages/data/src/migrations.ts` **v37**: `ALTER TABLE reminders DROP COLUMN snooze_count`, and
  floor existing `snoozed_until` to UTC midnight (`snoozed_until - snoozed_until % 86400000`) so
  the TestFlight tester's live snoozes carry over as civil days. (Verify DROP COLUMN on both
  drivers' SQLite — needs ≥ 3.35.)
- `packages/data/src/reminders-repo.ts`: `snooze(id, untilDay)` sets `snoozed_until` only;
  `setCompleted(id, true)` also nulls `snoozedUntil`; drop `snoozeCount: 0` from `create`.
- `packages/core/src/index.ts:2029`: `reminders.snooze(id, days)` — reads the row via
  `getInWindow`, computes the target with `snoozeTargetOf`, refuses `null`, and
  materializes-if-missing inside the transaction exactly as `setCompleted` does (`:2008`).
- Desktop IPC `apps/desktop/src/main/index.ts:530`: parse `[id, snoozeDaysSchema]`.

**2b — offers** (`packages/view-models/src/reminders.ts`)
- `reminderActionsOf`: one `{ kind: "snooze", days }` action per preset (`SNOOZE_PRESET_DAYS = [1, 3, 7]`)
  whose `snoozeTargetOf` is non-null, on any open row that is on display or snoozed (needs
  `activeFrom` in the input). `dismiss` loses its `snoozeCount >= 1` gate (still nudges, prompts,
  partnership questions only — ordinary rows keep Remove).
- `partitionReminders` → civil comparison (see design decisions).

**2c — clients**
- Mobile `apps/mobile/lib/reminder-row.ts`: `RowOffer` snooze carries `days`; `snoozeLabel` →
  `remindMeLabel(days)` (1 → "Remind me tomorrow", 7 → "Remind me next week", else "Remind me in N
  days"). `app/reminders/[id]/index.tsx`: `snooze(days)`, keys by `snooze:${days}`.
- Desktop `apps/desktop/src/renderer/src/lib/reminder-row.ts` + `router.tsx:1119` +
  `screens/ReminderList.tsx:168`: same three labels, the form posts `days`.
- `reminderActionKey` makes snooze keys unique per `days`.

**2d — tests + docs**
- Update: `packages/reminders/test/{engine,onboarding,partnership-nudges,prompt}.test.ts`,
  `packages/view-models/src/reminders.test.ts`, `packages/schema/src/{reminder,merge}.test.ts`,
  `packages/export/test/archive.test.ts` fixture, `apps/*/…/reminder-row.test.ts`, desktop
  integration `reminders*.test.ts`, `onboarding-reminders`, `own-partnership-reminders`,
  `with-sync-kick`. New cases: target lands at the start of the day; capped at due day; refused on
  due-today/belated/done; completing clears the snooze; nothing retires after N snoozes.
- `packages/reminders/README.md`: rewrite *The steps have unequal stakes…*, *No two steps come back
  on the same day*, the plan-prompt clamp paragraph (~l.364), the retirement sentence; the
  "Onboarding defer *is* reminder snooze" section stays true. `packages/view-models/README.md:61`.
  Migration 28's comment gets a pointer to v37.

### 3 · A dated user reminder enters Today on its due date
- `packages/reminders/src/engine.ts` (`listRemindersInWindow` user-row mapping, ~l.1431):
  `activeFrom: row.dueDate`. `packages/core/src/index.ts:1439` fallback: same for `user` rows.
- Undated user reminders unchanged. With step 1 in place, start day == due day → one notification.
- Tests: view-models bucketing, engine window, planner dedupe.

### 4 · Sections, order and wording
**4a — bucketing** (`packages/view-models/src/reminders.ts`)
- `ReminderBucket` → `"belated" | "today" | "next7" | "later"`; `bucketReminders` returns
  `{ belated, today, next7, later, done, owed }` (`actionable` goes — it equals `owed` now).
- **today**: on display, not snoozed, due today or later, or dateless — dateless first, then by
  `dueDate`. **belated**: unchanged. **next7 / later**: not-yet-started or snoozed rows, by
  *landing day* = later of `activeFrom` and snooze end; next7 = landing within 1–7 days. Both
  sorted by landing day. Snoozed rows now come back from `partitionReminders` into these.
- Delete `groupComingByActivation` (+ test).

**4b — wording** (`packages/schema/src/reminder-schedule.ts`, beside `formatDueIn`)
- `formatDueCountdown(ms)` → "Due today" / "Due tomorrow" / "Due in 5 days" / "Due in 3 weeks".
- `formatBackIn(ms)` → "Back tomorrow" / "Back in 3 days" / "Back in 2 weeks".
- Not-yet-started rows keep `formatDueIn` on the landing day ("in 3 days"). Belated keeps today's.
- Subtitle = the date the row sorts by: Today → `dueDate` (questions show their deadline — the
  occasion stays on the detail screen, `app/reminders/[id]/index.tsx:321`); Later sections →
  landing day. `countdownDate` then only feeds Belated.

**4c — clients**
- Mobile `apps/mobile/lib/reminder-sections.ts`: sections `belated, today, next7, later, done`;
  `later`'s header is emitted only when `next7` is expanded or empty; `next7`, `later`, `done`
  collapsible and collapsed by default. The owed note becomes one message when Today and Belated
  are empty: **"All done for today. Go enjoy it."** (proposed copy). `app/(tabs)/index.tsx`: `TEXT`
  gains "Next 7 days" / "Later", loses Available/Coming/`noneOwed`/`allClear`; `ReminderRow`
  renders the subtitle for its section.
- Desktop `screens/ReminderList.tsx`: same sections, `later` as a `<details>` nested inside the
  `next7` `<details>`.
- Tests: `apps/mobile/lib/reminder-sections.test.ts`, view-models bucketing (every bucket, both
  sort rules, snoozed row in next7 and back in Today next day, the two-tap reveal).

### 5 · Close out
- Delete `plans/home-and-snooze.md`; `plans/status.md` / `shipping.md` step marked done. Settled
  *why* already lives beside the code (doc comments on `bucketReminders`, `snoozeTargetOf`,
  `planNotifications`).

## Verification

- Per commit: `pnpm exec node scripts/test-all.mjs --only=format,lint,typecheck,versions,icons,bundle`
  then `pnpm exec vitest run` (check the SQLite binary is the **2217120-byte** Node build first —
  AGENTS.md; restore from `~/.npm/_prebuilds` with `tar` if not).
- Date logic is proven by unit tests with a fixed `now`: start-of-day targets, due-day cap,
  midnight flips, landing-day bucketing, planner events and dedupe.
- Device, after step 2 and again after step 4 (iOS simulator, `run` skill): snooze a lead-time row
  "Remind me tomorrow" → gone from Today, shown in Next 7 days as "Back tomorrow"; advance the
  simulator date → back in Today; confirm the pending notification exists for that morning
  (`scheduler.listPending()`, read through a debug log on mobile). Complete a snoozed row → Completed, snooze gone. Write a
  user reminder for next month → in Later, not Today.
- Before the step 6 hand-off to Submit: full `test:e2e` on iOS (all seven flows) — none tap snooze
  copy today (`save-record.yaml`'s "Not now" is the duplicate-review prompt), but onboarding flows
  render the nudges whose offers change.
