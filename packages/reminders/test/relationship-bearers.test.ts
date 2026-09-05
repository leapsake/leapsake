import {
  type CivilDate,
  type MilestoneBearerType,
  type MilestoneKind,
  type RemindEligibleMilestone,
  type Reminder,
  actionDefs,
  civilFromDueMs,
  dueDateMs,
  mentionToken,
  promptOffsetDays,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type ReminderEngineDeps,
  regenerateSystemReminders,
} from "../src/index.js";

/**
 * Two things that were once one bug, and the gate that sits on top of them.
 *
 * A milestone borne by a **relationship** used to generate nothing at all: the
 * composition root answered `null` to the label port for that bearer type, the
 * engine reads `null` as "the bearer is gone", and so every wedding anniversary
 * linked to its relationship — the flow both clients invite — was skipped in
 * silence, prompt included. These pin the fix from the engine's side: given a
 * label, a relationship behaves like any other bearer, and it reaches
 * {@link ReminderEngineDeps.isSelf} so a relationship you are in can say "your
 * own".
 *
 * The gate is `prompt.onlyOwnPartnership`, which only `first-date` sets, and its
 * default matters as much as its behaviour: with no port wired it asks nobody,
 * because the failure it exists to prevent is asking about other people's.
 */

const TODAY: CivilDate = { year: 2026, month: 6, day: 1 };
const DAY_MS = 86_400_000;

/** `days` from {@link TODAY}. */
const daysOut = (days: number): CivilDate =>
  civilFromDueMs(dueDateMs(TODAY) + days * DAY_MS);

/** When each kind's question appears, derived so moving a number moves this. */
const appears = (kind: MilestoneKind) =>
  promptOffsetDays(kind) + actionDefs.plan.activeDays;

function makeHarness() {
  const rows = new Map<string, Reminder>();
  let milestones: RemindEligibleMilestone[] = [];
  let ownPartnership: ReminderEngineDeps["isOwnPartnership"];
  const labels = new Map<string, string>([
    ["r1", "Alice"], // a relationship the self-person is one end of
    ["r2", "Bob & Carol"], // one they are not
    ["p1", "Alice"],
  ]);
  const selves = new Set<string>(["r1"]);

  const deps: ReminderEngineDeps = {
    milestones: { listRemindEligible: async () => milestones },
    resolveSchedule: async (m) => resolveReminderSchedule(m.kind, []),
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
    resolveLabel: async (_type, id) => labels.get(id) ?? null,
    isSelf: async (_type, id) => selves.has(id),
    isOwnPartnership: (type, id) => ownPartnership!(type, id),
    today: TODAY,
    transaction: (body) => body(),
  };

  return {
    deps,
    setMilestones: (next: RemindEligibleMilestone[]) => {
      milestones = next;
    },
    /** `undefined` drops the port entirely — the unwired case. */
    setOwnPartnership: (fn: ReminderEngineDeps["isOwnPartnership"]) => {
      ownPartnership = fn;
      if (fn === undefined)
        delete (deps as { isOwnPartnership?: unknown }).isOwnPartnership;
    },
    titles: () =>
      [...rows.values()]
        .filter((r) => r.deletedAt === null)
        .map((r) => r.title),
  };
}

function milestone(
  id: string,
  kind: MilestoneKind,
  bearerType: MilestoneBearerType,
  bearerId: string,
  occ: CivilDate,
): RemindEligibleMilestone {
  return {
    id,
    kind,
    bearerType,
    bearerId,
    year: null,
    month: occ.month,
    day: occ.day,
  };
}

describe("a milestone borne by a relationship", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
    h.setOwnPartnership(async () => false);
  });

  // The regression. Before the label port learned to name a relationship this
  // produced zero rows, and the failure was silent on both sides: nothing threw,
  // and nothing appeared.
  it("generates its reminders, rather than being skipped as a dangling bearer", async () => {
    h.setMilestones([
      milestone(
        "m1",
        "wedding",
        "relationship",
        "r2",
        daysOut(appears("wedding")),
      ),
    ]);

    const result = await regenerateSystemReminders(h.deps);

    expect(result.created).toBeGreaterThan(0);
    expect(h.titles()).toContain(
      "🗓 How do you want to mark Bob & Carol's wedding anniversary?",
    );
  });

  // A relationship is not a person, but it can still be *yours* — and that is
  // the whole reason `isSelf` stopped being asked only about people.
  it("takes the self-directed copy when the self-person is one end of it", async () => {
    h.setMilestones([
      milestone(
        "m1",
        "wedding",
        "relationship",
        "r1",
        daysOut(appears("wedding")),
      ),
    ]);

    await regenerateSystemReminders(h.deps);

    expect(h.titles()).toContain(
      "🗓 How do you want to mark your own wedding anniversary?",
    );
  });

  // A bearer with no name left is still gone, and must still be skipped: the fix
  // separated the two meanings of `null`, it did not remove one.
  it("is still skipped when the relationship itself resolves to nothing", async () => {
    h.setMilestones([
      milestone(
        "m1",
        "wedding",
        "relationship",
        "gone",
        daysOut(appears("wedding")),
      ),
    ]);

    expect(await regenerateSystemReminders(h.deps)).toEqual({
      created: 0,
      updated: 0,
      removed: 0,
    });
  });
});

describe("a prompt gated on the occasion being the user's own", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  const firstDate = (bearerType: MilestoneBearerType, bearerId: string) =>
    milestone(
      "m1",
      "first-date",
      bearerType,
      bearerId,
      daysOut(appears("first-date")),
    );

  it("asks about a first date with your own partner", async () => {
    h.setOwnPartnership(async () => true);
    h.setMilestones([firstDate("person", "p1")]);

    await regenerateSystemReminders(h.deps);

    expect(h.titles()).toContain(
      `🗓 How do you want to mark ${mentionToken("Alice", "person", "p1")}'s first date?`,
    );
  });

  // The point of the gate. Someone else's first date is not an occasion a third
  // party marks, so a question about one reads as the app misunderstanding what
  // it is for.
  it("says nothing about anyone else's", async () => {
    h.setOwnPartnership(async () => false);
    h.setMilestones([firstDate("person", "p1")]);

    expect(await regenerateSystemReminders(h.deps)).toEqual({
      created: 0,
      updated: 0,
      removed: 0,
    });
  });

  // ⚠️ Fails **closed**. An unwired port must not fall back to asking everybody:
  // that is precisely the question the gate exists to suppress, and a wiring
  // mistake would restore it everywhere at once.
  it("asks nobody when the port is not wired at all", async () => {
    h.setOwnPartnership(undefined);
    h.setMilestones([firstDate("person", "p1")]);

    expect(await regenerateSystemReminders(h.deps)).toEqual({
      created: 0,
      updated: 0,
      removed: 0,
    });
  });

  // The gate is per-kind, and only `first-date` declares it. A wedding
  // anniversary is an occasion other people do mark, so it keeps asking about
  // everyone's — including when the port says the partnership is not yours.
  it("leaves an ungated kind asking about everyone", async () => {
    h.setOwnPartnership(async () => false);
    h.setMilestones([
      milestone("m1", "wedding", "person", "p1", daysOut(appears("wedding"))),
    ]);

    await regenerateSystemReminders(h.deps);

    expect(h.titles()).toContain(
      `🗓 How do you want to mark ${mentionToken("Alice", "person", "p1")}'s wedding anniversary?`,
    );
  });
});
