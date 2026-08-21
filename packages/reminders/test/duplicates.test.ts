import {
  type CivilDate,
  type Reminder,
  compareReminderDue,
} from "@leapsake/schema";
import { withFlags } from "@leapsake/flags";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ONBOARDING_REMINDERS,
  type ReminderEngineDeps,
  duplicatesReminderId,
  regenerateSystemReminders,
} from "../src/index.js";

/** A fixed local "today" (no milestones under test, so the value is immaterial). */
const TODAY: CivilDate = { year: 2026, month: 6, day: 1 };

/**
 * The engine harness for the duplicates family: an in-memory store plus a
 * fakeable `duplicates` port driven by a mutable pair list. The onboarding port
 * is supplied with every signal already satisfied, so no onboarding nudge joins
 * the desired set and the duplicates row is the only thing under test — except
 * in the ordering case, which flips signals back on deliberately.
 */
function makeHarness() {
  const rows = new Map<string, Reminder>();
  const state = {
    pairs: [] as string[],
    syncConnected: true,
    hasAccount: true,
  };

  const deps: ReminderEngineDeps = {
    milestones: { listRemindEligible: async () => [] },
    resolveSchedule: async () => [],
    reminders: {
      getIncludingDeleted: async (id) => rows.get(id),
      insert: async (row) => {
        rows.set(row.id, row);
        return row;
      },
      update: async (id, fields) => {
        const row = rows.get(id);
        if (row)
          rows.set(id, { ...row, ...fields, updatedAt: row.updatedAt + 1 });
      },
      listWhere: async ({ params }) =>
        [...rows.values()].filter(
          (r) => r.source === params[0] && r.deletedAt === null,
        ),
      softDelete: async (id) => {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, deletedAt: Date.now() });
      },
    },
    resolveLabel: async () => null,
    today: TODAY,
    transaction: (body) => body(),
    onboarding: {
      hasAnyEntity: async () => true,
      isSyncConnected: async () => state.syncConnected,
      hasSelf: async () => true,
      hasAccount: async () => state.hasAccount,
    },
    duplicates: { pairKeys: async () => state.pairs },
  };

  return {
    deps,
    rows,
    state,
    activeSystem: () =>
      [...rows.values()].filter(
        (r) => r.source === "system" && r.deletedAt === null,
      ),
    byId: (id: string) => rows.get(id),
  };
}

describe("duplicates nudge", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("mints nothing when there are no outstanding pairs", async () => {
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("mints one dateless summary row for the outstanding pairs", async () => {
    h.state.pairs = ["a:b"];
    await regenerateSystemReminders(h.deps);

    const rows = h.activeSystem();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(duplicatesReminderId(["a:b"]));
    expect(row.source).toBe("system");
    expect(row.dueDate).toBeNull();
    expect(row.body).toBeNull();
    expect(row.title).toBe("🔗 Two people might be the same — review");
  });

  it("states the count, and one row covers many pairs", async () => {
    h.state.pairs = ["a:b", "c:d", "e:f"];
    await regenerateSystemReminders(h.deps);

    const rows = h.activeSystem();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe(
      "🔗 3 pairs of people might be the same — review",
    );
  });

  it("derives the same id regardless of the order pairs arrive in", () => {
    expect(duplicatesReminderId(["c:d", "a:b"])).toBe(
      duplicatesReminderId(["a:b", "c:d"]),
    );
  });

  it("is a no-op when the pair set is unchanged", async () => {
    h.state.pairs = ["a:b"];
    await regenerateSystemReminders(h.deps);
    const second = await regenerateSystemReminders(h.deps);
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
  });

  it("retires the nudge once every pair is resolved", async () => {
    h.state.pairs = ["a:b"];
    await regenerateSystemReminders(h.deps);
    const id = duplicatesReminderId(["a:b"]);

    // The pair was merged or marked "not the same": it leaves the candidate set.
    h.state.pairs = [];
    const result = await regenerateSystemReminders(h.deps);
    expect(result.removed).toBe(1);
    expect(h.activeSystem()).toHaveLength(0);
    expect(h.byId(id)?.deletedAt).not.toBeNull();
  });

  it("re-nags under a fresh id when a *new* pair appears later", async () => {
    // The whole reason the id tracks the pair set: `reconcile` never resurrects a
    // tombstoned id, so a fixed key would make this nudge fire exactly once ever.
    h.state.pairs = ["a:b"];
    await regenerateSystemReminders(h.deps);
    h.state.pairs = [];
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(0);

    h.state.pairs = ["c:d"];
    await regenerateSystemReminders(h.deps);
    const rows = h.activeSystem();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(duplicatesReminderId(["c:d"]));
  });

  it("restates the count when one of several pairs is resolved", async () => {
    h.state.pairs = ["a:b", "c:d"];
    await regenerateSystemReminders(h.deps);
    const first = duplicatesReminderId(["a:b", "c:d"]);

    h.state.pairs = ["a:b"];
    await regenerateSystemReminders(h.deps);

    // The old row retires and a new one states the new count — the set changed,
    // so it is a different fact under a different id.
    expect(h.byId(first)?.deletedAt).not.toBeNull();
    const rows = h.activeSystem();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(duplicatesReminderId(["a:b"]));
    expect(rows[0].title).toBe("🔗 Two people might be the same — review");
  });

  it("stays dismissed for that pair set once the user deletes it", async () => {
    h.state.pairs = ["a:b"];
    await regenerateSystemReminders(h.deps);
    const id = duplicatesReminderId(["a:b"]);

    // A user-deleted row is a tombstone; reconcile leaves it dead.
    h.rows.set(h.rows.get(id)!.id, {
      ...h.rows.get(id)!,
      deletedAt: Date.now(),
    });
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem()).toHaveLength(0);
  });

  // Ranking is only interesting with both custody nudges present, and the
  // sign-in one is gated behind `multiDevice` — off in what v0.1 ships.
  it("ranks below the onboarding nudges on Home", async () => {
    await withFlags({ multiDevice: true }, async () => {
      // Accountless brings both custody nudges back into the set (the harness's
      // entities satisfy the account invitation's other half).
      h.state.syncConnected = false;
      h.state.hasAccount = false;
      h.state.pairs = ["a:b"];
      await regenerateSystemReminders(h.deps);

      // Both families are dateless, so the createdAt back-off is what orders
      // them: finish setting up before being sent to reconcile the list.
      const ordered = h.activeSystem().sort(compareReminderDue);
      expect(ordered.map((r) => r.id)).toEqual([
        ONBOARDING_REMINDERS.find((r) => r.route === "connect-sync")!.id,
        ONBOARDING_REMINDERS.find((r) => r.route === "create-account")!.id,
        duplicatesReminderId(["a:b"]),
      ]);
    });
  });

  it("adds no rows when the port is omitted", async () => {
    const { duplicates: _omitted, ...withoutPort } = h.deps;
    h.state.pairs = ["a:b"];
    await regenerateSystemReminders(withoutPort);
    expect(h.activeSystem()).toHaveLength(0);
  });
});
