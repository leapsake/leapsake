import {
  type CreateReminderInput,
  type Reminder,
  type UpdateReminderInput,
  createReminderInputSchema,
  reminderSchema,
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
}

/**
 * The Reminders repository over the async {@link SqliteDriver} port. Plaintext —
 * no {@link ContentCipher}, unlike milestones; reminders aren't a share target
 * and are already covered by whole-DB-at-rest + master-key-sealed sync. Standard
 * CRUD + the sync surface come from {@link createEntityRepo}; only `create`
 * (input parse + assemble) and the `setCompleted` toggle are bespoke.
 */
export function createRemindersRepo(driver: SqliteDriver): RemindersRepo {
  const base = createEntityRepo<Reminder>({
    driver,
    table: "reminders",
    schema: reminderSchema,
    orderBy: "created_at DESC",
  });

  return {
    ...base,

    async create(input) {
      const {
        title = null,
        body = null,
        source = "user",
      } = createReminderInputSchema.parse(input);
      const now = Date.now();
      return base.insert({
        id: crypto.randomUUID(),
        title,
        body,
        completedAt: null,
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
  };
}
