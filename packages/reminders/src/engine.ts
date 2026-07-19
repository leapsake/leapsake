import { deterministicUuid } from "@leapsake/crypto";
import {
  type CivilDate,
  type MilestoneBearerType,
  type RemindEligibleMilestone,
  type Reminder,
  type ReminderRuleInput,
  actionDefs,
  daysUntil,
  dueDateMs,
  mentionToken,
  nextOccurrence,
  reminderRuleLabel,
} from "@leapsake/schema";

/** Milliseconds in a civil day — a stored due date is UTC midnight, so shifting
 *  it back by whole days is exact integer subtraction (no DST drift). */
const DAY_MS = 86_400_000;

/**
 * The base look-ahead: a `system` reminder surfaces once its **own due date** is
 * within this many days of today (the due date being the milestone's occurrence
 * shifted back by the rule's `offsetDays`), and is dropped again once the
 * milestone's day has passed. So a day-of rule (offset 0) appears ~a month out
 * — unchanged from the birthday-only engine — while a `gift @ 30 days before`
 * rule appears ~a month before *that*, i.e. ~two months before the birthday,
 * giving every reminder the same run-up before it comes due. See
 * {@link isWithinWindow}.
 */
export const LEAD_DAYS = 30;

/**
 * The fixed namespace all automated-reminder ids are derived under (see
 * {@link deterministicUuid}). Kept constant forever — changing it would re-mint
 * every system reminder under a new id and duplicate the lot on next sync.
 */
export const SYSTEM_REMINDER_NAMESPACE = "leapsake:system-reminder";

/**
 * The store surface the engine drives — the narrow slice of the reminders repo
 * it needs, injected so the engine unit-tests against an in-memory fake with no
 * native sqlite driver. All four already exist on the entity-repo base the
 * reminders repo spreads.
 */
export interface SystemReminderStore {
  /** Fetch by id **including tombstones** — the resurrection guard reads this so
   *  a user-dismissed (soft-deleted) system reminder is never re-created. */
  getIncludingDeleted(id: string): Promise<Reminder | undefined>;
  /** Persist an already-assembled reminder row (the engine mints id + stamps). */
  insert(row: Reminder): Promise<Reminder>;
  /**
   * Refresh a still-live system reminder's derived fields in place — used when its
   * milestone was edited (the date moved, or the subject was renamed) so the id is
   * unchanged but the title/due date drifted. Keeps the row's identity and any
   * manual completion; the store bumps `updated_at` so the edit wins LWW on sync.
   * `dueDate` is nullable so a dateless onboarding row's copy can also be refreshed
   * (see {@link ONBOARDING_STEPS}) — in practice onboarding copy is static, so this
   * path is unlikely to fire for it.
   */
  update(
    id: string,
    fields: { title: string; dueDate: number | null },
  ): Promise<void>;
  /** Active rows matching a raw snake_case `WHERE` (used for `source = 'system'`). */
  listWhere(query: {
    where: string;
    params: readonly unknown[];
  }): Promise<Reminder[]>;
  /** Soft-delete a now-stale system reminder by id. */
  softDelete(id: string): Promise<void>;
}

/**
 * Everything the engine needs, injected by the composition root. Deliberately no
 * `@leapsake/core` / `@leapsake/data` dependency: the engine speaks only to these
 * small ports, so it stays independently testable and narrowly scoped.
 */
