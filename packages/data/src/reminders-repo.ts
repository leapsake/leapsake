import {
  type CreateReminderInput,
  type Reminder,
  type UpdateReminderInput,
  createReminderInputSchema,
  reminderHasHistory,
  reminderSchema,
  snoozeUntilSchema,
  updateReminderInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import { type EntityRepo, createEntityRepo } from "./entity-repo.js";

export interface RemindersRepo extends EntityRepo<Reminder> {
  create(input: CreateReminderInput): Promise<Reminder>;
  update(id: string, input: UpdateReminderInput): Promise<Reminder | undefined>;
  /**
   * Toggle completion: stamp `completedAt` with the current time when completing,
   * clear it back to null when reopening. Routes through the standard `update`, so
   * the row's clock advances and the change syncs like any other edit.
   */
  setCompleted(id: string, completed: boolean): Promise<Reminder | undefined>;
  /**
   * Put a reminder off until `until`, and record that it happened: sets
   * `snoozedUntil` and increments `snoozeCount` in one statement.
   *
   * This is the **only** write that touches `snoozeCount`, which is why it can't
   * ride `update` — the count is engine-owned and absent from
   * {@link updateReminderInputSchema}, so no caller can reset its own nag budget
   * or skip ahead. The increment is evaluated by SQLite (`snooze_count + 1`)
   * rather than read-modify-written in TypeScript, so two snoozes can never read
   * the same value and lose one.
   *
   * A **completed** row is allowed and inert: display gives completion
   * precedence over snooze, so putting off a finished reminder changes nothing a
   * user sees. A missing or soft-deleted id returns undefined, writing nothing.
   *
   * The date is the caller's: `until` is validated as a date but never judged
   * against a schedule (see {@link snoozeUntilSchema}). Note that the count
   * increments on every call regardless — so a budget spends even on a snooze
   * that lands in the past.
   */
  snooze(id: string, until: number): Promise<Reminder | undefined>;
}

/**
 * The Reminders repository over the async {@link SqliteDriver} port. Plaintext —
 * no {@link ContentCipher}, unlike milestones; reminders aren't a share target
 * and are already covered by whole-DB-at-rest + master-key-sealed sync. Standard
 * CRUD + the sync surface come from {@link createEntityRepo}; only `create`
 * (input parse + assemble), the `setCompleted` toggle and `snooze` are bespoke.
 */
export function createRemindersRepo(driver: SqliteDriver): RemindersRepo {
  const base = createEntityRepo<Reminder>({
    driver,
    table: "reminders",
    schema: reminderSchema,
    orderBy: "created_at DESC",
    // The one table that needs it: the engine mints its `system` rows under
    // deterministic ids, so two devices produce the same row independently and a
    // mint would otherwise out-rank a peer's dismissal or snooze on `updated_at`
    // alone. See {@link reminderHasHistory}.
    hasHistory: reminderHasHistory,
  });

  return {
    ...base,

    async create(input) {
      const {
        title = null,
        body = null,
        dueDate = null,
        source = "user",
      } = createReminderInputSchema.parse(input);
      const now = Date.now();
      return base.insert({
        id: crypto.randomUUID(),
        title,
        body,
        completedAt: null,
        dueDate,
        // A reminder is never born snoozed, so `create` takes no input for either.
        snoozedUntil: null,
        snoozeCount: 0,
        source,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: async (id, input) =>
      base.update(id, updateReminderInputSchema.parse(input)),

    setCompleted: (id, completed) =>
      base.update(id, { completedAt: completed ? Date.now() : null }),

    async snooze(id, until) {
      // One statement, so the increment is SQLite's and not a read-modify-write.
      // `updated_at` advances like any ordinary edit, which is what carries the
      // snooze to other devices; the strictly-newer `MAX(?, updated_at + 1)`
      // idiom is for tombstones alone (see `softDeleteWhere`).
      await driver.run(
        `UPDATE reminders
            SET snoozed_until = ?, snooze_count = snooze_count + 1, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
        [snoozeUntilSchema.parse(until), Date.now(), id],
      );
      // Re-read rather than assemble: `get` decodes through the same codec as
      // every other read, so the returned row is schema-validated, not assumed.
      return base.get(id);
    },
  };
}
