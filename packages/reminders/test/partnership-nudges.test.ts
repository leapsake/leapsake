import type { Reminder } from "@leapsake/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type ReminderEngineDeps,
  type UndatedPartnership,
  partnershipNudgeId,
  regenerateSystemReminders,
  snoozePolicyOf,
} from "../src/index.js";

/**
 * The fifth desired-row family, and the only one that **asks for** something
 * rather than reminding of it: you told the app you have a spouse, it does not
 * know your anniversary, and it will never learn one by waiting.
 *
 * What these pin is mostly the ways a collection nudge goes wrong. It must word
 * the right question (asking a partner about their "wedding anniversary" invents
 * a marriage), it must retire itself the moment the answer exists rather than
 * re-asking, and — because a dateless row is *owed*, and owed rows gate "done for
 * the day" — it must be escapable, or a question the user does not want to answer
 * becomes a wall the day cannot get past.
 */

const TODAY = { year: 2026, month: 6, day: 1 } as const;

function makeHarness() {
  const rows = new Map<string, Reminder>();
  let undated: UndatedPartnership[] = [];

  const deps: ReminderEngineDeps = {
    milestones: { listRemindEligible: async () => [] },
    resolveSchedule: async () => ({ rules: [], source: "kind-default" }),
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
    partnerships: { undated: async () => undated },
    today: TODAY,
    transaction: (body) => body(),
  };

  return {
    deps,
    rows,
    setUndated: (next: UndatedPartnership[]) => {
      undated = next;
    },
    /** Stand in for the user pressing *not now* `n` times. */
    snooze: (id: string, n: number) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, snoozeCount: n });
    },
    live: () => [...rows.values()].filter((r) => r.deletedAt === null),
  };
}

const spouse: UndatedPartnership = {
  relationshipId: "r1",
  kind: "wedding",
  partnerLabel: "Alice",
  partnerType: "person",
  partnerId: "p1",
};

const partner: UndatedPartnership = { ...spouse, kind: "first-date" };

describe("the partnership question", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  // The tense is the point, not decoration: an anniversary comes round, a first
  // date happened once.
  it("asks a married couple when their anniversary is", async () => {
    h.setUndated([spouse]);
    await regenerateSystemReminders(h.deps);

    expect(h.live()[0].title).toBe(
      "💍 When is your wedding anniversary with @[Alice](person:p1)?",
    );
  });

  // ⚠️ Asking an unmarried partner about their "wedding anniversary" would have
  // the app inventing a marriage — worse than not asking at all.
  it("asks an unmarried partner when their first date was", async () => {
    h.setUndated([partner]);
    await regenerateSystemReminders(h.deps);

    expect(h.live()[0].title).toBe(
      "💞 When was your first date with @[Alice](person:p1)?",
    );
  });

  // Two questions, not one, and a dismissal of one is not a dismissal of the
  // other — which is why the id carries the kind as well as the relationship.
  it("gives the two questions different identities", () => {
    expect(partnershipNudgeId("r1", "wedding")).not.toBe(
      partnershipNudgeId("r1", "first-date"),
    );
  });

  // It answers itself out of existence: core stops reporting the partnership as
  // undated, and the ordinary prune retires the row.
  it("retires once the date exists", async () => {
    h.setUndated([spouse]);
    await regenerateSystemReminders(h.deps);
    expect(h.live()).toHaveLength(1);

    h.setUndated([]);
    expect(await regenerateSystemReminders(h.deps)).toEqual({
      created: 0,
      updated: 0,
      removed: 1,
    });
    expect(h.live()).toHaveLength(0);
  });

  // ⚠️ The wall. A dateless row is *owed*, so one that could not be put off would
  // keep the day unfinishable for as long as the user declined to answer.
  it("can be put off, and stops coming back after two", async () => {
    h.setUndated([spouse]);
    await regenerateSystemReminders(h.deps);
    const id = partnershipNudgeId("r1", "wedding");
    const now = Date.now();

    expect(
      snoozePolicyOf({ id, snoozeCount: 0, isPartnershipNudge: true }, now),
    ).not.toBeNull();
    expect(
      snoozePolicyOf({ id, snoozeCount: 1, isPartnershipNudge: true }, now),
    ).not.toBeNull();
    // Spent: no more snooze offered, and the row itself leaves below.
    expect(
      snoozePolicyOf({ id, snoozeCount: 2, isPartnershipNudge: true }, now),
    ).toBeNull();

    h.snooze(id, 2);
    await regenerateSystemReminders(h.deps);
    expect(h.live()).toHaveLength(0);
  });

  // Omitting the port prunes what a previous reconcile minted — the same
  // contract `holidays` and `duplicates` carry, so a caller that does not supply
  // a family is never left with its stale rows.
  it("leaves nothing behind when the port is not supplied", async () => {
    h.setUndated([spouse]);
    await regenerateSystemReminders(h.deps);
    expect(h.live()).toHaveLength(1);

    delete (h.deps as { partnerships?: unknown }).partnerships;
    await regenerateSystemReminders(h.deps);
    expect(h.live()).toHaveLength(0);
  });
});