export interface ReminderEngineDeps {
  /** The remind-relevant, plaintext, cross-bearer milestone projection reader. */
  milestones: { listRemindEligible(): Promise<RemindEligibleMilestone[]> };
  /** The system-reminder store (see {@link SystemReminderStore}). */
  reminders: SystemReminderStore;
  /**
   * The milestone's effective staggered-reminder schedule — its stored rule rows
   * when it has been customised, else its kind's defaults, already projected to
   * editable rows (schema's `resolveReminderSchedule`). The engine mints one
   * reminder per **enabled** entry; disabled entries are ignored (but still
   * returned so the caller need not filter). Injected so the engine stays free of
   * `@leapsake/data` — the composition root reads the rules repo + resolver.
   */
  resolveSchedule(
    milestone: RemindEligibleMilestone,
  ): Promise<ReminderRuleInput[]>;
  /**
   * Resolve a milestone bearer to its display label, or `null` when the bearer is
   * gone (a dangling milestone) — a null label skips the reminder.
   */
  resolveLabel(
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<string | null>;
  /** The **local civil** "today" reconcile runs against (see reminder-schedule). */
  today: CivilDate;
  /** Run the reconcile body atomically (the real driver's `transaction`). */
  transaction<T>(body: () => Promise<T>): Promise<T>;
  /**
   * The first-run signals the onboarding nudges (see {@link ONBOARDING_STEPS})
   * are decided from. **Optional**: engine unit tests and any non-onboarding
   * caller may omit it, and the desired set then carries no onboarding rows. The
   * composition root reads these off its people/pets repos and sync-status.
   */
  onboarding?: {
    /** Whether the store holds any person or pet yet. */
    hasAnyEntity(): Promise<boolean>;
    /** Whether this device has connected to a sync relay. */
    isSyncConnected(): Promise<boolean>;
  };
}

/** A reminder the engine wants to exist for today's reconcile. `dueDate` is null
 *  for the dateless onboarding nudges (see {@link ONBOARDING_STEPS}). */
interface DesiredReminder {
  id: string;
  title: string;
  dueDate: number | null;
}

/** The identity string a milestone occurrence + rule is content-addressed under,
 *  so two devices generating "the same" reminder derive the **same** id and the
 *  existing whole-row merge dedups them (plans automated-reminders, cross-cutting).
 *  Keyed on the rule's `action` so a milestone's staggered reminders (gift, card,
 *  wish…) get distinct, non-colliding ids for the same occurrence. */
function occurrenceName(
  milestoneId: string,
  occurrenceYear: number,
  action: string,
): string {
  return `milestone:${milestoneId}:${occurrenceYear}:${action}`;
}

/**
 * The abstract navigation target an onboarding nudge deep-links to. Kept abstract
 * (not a concrete client path) so each client maps it to its own router — see
 * {@link onboardingRouteOf} and the client CTA tables.
 */
export type OnboardingRoute = "add-person" | "connect-sync";

/** The raw first-run signals an onboarding step's condition is evaluated against. */
interface OnboardingSignals {
  hasEntities: boolean;
  syncConnected: boolean;
}

/** One first-run nudge: a stable `key` (folded into its deterministic id), the
 *  copy shown on Home, the abstract CTA `route`, and `applies` — true while the
 *  step's condition is still unmet, i.e. while the nudge should exist. */
interface OnboardingStep {
  key: string;
  title: string;
  route: OnboardingRoute;
  applies(s: OnboardingSignals): boolean;
}

/**
 * The onboarding nudge definitions — a second family of `system` reminders the
 * engine owns copy for, mirroring how it owns the milestone `actionDefs`. Each is
 * a dateless row surfaced while its condition is unmet and retired (soft-deleted)
 * once met. Titles are kept free of `#`/`@` tokens so the core insert-wrapper
 * materializes no tags/@mentions for them.
 *
 * **Permanent retirement is intentional:** retirement is a `softDelete` tombstone,
 * so a step does **not** re-appear if its condition later reverts (e.g. the user
 * deletes all their people). That is the correct "don't re-nag" onboarding
 * semantic — see {@link computeAndReconcile}.
 */
const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    key: "add-first-person",
    title: "👋 Add your first person to get started",
    route: "add-person",
    applies: (s) => !s.hasEntities,
  },
  {
    key: "sync-devices",
    title: "🔄 Already using Leapsake on another device? Connect to sync.",
    route: "connect-sync",
    applies: (s) => !s.syncConnected,
  },
];

/** The deterministic id an onboarding step is content-addressed under — derived
 *  under the same {@link SYSTEM_REMINDER_NAMESPACE} as milestone reminders but in
 *  the disjoint `onboarding:<key>` name-space, so the two families never collide. */
