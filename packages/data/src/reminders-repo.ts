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
  /** Toggle completion through `update`, so it syncs. Completing clears any
   *  snooze, which would otherwise hide a reopened reminder. */
  setCompleted(id: string, completed: boolean): Promise<Reminder | undefined>;
  /** Put a reminder off until a civil day; `snoozeTargetOf` decides what is
   *  allowed. Undefined, writing nothing, for a missing id. */
  snooze(id: string, until: number): Promise<Reminder | undefined>;
}

/** The reminders repository. */
export function createRemindersRepo(driver: SqliteDriver): RemindersRepo {
  const base = createEntityRepo<Reminder>({
    driver,
    table: "reminders",
    schema: reminderSchema,
    orderBy: "created_at DESC",
    // System rows have deterministic ids, so a fresh mint must not out-rank a
    // peer's dismissal or snooze (see {@link reminderHasHistory}).
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
