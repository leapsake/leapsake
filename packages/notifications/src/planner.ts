/**
 * The pure core of `08 Inc 2` (`plans/v0-1_08_local-notifications.md`): compute
 * the set of OS notifications that *should* be pending, given the reminder rows
 * and a device's policy. No `@leapsake/core` or `@leapsake/data` dependency, no
 * OS calls — {@link planNotifications} is deterministic in `now` and
 * independently unit-testable.
 *
 * The ~30-day horizon the plan describes is **not enforced here**. It falls out
 * of reading reminder rows as-is: a `system` reminder simply doesn't exist in
 * the store until its due date is within `@leapsake/reminders`' `LEAD_DAYS` of
 * today, so the candidate set this planner sees is already bounded for the
 * common case. A far-future `user` reminder just adds one more candidate, in
 * either mode; the budget in {@link planNotifications} is the backstop.
 */
import { civilFromDueMs, reminderLabel } from "@leapsake/schema";
import type { CivilDate } from "@leapsake/schema";
import { onboardingRouteOf } from "@leapsake/reminders";

/** How a device wants its reminders to reach it — mirrors
 *  `notificationModeSchema` (`@leapsake/schema`) without importing the full
 *  synced row shape, so a caller can pass either. */
export type NotificationMode = "off" | "digest" | "each";

/** The narrow slice of a `Reminder` row {@link planNotifications} reads —
 *  everything the "a reminder notifies iff…" rule needs, and nothing a repo
 *  read wouldn't already have to hand. */
export interface NotifiableReminder {
  id: string;
  title: string | null;
  body: string | null;
  /** Epoch-ms UTC midnight of the civil due day; `null` = no due date. */
  dueDate: number | null;
  completedAt: number | null;
  snoozedUntil: number | null;
  deletedAt: number | null;
}

/** The fields of a device's `notification_settings` row {@link planNotifications}
 *  actually reads — a caller may pass the full synced row unchanged. */
export interface NotificationPolicy {
  mode: NotificationMode;
  /** Minutes past local midnight the notification fires at. */
  deliveryMinute: number;
}

/**
 * One OS notification the device should have pending. `id` is stable across
 * reconciles for the same (mode, day-or-reminder) — see {@link reconcile} —
 * so it never collides across `digest`/`each` entries for the same reminder.
 */
export interface DesiredNotification {
  id: string;
  /** Local wall-clock fire instant, epoch ms — see {@link fireAtFor}. */
  fireAt: number;
  title: string;
  body: string;
  /** The reminder this notification's tap-through targets, or `null` for a
   *  digest bundling more than one reminder (opens the reminder list instead). */
  reminderId: string | null;
}

/**
 * The fallback cap for a caller that doesn't name one — deliberately the
 * *tightest* ceiling among the platforms this ships on, so planning without a
 * budget can't overshoot on any of them. It is not any one platform's number:
 * each platform's real ceiling, and the reasoning behind it, belongs with the
 * code that knows which platform it is running on (`IOS_NOTIFICATION_BUDGET` /
 * `ANDROID_NOTIFICATION_BUDGET` in `apps/mobile/lib/notification-scheduler.ts`,
 * resolved to `PLATFORM_NOTIFICATION_BUDGET` and passed in as
 * {@link PlanOptions.budget}). That it currently coincides with iOS's is a fact
 * about which platform is strictest today, not a coupling — if iOS raised its
 * limit, the number here would follow whichever platform became tightest.
 */
export const NOTIFICATION_BUDGET = 60;

/** Per-call overrides for {@link planNotifications}. */
export interface PlanOptions {
  /**
   * The most notifications the caller's platform can hold pending — the
   * caller knows this, the planner can't. Defaults to
   * {@link NOTIFICATION_BUDGET}. `Infinity` plans without a cap, correct only
   * on a platform with no ceiling *and* no penalty for the excess, which as of
   * writing is no platform this app ships on.
   */
  budget?: number;
}

