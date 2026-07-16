import {
  type ReminderRule,
  type ReminderRuleBearerType,
  type ReminderRuleInput,
  reminderRuleInputSchema,
  reminderRuleSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import {
  type EntityRepo,
  createEntityRepo,
  softDeleteWhere,
} from "./entity-repo.js";

export interface ReminderRulesRepo extends EntityRepo<ReminderRule> {
  /**
   * Every active reminder rule of a bearer (a milestone today), furthest lead
   * first (a month → a week → day-of), stable within an equal lead.
   */
  listForBearer(
    bearerType: ReminderRuleBearerType,
    bearerId: string,
  ): Promise<ReminderRule[]>;

  /**
   * Replace a bearer's whole reminder schedule: soft-delete its active rules,
   * then insert the supplied set (an empty array clears it back to "no
   * reminders" — the milestone then rides its kind defaults again). Rows get
   * fresh random ids on each save, matching contact methods' set-replace: rules
   * aren't deduped across devices, just merged by whole-row LWW.
   *
   * Transaction-free building block — the caller composes it with the milestone
   * write inside one transaction so the schedule and the milestone never
   * diverge.
   */
  replaceForBearer(
    bearerType: ReminderRuleBearerType,
    bearerId: string,
    rules: ReminderRuleInput[],
  ): Promise<void>;

  /**
   * Soft-delete every active reminder rule of a bearer. Used when the host
   * milestone is deleted. Transaction-free building block.
   */
  removeAllForBearer(
    bearerType: ReminderRuleBearerType,
    bearerId: string,
  ): Promise<void>;
}

/** The read/write order: furthest lead first, then stable by insertion time. */
const RULE_ORDER = "offset_days DESC, created_at";

/**
 * The Reminder Rules repository, written against the async {@link SqliteDriver}
 * port so it runs unchanged on desktop and mobile. A plain synced entity — no
 * codec, `enabled` is the one 0/1 boolean SQLite has no type for. Reads exclude
 * soft-deleted rows and writes never hard-delete.
 */
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
      // Validate the whole set up front so a bad row can't half-apply.
      const parsed = rules.map((r) => reminderRuleInputSchema.parse(r));
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
