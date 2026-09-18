import {
  type ReminderRule,
  type ReminderRuleBearerType,
  type ReminderRuleInput,
  reminderRuleSchema,
  reminderScheduleInputSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import {
  type EntityRepo,
  createEntityRepo,
  softDeleteWhere,
} from "./entity-repo.js";

export interface ReminderRulesRepo extends EntityRepo<ReminderRule> {
  /** A bearer's active rules, furthest lead first, stable within a lead. */
  listForBearer(
    bearerType: ReminderRuleBearerType,
    bearerId: string,
  ): Promise<ReminderRule[]>;

  /** Replace a bearer's whole schedule, validated as a set so two rules cannot
   *  share an identity. Empty means kind defaults. Transaction-free. */
  replaceForBearer(
    bearerType: ReminderRuleBearerType,
    bearerId: string,
    rules: ReminderRuleInput[],
  ): Promise<void>;

  /** Soft-delete every rule of a bearer. Transaction-free. */
  removeAllForBearer(
    bearerType: ReminderRuleBearerType,
    bearerId: string,
  ): Promise<void>;
}

/** The read/write order: furthest lead first, then stable by insertion time. */
const RULE_ORDER = "offset_days DESC, created_at";

/** The reminder-rules repository. */
export function createReminderRulesRepo(
  driver: SqliteDriver,
): ReminderRulesRepo {
  const base = createEntityRepo<ReminderRule>({
    driver,
    table: "reminder_rules",
    schema: reminderRuleSchema,
    orderBy: RULE_ORDER,
    booleans: ["enabled"],
  });

  return {
    ...base,

    listForBearer: (bearerType, bearerId) =>
      base.listWhere({
        where: "bearer_type = ? AND bearer_id = ?",
        params: [bearerType, bearerId],
        orderBy: RULE_ORDER,
      }),

    async replaceForBearer(bearerType, bearerId, rules) {
      // Validate the whole set up front so a bad row can't half-apply — and so
      // a duplicate identity, which no single row reveals, is caught at all.
      const parsed = reminderScheduleInputSchema.parse(rules);
      await softDeleteWhere(
        driver,
        "reminder_rules",
        "bearer_type = ? AND bearer_id = ?",
        [bearerType, bearerId],
      );
      const now = Date.now();
      for (const rule of parsed) {
        await base.insert({
          id: crypto.randomUUID(),
          bearerType,
          bearerId,
          action: rule.action,
          label: rule.label ?? null,
          offsetDays: rule.offsetDays,
          enabled: rule.enabled,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }
    },

    removeAllForBearer: (bearerType, bearerId) =>
      softDeleteWhere(
        driver,
        "reminder_rules",
        "bearer_type = ? AND bearer_id = ?",
        [bearerType, bearerId],
      ),
  };
}