/**
 * Compute the desired set of pending OS notifications for `policy` as of
 * `now` — the planning half of "compute the desired set, diff it against
 * what is scheduled, cancel and schedule the delta" (see {@link reconcile}
 * for the other half).
 *
 * `off` yields nothing. `digest` bundles every notifying reminder due on the
 * same civil day into one notification at `policy.deliveryMinute`, its copy
 * computed now (see {@link digestCopy}) — going stale only if the underlying
 * data changes before the next reconcile. `each` explodes the same content
 * into one notification per reminder, at the *same* `deliveryMinute` — it is
 * not more timely, only a tap target per item.
 *
 * **Both modes are capped**, to the soonest `options.budget`
 * ({@link NOTIFICATION_BUDGET} by default). `each` is the mode that binds in
 * practice — one entry per reminder reaches the cap in a busy month. `digest`
 * is capped too, even though at most one entry per day makes it hard to reach:
 * the ~30-day horizon that bounds it only bounds `system` reminders, which
 * don't exist in the store until they're within `@leapsake/reminders`'
 * `LEAD_DAYS` of due. A far-future `user` reminder is a live row today, so
 * enough of them on distinct days would overshoot iOS's ceiling with no code
 * path noticing — the cap here is what makes that impossible rather than
 * merely unlikely.
 *
 * The cap is applied after the per-mode plan, on `fireAt` order, so what
 * survives is always the soonest — dropping the far end, which is both the
 * least urgent and the most likely to be re-planned before it would have
 * fired anyway.
 *
 * Entries whose fire time has already passed `now` are dropped: there is
 * nothing useful to schedule for a moment already gone, and the next
 * reconcile (boot / foreground / post-write, the same triggers
 * `regenerateSystemReminders` runs on) picks up whatever is still ahead.
 * Dropped *before* the cap is applied, so a stale entry can't consume a slot
 * a live one needed.
 *
 * One slot of the budget is held back for the {@link tripwireFor} notice — see
 * there for why coverage running out silently is worth a slot.
 */
export function planNotifications(
  reminders: readonly NotifiableReminder[],
  policy: NotificationPolicy,
  now: number,
  options: PlanOptions = {},
): DesiredNotification[] {
  if (policy.mode === "off") return [];
  const budget = options.budget ?? NOTIFICATION_BUDGET;

  const eligible = reminders.filter((r) => isNotifiable(r, now));
  const planned =
    policy.mode === "digest"
      ? planDigest(eligible, policy)
      : planEach(eligible, policy);

  const live = planned.filter((n) => n.fireAt > now);
  live.sort((a, b) => a.fireAt - b.fireAt);

  // Spend the whole budget on reminders first and ask whether that plan even
  // warrants a notice. Only if it does is a slot worth taking back for one —
  // holding one back unconditionally would burn a slot on nothing whenever
  // coverage is already too short to warn about, which is exactly the
  // heaviest-user case that can least afford it.
  //
  // (`slice`/`- 1` both behave on `Infinity`, so an uncapped plan needs no
  // branch of its own: it keeps everything and still gets its notice.)
  const full = live.slice(0, budget);
  if (tripwireFor(full, now) === null) return full;

  // Room made by dropping the furthest-out entry — which the notice now
  // precedes anyway. Coverage genuinely ends earlier as a result, so the notice
  // is re-derived against the shorter plan rather than reusing the first one.
  const scheduled = live.slice(0, budget - 1);
  const tripwire = tripwireFor(scheduled, now);
  return tripwire === null ? scheduled : [...scheduled, tripwire];
}

/** How far before coverage lapses the {@link tripwireFor} notice fires —
 *  `@leapsake/reminders`' `LEAD_DAYS`, the app's own idea of enough warning to
 *  act on something, rather than a number invented here. */
const TRIPWIRE_LEAD_DAYS = 30;

const TRIPWIRE_ID = "tripwire";

/**
 * The one notification that isn't about a reminder: a **service notice** that
 * the schedule is about to run dry.
 *
 * Notifications are only ever scheduled while the app is running, so a device
 * that is never opened works through whatever was planned on the last open and
 * then goes quiet — with nothing to distinguish "no birthdays coming up" from
 * "Leapsake stopped telling you about them". This makes that failure legible:
 * one notification, {@link TRIPWIRE_LEAD_DAYS} before the last scheduled one,
 * saying the reminders will stop and opening the app resumes them.
 *
 * **Why it fires early rather than at the edge.** A notice at the last covered
 * moment teaches the user nothing they can act on: ignore it and coverage ends
 * immediately, with no cushion. Firing a month early means acting on it costs
 * nothing (a re-plan on open extends the horizon and nothing was missed), and
 * ignoring it still leaves a month of real notifications behind it.
 *
 * **Why it can't nag.** Scheduling only happens when the app runs, so once this
 * fires there is no running app to schedule another. A dormant device gets
 * exactly one, and the next app open replaces it with one further out — no
 * counter, no suppression state, no cooldown to get wrong.
 *
 * **Why it is allowed to notify at all**, when onboarding nudges deliberately
 * are not (see {@link isNotifiable}): this reports that something the user
 * explicitly asked for is about to stop working. That is a service notice, not
 * re-engagement — the distinction to hold the line on if more app-generated
 * notifications are ever proposed.
 *
 * `null` when there is nothing to warn about: no coverage at all (an empty app
 * shouldn't be nagged), or coverage so short the notice would already be in the
 * past — which needs roughly two reminders a day for a month, and is left
 * un-warned rather than fired immediately, since a notice about tomorrow is not
 * a warning.
 */