function onboardingId(key: string): string {
  return deterministicUuid(SYSTEM_REMINDER_NAMESPACE, `onboarding:${key}`);
}

/** An onboarding reminder's stable id paired with its abstract CTA route. */
export interface OnboardingReminder {
  id: string;
  route: OnboardingRoute;
}

/**
 * The id ⇒ route convention clients look a Home reminder's CTA up against — the
 * whole point of the id-convention: no schema field, no migration, no sync change.
 * A client renders a deep-link CTA for a reminder **only** when
 * {@link onboardingRouteOf} finds a match here.
 */
export const ONBOARDING_REMINDERS: readonly OnboardingReminder[] =
  ONBOARDING_STEPS.map((step) => ({
    id: onboardingId(step.key),
    route: step.route,
  }));

/** The CTA route for a reminder id, or `null` when it isn't an onboarding
 *  reminder (a milestone or user reminder) — the client's branch for "show a CTA". */
export function onboardingRouteOf(id: string): OnboardingRoute | null {
  return ONBOARDING_REMINDERS.find((r) => r.id === id)?.route ?? null;
}

/**
 * Whether a rule's reminder should exist today: its due date (the occurrence
 * shifted back by `offsetDays`) is at most {@link LEAD_DAYS} away, and the
 * occurrence itself hasn't passed. `days` is `daysUntil(today, occurrence)`, so
 * the due date is `days - offsetDays` away — bounded above by `LEAD_DAYS` and
 * held open until the occurrence day (`days >= 0`) so a not-yet-actioned
 * reminder keeps nagging up to the event rather than vanishing on its due date.
 */
function isWithinWindow(
  daysUntilOccurrence: number,
  offsetDays: number,
): boolean {
  return (
    daysUntilOccurrence >= 0 && daysUntilOccurrence - offsetDays <= LEAD_DAYS
  );
}

/**
 * Compute the set of `system` reminders that *should* exist for `today` and
 * reconcile the store to it, **idempotently** and **tombstone-respectingly**:
 *
 * - For each milestone with an upcoming occurrence, resolve its staggered
 *   schedule (stored rules, else kind defaults) and, for every **enabled** rule
 *   whose due date is inside the {@link LEAD_DAYS} window, derive a deterministic
 *   id (keyed on the rule's action) and desired row.
 * - Insert each desired row **when absent** — `getIncludingDeleted` means a
 *   user-dismissed reminder (a tombstone under that id) is left dead, never
 *   resurrected.
 * - **Refresh** an already-present *active* row whose title/due date has drifted
 *   (the milestone's date moved or the subject was renamed), keeping its identity
 *   and any manual completion. When nothing drifted it is left byte-for-byte
 *   as-is, so a steady-state reconcile writes nothing (no sync churn).
 * - Soft-delete every **active** `source="system"` row whose id is no longer
 *   desired — its milestone was deleted, its occurrence passed, or it fell out of
 *   the window.
 *
 * Returns how many rows it created, updated, and removed. Runs at boot/focus and
 * after every milestone write (folded into core's milestone methods, so an added
 * / edited / deleted birthday reconciles at once); the caller kicks the refresh /
 * sync path when any count is non-zero, letting normal sync push the rows.
 */
export function regenerateSystemReminders(
  deps: ReminderEngineDeps,
): Promise<{ created: number; updated: number; removed: number }> {
  return computeAndReconcile(deps);
}

