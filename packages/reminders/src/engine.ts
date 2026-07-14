import { deterministicUuid } from "@leapsake/crypto";
import {
  type CivilDate,
  type MilestoneBearerType,
  type RemindEligibleMilestone,
  type Reminder,
  daysUntil,
  dueDateMs,
  kindDefs,
  mentionToken,
  nextOccurrence,
} from "@leapsake/schema";

/**
 * How many days ahead the engine looks: a `system` reminder appears once its
 * milestone's next occurrence is within this window and is dropped again once
 * the day has passed. A fixed two-day-shy-of-a-month lead for v1 (birthdays);
 * per-kind offsets and configurable windows are on the roadmap.
 */
export const LEAD_DAYS = 30;

/**
 * The fixed namespace all automated-reminder ids are derived under (see
 * {@link deterministicUuid}). Kept constant forever — changing it would re-mint
 * every system reminder under a new id and duplicate the lot on next sync.
 */
export const SYSTEM_REMINDER_NAMESPACE = "leapsake:system-reminder";

/** The rule that produced a reminder, part of its identity. `"day"` (the event's
 * own day) is the only rule in v1; it is present now so future staggered rules
 * (gift → card → wish) and holidays get distinct, non-colliding ids for free. */
const DAY_RULE = "day";

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
   */
  update(id: string, fields: { title: string; dueDate: number }): Promise<void>;
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
}

/** A reminder the engine wants to exist for today's reconcile. */
interface DesiredReminder {
  id: string;
  title: string;
  dueDate: number;
}

/** The identity string a milestone occurrence is content-addressed under, so two
 *  devices generating "the same" reminder derive the **same** id and the existing
 *  whole-row merge dedups them (plans automated-reminders, cross-cutting). */
function occurrenceName(milestoneId: string, occurrenceYear: number): string {
  return `milestone:${milestoneId}:${occurrenceYear}:${DAY_RULE}`;
}

/**
 * Compute the set of `system` reminders that *should* exist for `today` and
 * reconcile the store to it, **idempotently** and **tombstone-respectingly**:
 *
 * - For each remind-by-default milestone with an upcoming occurrence inside the
 *   {@link LEAD_DAYS} window, derive its deterministic id and desired row.
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
    if (!kindDefs[m.kind].remindByDefault) continue;
    const occ = nextOccurrence(m.kind, m, deps.today);
    if (occ === null) continue;
    const days = daysUntil(deps.today, occ);
    if (days < 0 || days > LEAD_DAYS) continue;
    const label = await deps.resolveLabel(m.bearerType, m.bearerId);
    if (label === null) continue; // bearer gone — nothing to name the reminder

    const id = deterministicUuid(
      SYSTEM_REMINDER_NAMESPACE,
      occurrenceName(m.id, occ.year),
    );
    const kindDef = kindDefs[m.kind];
    // Wrap the subject in an inline mention token so the name links to the
    // person/pet page (the reminder text is the single source of truth for the
    // mention; core re-derives the backlink from it). A relationship bearer has
    // no single entity to point at, so it stays plain text — though in practice a
    // relationship never reaches here (its label resolves to null above).
    const subject =
      m.bearerType === "relationship"
        ? label
        : mentionToken(label, m.bearerType, m.bearerId);
    const title =
      `${kindDef.icon ?? ""} ${subject}'s ${kindDef.label.toLowerCase()}`.trim();
    desired.set(id, { id, title, dueDate: dueDateMs(occ) });
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