function tripwireFor(
  scheduled: readonly DesiredNotification[],
  now: number,
): DesiredNotification | null {
  if (scheduled.length === 0) return null;

  const coverageEnd = scheduled[scheduled.length - 1].fireAt;
  const fireAt = coverageEnd - TRIPWIRE_LEAD_DAYS * 86_400_000;
  if (fireAt <= now) return null;

  return {
    // Fixed id, so a re-plan updates the one notice in place rather than
    // accumulating a trail of them. Its `fireAt` moves only when coverage
    // does — not with `now` — so a steady-state reconcile stays a no-op.
    id: TRIPWIRE_ID,
    fireAt,
    // **Provisional wording**, like `digestCopy`. What it must not become: a
    // claim that Leapsake switched notifications off (it didn't — it ran out
    // of scheduled ones), or an instruction to change a setting (there isn't
    // one; opening the app is the whole fix).
    title: "Your reminders are running out",
    body: "Open Leapsake to keep them coming.",
    // No single reminder to open — the app itself is the destination.
    reminderId: null,
  };
}

/**
 * "A reminder notifies iff it has a non-null `dueDate`, is not completed, is
 * not currently snoozed, is not soft-deleted, and `onboardingRouteOf(id) ===
 * null`" (the plan's exact rule) — the single place that predicate is
 * evaluated, so the planner and any future caller can't drift from it.
 * "Currently snoozed" mirrors `@leapsake/view-models`' `isSnoozed`:
 * `snoozedUntil !== null && snoozedUntil > now`.
 */
function isNotifiable(r: NotifiableReminder, now: number): boolean {
  return (
    r.dueDate !== null &&
    r.completedAt === null &&
    r.deletedAt === null &&
    !(r.snoozedUntil !== null && r.snoozedUntil > now) &&
    onboardingRouteOf(r.id) === null
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` for a civil date — the digest's per-day grouping key and id
 *  suffix, mirroring `@leapsake/reminders`' private `isoOf`. */
function isoOf(date: CivilDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

function planDigest(
  reminders: readonly NotifiableReminder[],
  policy: NotificationPolicy,
): DesiredNotification[] {
  const byDay = new Map<
    string,
    { day: CivilDate; reminders: NotifiableReminder[] }
  >();
  for (const r of reminders) {
    // Non-null by construction — isNotifiable required it.
    const day = civilFromDueMs(r.dueDate as number);
    const key = isoOf(day);
    const bucket = byDay.get(key);
    if (bucket === undefined) byDay.set(key, { day, reminders: [r] });
    else bucket.reminders.push(r);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, { day, reminders: dayReminders }]) => {
      const { title, body } = digestCopy(dayReminders);
      return {
        id: `digest:${key}`,
        fireAt: fireAtFor(day, policy.deliveryMinute),
        title,
        body,
        // A digest of exactly one reminder can tap straight through to it;
        // more than one opens the reminder list instead (no single target).
        reminderId: dayReminders.length === 1 ? dayReminders[0].id : null,
      };
    });
}

/** Ordering and the budget are {@link planNotifications}' job now — both modes
 *  need the same treatment, so neither does it itself. */
function planEach(
  reminders: readonly NotifiableReminder[],
  policy: NotificationPolicy,
): DesiredNotification[] {
  return reminders.map((r) => ({
    id: `each:${r.id}`,
    fireAt: fireAtFor(
      civilFromDueMs(r.dueDate as number),
      policy.deliveryMinute,
    ),
    title: "Leapsake",
    body: reminderLabel(r),
    reminderId: r.id,
  }));
}

/**
 * A day-with-content's notification copy. **Provisional wording** — Inc 3
 * (the mobile adapter) is free to change it without touching the reconcile
 * mechanics above; only the shape (`title`/`body`) is load-bearing.
 */
function digestCopy(reminders: readonly NotifiableReminder[]): {
  title: string;
  body: string;
} {
  const labels = reminders.map((r) => reminderLabel(r));
  if (labels.length === 1) return { title: "Leapsake", body: labels[0] };
  const [lead, ...rest] = labels;
  const body =
    rest.length === 1
      ? `${lead} and ${rest[0]}`
      : `${lead} and ${rest.length} more`;
  return { title: `${labels.length} reminders today`, body };
}

/**
 * The absolute fire instant for a civil day + minutes-past-midnight, in the
 * **current** time zone at schedule time — deliberately the local `Date`
 * constructor, not the UTC-anchored `dueDateMs`/`civilFromDueMs` a due date is
 * *stored* under. A due date is a timezone-free calendar day; a notification
 * is a real instant the OS fires at, and those are different math. Travel or
 * a DST shift is corrected by the next reconcile re-deriving this from
 * scratch, never by adjusting a stored instant.
 */
function fireAtFor(day: CivilDate, deliveryMinute: number): number {
  return new Date(
    day.year,
    day.month - 1,
    day.day,
    Math.floor(deliveryMinute / 60),
    deliveryMinute % 60,
    0,
    0,
  ).getTime();
}
