import { z } from "zod";
import type { DefaultReminderRule } from "./milestone.js";
import type { ReminderRule, ReminderRuleInput } from "./reminder-rule.js";

/**
 * The three synced rows the Holidays feature adds: the **catalog** (what a
 * holiday is), the **observance** (who observes it), and the **hide** (which
 * catalog entries this account doesn't want to see at all). Reminder *rules*
 * hang off the observance and already exist — see `reminder-rule.ts`.
 *
 * Splitting them this way is the load-bearing decision of the whole feature
 * (`@leapsake/holidays` README, the three layers): an observance is milestone-shaped — (bearer,
 * holiday, date-derived-from-catalog) — so it, not the holiday, is what a
 * reminder rule bears on. That is what makes "gift Alice 30 days before
 * Christmas" and "just call Grandma day-of" fall out of the existing
 * `(bearerType, bearerId)` machinery with no third column and no parallel copy
 * of `resolveReminderSchedule`.
 */

/**
 * The fixed namespace every **catalog** holiday id is content-addressed under
 * (see `deterministicUuid` in `@leapsake/crypto`, derived in `holidays-repo.ts`).
 * Kept constant forever, exactly like {@link ./mention.js MENTION_NAMESPACE}:
 * changing it would re-mint every catalog row under a new id and duplicate the
 * lot on next sync.
 *
 * The substrate requires `id: z.uuid()` but a catalog entry wants stable,
 * human-readable identity, so it gets both — the uuid is derived from the slug,
 * and every device derives the same one independently. Seeded rows therefore
 * converge *even without syncing* (research §2.4).
 */
export const HOLIDAY_NAMESPACE = "leapsake:holiday";

/**
 * The namespace an **observance** id is content-addressed under, keyed on
 * `(holidayId, bearerType, bearerId)`.
 *
 * Deterministic rather than random — which is a deliberate departure from
 * research §2.4's "user rows get random UUIDs". That rule is right for a
 * user-*defined holiday* (genuinely new user data) and wrong here: an observance
 * is a statement *about a key*, and the table carries a partial unique index on
 * that key. Two offline devices both toggling "Alice observes Christmas" would
 * otherwise mint two random-id rows for one key, and the second `INSERT` would
 * throw inside `upsertFromRemote` when they met. Deriving the id from the key
 * makes the two writes the *same row*, which whole-row LWW then merges for free
 * — the same reason `mentions` is content-addressed.
 */
export const OBSERVANCE_NAMESPACE = "leapsake:observance";

/** As {@link OBSERVANCE_NAMESPACE}, keyed on the holiday alone. */
export const HIDDEN_HOLIDAY_NAMESPACE = "leapsake:hidden-holiday";

/** The name a catalog holiday's id is derived from. */
export function holidayIdName(slug: string): string {
  return slug;
}

/** The name an observance's id is derived from. */
export function observanceIdName(
  holidayId: string,
  bearerType: ObservanceBearerType,
  bearerId: string,
): string {
  return `${holidayId}:${bearerType}:${bearerId}`;
}

/** The name a hidden-holiday row's id is derived from. */
export function hiddenHolidayIdName(holidayId: string): string {
  return holidayId;
}

/**
 * Where a holiday row came from, and therefore whether it is editable.
 *
 * Catalog rows are **read-only** (research §2.6). Users get `hide` and `create`
 * as two independent primitives instead, which compose to "customise Mother's
 * Day" with no fork mechanism, no copy-on-write, and no lineage tracking — and
 * which kills the update conflict entirely, since a user edit can never lose to,
 * or permanently block, a catalog update.
 */
export const holidayOriginSchema = z.enum(["catalog", "user"]);

export type HolidayOrigin = z.infer<typeof holidayOriginSchema>;

