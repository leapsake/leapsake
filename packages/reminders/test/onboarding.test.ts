import {
  type CivilDate,
  type RemindEligibleMilestone,
  type Reminder,
  compareReminderDue,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ONBOARDING_REMINDERS,
  type ReminderEngineDeps,
  onboardingRouteOf,
  regenerateSystemReminders,
} from "../src/index.js";

/** A fixed local "today" (no milestones under test, so the value is immaterial). */
const TODAY: CivilDate = { year: 2026, month: 6, day: 1 };

/**
 * The engine harness for the onboarding family: an in-memory store plus a fakeable
 * `onboarding` port driven by two mutable booleans. No milestones here — the
 * onboarding nudges are the whole subject — so the milestone ports are inert.
 */
function makeHarness() {
  const rows = new Map<string, Reminder>();
  const signals = { hasEntities: false, syncConnected: false, hasSelf: false };

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
      hasAnyEntity: async () => signals.hasEntities,
      isSyncConnected: async () => signals.syncConnected,
      hasSelf: async () => signals.hasSelf,
    },
  };

  return {
    deps,
    rows,
    signals,
    activeSystem: () =>
      [...rows.values()].filter(
        (r) => r.source === "system" && r.deletedAt === null,
      ),
    byId: (id: string) => rows.get(id),
  };
}

/** The onboarding ids, keyed by route, from the exported convention. */
const idFor = (route: string) =>
  ONBOARDING_REMINDERS.find((r) => r.route === route)!.id;