async function computeAndReconcile(
  deps: ReminderEngineDeps,
): Promise<{ created: number; updated: number; removed: number }> {
  const milestones = await deps.milestones.listRemindEligible();

  // The desired set, keyed by (deterministic) id so duplicate identities collapse.
  const desired = new Map<string, DesiredReminder>();
  for (const m of milestones) {
    const occ = nextOccurrence(m.kind, m, deps.today);
    if (occ === null) continue;
    const days = daysUntil(deps.today, occ);
    if (days < 0) continue; // occurrence already passed — nothing to schedule

    // The rules that actually want a reminder for this occurrence today: enabled,
    // and inside their own due-date window. Resolve the schedule up front and skip
    // the (potentially encrypted) label lookup entirely when nothing applies.
    const rules = (await deps.resolveSchedule(m)).filter(
      (r) => r.enabled && isWithinWindow(days, r.offsetDays),
    );
    if (rules.length === 0) continue;

    const label = await deps.resolveLabel(m.bearerType, m.bearerId);
    if (label === null) continue; // bearer gone — nothing to name the reminder
    // Wrap the subject in an inline mention token so the name links to the
    // person/pet page (the reminder text is the single source of truth for the
    // mention; core re-derives the backlink from it). A relationship bearer has
    // no single entity to point at, so it stays plain text — though in practice a
    // relationship never reaches here (its label resolves to null above).
    const subject =
      m.bearerType === "relationship"
        ? label
        : mentionToken(label, m.bearerType, m.bearerId);

    for (const rule of rules) {
      const id = deterministicUuid(
        SYSTEM_REMINDER_NAMESPACE,
        occurrenceName(m.id, occ.year, rule.action),
      );
      const def = actionDefs[rule.action];
      // The action's copy carries the (mention-wrapped) subject — "Wish @Alice a
      // happy birthday", "Get @Alice a gift". `other` has no template; it is the
      // user's own free text, so it names no subject (nothing to interpolate).
      const body =
        rule.action === "other"
          ? reminderRuleLabel({
              action: rule.action,
              label: rule.label ?? null,
            })
          : def.template(subject);
      const title = `${def.icon ?? ""} ${body}`.trim();
      // Due `offsetDays` before the occurrence (day-of when 0); stored as UTC
      // midnight of that civil day, so plain integer subtraction is exact.
      desired.set(id, {
        id,
        title,
        dueDate: dueDateMs(occ) - rule.offsetDays * DAY_MS,
      });
    }
  }

  // Onboarding nudges — a second `system` family on the *same* rails: dateless
  // rows fed into the same desired set, so insert-when-absent, refresh-on-drift,
  // tombstone-guard, and prune all apply unchanged. A step whose condition is
  // unmet is desired (→ inserted); once met it drops out (→ pruned = softDelete).
  // Because prune tombstones the row, a retired step never re-appears even if its
  // condition later reverts (the user deletes all their people) — the intended
  // "don't re-nag" semantic. Only when the caller injects the port (clients do;
  // engine unit tests may not) — otherwise no onboarding rows join the set.
  if (deps.onboarding !== undefined) {
    const signals: OnboardingSignals = {
      hasEntities: await deps.onboarding.hasAnyEntity(),
      syncConnected: await deps.onboarding.isSyncConnected(),
    };
    for (const step of ONBOARDING_STEPS) {
      if (!step.applies(signals)) continue;
      const id = onboardingId(step.key);
      desired.set(id, { id, title: step.title, dueDate: null });
    }
  }

  return deps.transaction(async () => {
    const now = Date.now();
    let created = 0;
    let updated = 0;
    for (const [id, want] of desired) {
      const existing = await deps.reminders.getIncludingDeleted(id);
      if (existing === undefined) {
        await deps.reminders.insert({
          id,
          title: want.title,
          body: null,
          completedAt: null,
          dueDate: want.dueDate,
          source: "system",
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        created++;
        continue;
      }
      // A tombstone (user-dismissed) is left dead — never resurrected.
      if (existing.deletedAt !== null) continue;
      // Live row: refresh it only if the milestone drifted (date moved or subject
      // renamed), keeping its identity and any manual completion. Unchanged rows
      // are skipped, so a steady-state reconcile stays a no-op.
      if (existing.title !== want.title || existing.dueDate !== want.dueDate) {
        await deps.reminders.update(id, {
          title: want.title,
          dueDate: want.dueDate,
        });
        updated++;
      }
    }

    // Prune active system reminders that today's desired set no longer wants.
    const activeSystem = await deps.reminders.listWhere({
      where: "source = ?",
      params: ["system"],
    });
    let removed = 0;
    for (const row of activeSystem) {
      if (!desired.has(row.id)) {
        await deps.reminders.softDelete(row.id);
        removed++;
      }
    }

    return { created, updated, removed };
  });
}