/**
 * A holiday — one catalog entry, or one the user authored. Both live in this
 * table with no polymorphism and no source discriminator on the *observance*
 * side, which is what makes "no broken observances" hold for user-defined
 * holidays too (research §2.4).
 *
 * Deliberately **plaintext** (no per-item content key), like reminders and
 * reminder rules: the catalog is public reference data, and a user-defined
 * holiday's name rides whole-DB-at-rest plus the master-key sync seal.
 *
 * Kept a plain `z.object` (no `.refine`) so the entity repo derives its columns
 * from `.shape`.
 */
export const holidaySchema = z.object({
  id: z.uuid(),
  /** Stable human-readable identity; a catalog row's `id` is derived from it. */
  slug: z.string().min(1),
  name: z.string().min(1),
  /** The occasion phrase reminder copy interpolates — "a Merry Christmas". */
  greeting: z.string().min(1),
  /**
   * The recurrence rule, as the canonical JSON string
   * `canonicalRecurrenceJson` produces (`@leapsake/holidays`).
   *
   * **Opaque here on purpose.** Validating it as a discriminated union would
   * make a rule shape written by a *newer* build fail `decode()` inside
   * `upsertFromRemote` — so the row would be rejected, and this device could no
   * longer relay it onward to a third one. Research §3 wants the opposite:
   * unresolvable holiday ⇒ keep the row, generate nothing. Data syncs; code does
   * not. Parsing happens at read time in `@leapsake/holidays`, which answers
   * `null` for anything it doesn't understand.
   */
  recurrence: z.string().min(1),
  /** Length of a multi-day holiday, display only; the occurrence anchors to the start. */
  durationDays: z.number().int().min(1).nullable(),
  /** Groups variants of one idea (`us-mothers-day` / `uk-mothering-sunday`). */
  familyId: z.string().nullable(),
  /** Whether it is safe to infer from the *user's own* locale (research §2.12). */
  impliedByLocale: z.boolean(),
  origin: holidayOriginSchema,
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type Holiday = z.infer<typeof holidaySchema>;

/** The entities that can observe a holiday. */
export const observanceBearerTypeSchema = z.enum(["person", "pet"]);

export type ObservanceBearerType = z.infer<typeof observanceBearerTypeSchema>;

/**
 * "Grandma observes Hanukkah" — or, with `observes: false`, "Alice doesn't do
 * Christmas".
 *
 * Follows the Relationships precedent (`relationship.ts`) that derived edges are
 * computed live and only explicit ones are stored, but collapses its *two*
 * tables into one with a polarity flag. Relationships need two because their
 * payloads are asymmetric — an explicit edge carries roles and notes, a
 * dismissal is about (pair, role). An observance is thin and symmetric, so one
 * table with a boolean gives one repo, one sync entity, one migration, and no
 * way to hold contradictory rows across two tables (research §2.1):
 *
 * - **no row** → the implicit answer stands (computed live)
 * - **`observes: true`** → explicit assertion
 * - **`observes: false`** → explicit override of an implicit yes
 *
 * A row is written **only where it diverges from the implicit answer** — the
 * same principle as `resolveReminderSchedule`, and what keeps untouched data
 * free of sync churn (research §2.2). It also settles the inference-changed
 * case: if the user later corrects Grandma's religion, an explicit `true`
 * survives and keeps the observance, because the user said so directly. A
 * redundant row would have made that indistinguishable from "the inference
 * happened to agree once".
 */
export const observanceSchema = z.object({
  id: z.uuid(),
  holidayId: z.uuid(),
  bearerType: observanceBearerTypeSchema,
  bearerId: z.uuid(),
  observes: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type Observance = z.infer<typeof observanceSchema>;

/**
 * A suppressed catalog holiday — the negative assertion that gives the user a
 * way out of a read-only catalog row, in the same shape as
 * `relationship_dismissals` and `not_a_duplicate`.
 *
 * Its own table rather than a column on the holiday, because setting a column
 * would be an *edit to a catalog row* and would fight the next catalog update
 * (research §2.6).
 *
 * Two behaviours the implementation must preserve:
 *
 * - **Hiding suppresses reminders, not just browse surfaces.** Otherwise "I hid
 *   Mother's Day" still produces "Call @Alice for Mother's Day". Cleanest as a
 *   final filter after observance resolution. Mother's Day is precisely the
 *   holiday people hide for painful reasons, so getting this wrong is worse than
 *   an ordinary bug.
 * - **Hiding is non-destructive.** It suppresses; it never deletes observances.
 *
 * It **syncs**, and that is not a preference call. Hiding suppresses generated
 * reminders, and those are synced rows with deterministic ids: if one device
 * hid and another didn't, the hiding device would prune (tombstone) the reminder
 * while the other regenerated it under the same id — and because a tombstone is
 * never resurrected, whichever device wrote first would win permanently, with
 * unhiding unable to recover it. The general rule: **any input to the reminder
 * engine must sit on the same side of the sync boundary as the reminders it
 * generates.**
 */
export const hiddenHolidaySchema = z.object({
  id: z.uuid(),
  holidayId: z.uuid(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type HiddenHoliday = z.infer<typeof hiddenHolidaySchema>;

/**
 * The staggered-reminder schedule a fresh observance offers, and which entries
 * start on — the holiday counterpart to a milestone kind's
 * `defaultReminderSchedule`. An observance with no stored rules rides this list
 * (see {@link resolveObservanceReminderSchedule}); rows appear only once a user
 * customises it, so an untouched observance stays free of sync churn.
 *
 * Mirrors the birthday schedule in its *offered* actions, but — unlike a
 * birthday — **nothing is on by default**.
 *
 * The reason is load, and it is specific to holidays. Birthdays spread across
 * the year, so a default-on day-of wish yields roughly one reminder at a time.
 * Holidays do not: every Christmas observance comes due on the same day, so a
 * default-on wish would hand a user with forty people forty reminders at once in
 * late November (research §4, "synchronized load"). That is the kind of volume
 * that trains someone to ignore the surface, which costs more than the silence
 * does — and it would break the codebase's own posture that the day-of birthday
 * wish is the one automated reminder on by default *anywhere*.
 *
 * Reversible either way: reminder ids key on (occurrence, action) rather than on
 * the surface date, so flipping a default re-keys nothing and invalidates no
 * tombstones.
 */
export const observanceDefaultReminderSchedule: DefaultReminderRule[] = [
  { action: "gift", offsetDays: 12, enabledByDefault: false },
  { action: "card", offsetDays: 7, enabledByDefault: false },
  { action: "wish", offsetDays: 0, enabledByDefault: false },
  { action: "call", offsetDays: 0, enabledByDefault: false },
];

/**
 * An observance's effective reminder schedule: its stored rules when it has been
 * customised, else {@link observanceDefaultReminderSchedule}. The direct
 * analogue of `resolveReminderSchedule` for milestones — same "missing rows ⇒
 * defaults" contract, same furthest-lead-first ordering.
 */
export function resolveObservanceReminderSchedule(
  storedRules: ReminderRule[],
): ReminderRuleInput[] {
  const source: ReminderRuleInput[] =
    storedRules.length > 0
      ? storedRules.map((r) => ({
          action: r.action,
          label: r.label,
          offsetDays: r.offsetDays,
          enabled: r.enabled,
        }))
      : observanceDefaultReminderSchedule.map((d) => ({
          action: d.action,
          label: null,
          offsetDays: d.offsetDays,
          enabled: d.enabledByDefault,
        }));
  return [...source].sort((a, b) => b.offsetDays - a.offsetDays);
}

/**
 * Format a `YYYY-MM-DD` occurrence for display.
 *
 * Parsed into calendar parts rather than handed to `new Date(iso)`: that reads a
 * bare date string as **UTC midnight**, which renders the day before for anyone
 * west of Greenwich. An occurrence is a whole civil day, so it is built in local
 * time deliberately.
 */
export function formatOccurrence(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
