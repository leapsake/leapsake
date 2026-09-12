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
   *
   * **Completing clears any snooze** *(owner, 2026-09-11)*. A finished reminder
   * is done, and a snooze left behind would hide it again the moment it was
   * reopened — for as long as a clock nobody could see still had to run.
   */
  setCompleted(id: string, completed: boolean): Promise<Reminder | undefined>;
  /**
   * Put a reminder off until the civil day `until` (epoch-ms UTC midnight, like a
   * due date). Nothing is counted: no reminder retires by being put off, so the
   * day it comes back is the whole of what a snooze records.
   *
   * The day is the caller's, checked only as an integer (see
   * {@link snoozeUntilSchema}); which rows may be put off and how far is
   * `@leapsake/reminders`' `snoozeTargetOf`, applied before this is called. A
   * missing or soft-deleted id returns undefined, writing nothing.
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
        // A reminder is never born snoozed, so `create` takes no input for it.
        snoozedUntil: null,
        source,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    update: async (id, input) =>
      base.update(id, updateReminderInputSchema.parse(input)),

    setCompleted: (id, completed) =>
      base.update(
        id,
        completed
          ? { completedAt: Date.now(), snoozedUntil: null }
          : { completedAt: null },
      ),

    // `async`, so a malformed `until` rejects the returned promise rather than
    // throwing before the caller has one to await.
    snooze: async (id, until) =>
      base.update(id, { snoozedUntil: snoozeUntilSchema.parse(until) }),
  };
}
