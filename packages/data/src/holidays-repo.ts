import { deterministicUuid } from "@leapsake/bytes";
import {
  HIDDEN_HOLIDAY_NAMESPACE,
  HOLIDAY_NAMESPACE,
  type HiddenHoliday,
  type Holiday,
  OBSERVANCE_NAMESPACE,
  type Observance,
  type ObservanceBearerType,
  hiddenHolidayIdName,
  hiddenHolidaySchema,
  holidayIdName,
  holidaySchema,
  observanceIdName,
  observanceSchema,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import {
  type EntityRepo,
  createEntityRepo,
  softDeleteWhere,
} from "./entity-repo.js";

/** The three holiday repositories. Ids are content-addressed, so two devices
 *  asserting the same fact mint one row instead of colliding. */

/** The uuid a catalog holiday's slug derives to, on every device alike. */
export function holidayIdFor(slug: string): string {
  return deterministicUuid(HOLIDAY_NAMESPACE, holidayIdName(slug));
}

/** The uuid an observance of `(holiday, bearer)` derives to. */
export function observanceIdFor(
  holidayId: string,
  bearerType: ObservanceBearerType,
  bearerId: string,
): string {
  return deterministicUuid(
    OBSERVANCE_NAMESPACE,
    observanceIdName(holidayId, bearerType, bearerId),
  );
}

/** The uuid a hidden-holiday row for `holidayId` derives to. */
export function hiddenHolidayIdFor(holidayId: string): string {
  return deterministicUuid(
    HIDDEN_HOLIDAY_NAMESPACE,
    hiddenHolidayIdName(holidayId),
  );
}

export interface HolidaysRepo extends EntityRepo<Holiday> {
  /** One holiday by its stable slug, or undefined. */
  getBySlug(slug: string): Promise<Holiday | undefined>;
}

/** Catalog order: name, so the browse list reads alphabetically. */
const HOLIDAY_ORDER = "name";

export function createHolidaysRepo(driver: SqliteDriver): HolidaysRepo {
  const base = createEntityRepo<Holiday>({
    driver,
    table: "holidays",
    schema: holidaySchema,
    orderBy: HOLIDAY_ORDER,
    booleans: ["impliedByLocale"],
  });

  return {
    ...base,
    async getBySlug(slug) {
      const [row] = await base.listWhere({ where: "slug = ?", params: [slug] });
      return row;
    },
  };
}

export interface ObservancesRepo extends EntityRepo<Observance> {
  /** Every active observance of one holiday — the observer picker's read. */
  listForHoliday(holidayId: string): Promise<Observance[]>;
  /** Every active observance of one person/pet — the person page's read. */
  listForBearer(
    bearerType: ObservanceBearerType,
    bearerId: string,
  ): Promise<Observance[]>;
  /** Assert or clear one observance by key; `null` deletes the row, back to
   *  the implicit answer. Revives a tombstone by id. Transaction-free. */
  setObservance(
    holidayId: string,
    bearerType: ObservanceBearerType,
    bearerId: string,
    observes: boolean | null,
  ): Promise<void>;
  /** Soft-delete every observance of a bearer; used when the person is deleted. */
  removeAllForBearer(
    bearerType: ObservanceBearerType,
    bearerId: string,
  ): Promise<void>;
  /** Move a bearer's observances for a people merge: new rows under the
   *  survivor's derived ids, loser's tombstoned; the survivor's answer wins. */
  repointBearer(
    bearerType: ObservanceBearerType,
    loserId: string,
    survivorId: string,
  ): Promise<void>;
}

export function createObservancesRepo(driver: SqliteDriver): ObservancesRepo {
  const base = createEntityRepo<Observance>({
    driver,
    table: "observances",
    schema: observanceSchema,
    booleans: ["observes"],
  });

  const listForBearer: ObservancesRepo["listForBearer"] = (
    bearerType,
    bearerId,
  ) =>
    base.listWhere({
      where: "bearer_type = ? AND bearer_id = ?",
      params: [bearerType, bearerId],
    });

  const setObservance: ObservancesRepo["setObservance"] = async (
    holidayId,
    bearerType,
    bearerId,
    observes,
  ) => {
    const id = observanceIdFor(holidayId, bearerType, bearerId);
    if (observes === null) {
      await softDeleteWhere(driver, "observances", "id = ?", [id]);
      return;
    }
    // Revive a tombstone explicitly: `update` does not see it, and an insert
    // would hit the unique index.
    const existing = await base.getIncludingDeleted(id);
    const now = Date.now();
    if (existing === undefined) {
      await base.insert({
        id,
        holidayId,
        bearerType,
        bearerId,
        observes,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      return;
    }
    await driver.run(
      `UPDATE observances
          SET observes = ?, deleted_at = NULL, updated_at = MAX(?, updated_at + 1)
        WHERE id = ?`,
      [observes ? 1 : 0, now, id],
    );
  };

  return {
    ...base,
    listForBearer,
    setObservance,

    listForHoliday: (holidayId) =>
      base.listWhere({ where: "holiday_id = ?", params: [holidayId] }),

    async repointBearer(bearerType, loserId, survivorId) {
      for (const row of await listForBearer(bearerType, loserId)) {
        const survivorsOwn = await base.get(
          observanceIdFor(row.holidayId, bearerType, survivorId),
        );
        // The survivor already answered for this holiday — keep their answer.
        if (survivorsOwn !== undefined) continue;
        await setObservance(
          row.holidayId,
          bearerType,
          survivorId,
          row.observes,
        );
      }
      await softDeleteWhere(
        driver,
        "observances",
        "bearer_type = ? AND bearer_id = ?",
        [bearerType, loserId],
      );
    },

    removeAllForBearer: (bearerType, bearerId) =>
      softDeleteWhere(
        driver,
        "observances",
        "bearer_type = ? AND bearer_id = ?",
        [bearerType, bearerId],
      ),
  };
}

export interface HiddenHolidaysRepo extends EntityRepo<HiddenHoliday> {
  /** The ids of every currently-hidden holiday. */
  listHiddenIds(): Promise<Set<string>>;
  /** Hide or unhide one holiday. Unhiding never touches its observances. */
  setHidden(holidayId: string, hidden: boolean): Promise<void>;
}

export function createHiddenHolidaysRepo(
  driver: SqliteDriver,
): HiddenHolidaysRepo {
  const base = createEntityRepo<HiddenHoliday>({
    driver,
    table: "hidden_holidays",
    schema: hiddenHolidaySchema,
  });

  return {
    ...base,

    async listHiddenIds() {
      return new Set((await base.list()).map((row) => row.holidayId));
    },

    async setHidden(holidayId, hidden) {
      const id = hiddenHolidayIdFor(holidayId);
      if (!hidden) {
        await softDeleteWhere(driver, "hidden_holidays", "id = ?", [id]);
        return;
      }
      const existing = await base.getIncludingDeleted(id);
      const now = Date.now();
      if (existing === undefined) {
        await base.insert({
          id,
          holidayId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        return;
      }
      await driver.run(
        `UPDATE hidden_holidays
            SET deleted_at = NULL, updated_at = MAX(?, updated_at + 1)
          WHERE id = ?`,
        [now, id],
      );
    },
  };
}