describe("onboarding reminders", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("seeds both nudges for a fresh store — dateless, system-sourced, exact copy", async () => {
    const result = await regenerateSystemReminders(h.deps);
    // A fresh store has no entities, so the pick-self nudge (which needs a person
    // to pick from) doesn't apply yet — only the sync and add-person nudges do.
    expect(result).toEqual({ created: 2, updated: 0, removed: 0 });

    const rows = h.activeSystem();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.source).toBe("system");
      expect(r.dueDate).toBeNull(); // onboarding nudges carry no due date
      expect(r.completedAt).toBeNull();
      expect(r.body).toBeNull();
    }

    // Ids are exactly the exported convention, so client CTA lookup lines up.
    expect(new Set(rows.map((r) => r.id))).toEqual(
      new Set([idFor("connect-sync"), idFor("add-person")]),
    );
    expect(h.byId(idFor("add-person"))?.title).toBe(
      "👋 Add your first person to get started",
    );
    expect(h.byId(idFor("connect-sync"))?.title).toBe(
      "🔄 Already using Leapsake on another device? Connect to sync.",
    );
  });

  it("orders the sync nudge above the add-person nudge on Home", async () => {
    await regenerateSystemReminders(h.deps);

    // Home sorts open reminders with compareReminderDue; both nudges are dateless,
    // so the createdAt back-off is what puts sync first.
    const ordered = h.activeSystem().sort(compareReminderDue);
    expect(ordered.map((r) => r.id)).toEqual([
      idFor("connect-sync"),
      idFor("add-person"),
    ]);
  });

  it("is idempotent: a second run adds/changes nothing", async () => {
    await regenerateSystemReminders(h.deps);
    const second = await regenerateSystemReminders(h.deps);
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(2);
  });

  it("retires 'add your first person' once an entity exists, keeping the sync nudge", async () => {
    await regenerateSystemReminders(h.deps);

    h.signals.hasEntities = true; // user added their first person/pet
    h.signals.hasSelf = true; // ...and already picked themselves (isolate this nudge)
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 1 });

    const live = h.activeSystem();
    expect(live.map((r) => r.id)).toEqual([idFor("connect-sync")]);
  });

  it("retires 'sync another device' once sync is connected", async () => {
    await regenerateSystemReminders(h.deps);

    h.signals.syncConnected = true; // relay bound
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 1 });

    const live = h.activeSystem();
    expect(live.map((r) => r.id)).toEqual([idFor("add-person")]);
  });

  it("retires both once each condition is met", async () => {
    await regenerateSystemReminders(h.deps);
    h.signals.hasEntities = true;
    h.signals.syncConnected = true;
    h.signals.hasSelf = true; // all three conditions met

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 2 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("never resurrects a dismissed nudge, even while its condition still holds", async () => {
    await regenerateSystemReminders(h.deps);
    const id = idFor("add-person");

    await h.deps.reminders.softDelete(id); // user dismissed it

    // Condition (no entities) is still true, but the tombstone stays dead.
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.byId(id)?.deletedAt).not.toBeNull();
    expect(h.activeSystem().map((r) => r.id)).toEqual([idFor("connect-sync")]);
  });

  it("does not re-nag a retired nudge if its condition later reverts", async () => {
    await regenerateSystemReminders(h.deps);
    h.signals.hasEntities = true;
    h.signals.hasSelf = true; // isolate: don't introduce the pick-self nudge
    await regenerateSystemReminders(h.deps); // 'add-person' retired (tombstoned)

    // The user deletes all their people again — the condition reverts, but the
    // retired nudge must stay gone (the intentional "don't re-nag" semantic).
    h.signals.hasEntities = false;
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.byId(idFor("add-person"))?.deletedAt).not.toBeNull();
  });

  it("surfaces 'pick yourself' once a person exists and self is unset", async () => {
    // Fresh store: no person to pick from, so the nudge is absent.
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem().map((r) => r.id)).not.toContain(idFor("pick-self"));

    // A person now exists but self is still unset — the nudge applies.
    h.signals.hasEntities = true;
    await regenerateSystemReminders(h.deps);
    const pickSelf = h.byId(idFor("pick-self"));
    expect(pickSelf?.title).toBe("🙋 Which of these is you? Pick yourself.");
    expect(pickSelf?.dueDate).toBeNull();
    expect(h.activeSystem().map((r) => r.id)).toContain(idFor("pick-self"));
  });

  it("retires 'pick yourself' once the self-person is set", async () => {
    h.signals.hasEntities = true;
    await regenerateSystemReminders(h.deps); // pick-self surfaced
    expect(h.activeSystem().map((r) => r.id)).toContain(idFor("pick-self"));

    h.signals.hasSelf = true; // user picked themselves
    const result = await regenerateSystemReminders(h.deps);
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(h.activeSystem().map((r) => r.id)).not.toContain(idFor("pick-self"));
  });

  it("skips onboarding entirely when no port is injected", async () => {
    const { onboarding, ...noPort } = h.deps;
    void onboarding;
    const result = await regenerateSystemReminders(noPort);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  describe("onboardingRouteOf", () => {
    it("maps each onboarding id to its route", () => {
      for (const { id, route } of ONBOARDING_REMINDERS) {
        expect(onboardingRouteOf(id)).toBe(route);
      }
    });

    it("returns null for a non-onboarding (milestone / user) id", () => {
      expect(onboardingRouteOf(crypto.randomUUID())).toBeNull();
    });
  });
});

/** A remind-eligible birthday helper — used only to prove the two families
 *  coexist in one desired set without pruning each other. */
function birthday(
  id: string,
  bearerId: string,
  occ: CivilDate,
): RemindEligibleMilestone {
  return {
    id,
    kind: "birthday",
    bearerType: "person",
    bearerId,
    year: null,
    month: occ.month,
    day: occ.day,
  };
}

describe("onboarding + milestone families coexist", () => {
  it("keeps a birthday reminder and the onboarding nudges in one reconcile", async () => {
    const h = makeHarness();
    // Add a birthday ~10 days out alongside the fresh-store onboarding nudges.
    const occ: CivilDate = { year: TODAY.year, month: TODAY.month, day: 11 };
    h.deps.milestones.listRemindEligible = async () => [
      birthday("m1", "p1", occ),
    ];
    h.deps.resolveSchedule = async (m) => resolveReminderSchedule(m.kind, []);
    h.deps.resolveLabel = async () => "Alice";

    const result = await regenerateSystemReminders(h.deps);
    // Two onboarding nudges + one birthday reminder, none pruning the others.
    expect(result).toEqual({ created: 3, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(3);
  });
});
