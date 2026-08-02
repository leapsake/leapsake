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
  snoozePolicyOf,
} from "../src/index.js";

/** A fixed local "today" (no milestones under test, so the value is immaterial). */
const TODAY: CivilDate = { year: 2026, month: 6, day: 1 };

/** Milliseconds in a day — the unit the steps' snooze durations are expressed in. */
const DAY_MS = 86_400_000;

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
    /**
     * Put a row off `times` times, as the write method behind a "not now" will:
     * bump the count and set the clock. Here rather than in production code
     * because that write method is a later slice — the engine only ever *reads*
     * these two fields.
     */
    snooze: (id: string, times = 1) => {
      const row = rows.get(id);
      if (row === undefined) throw new Error(`no such reminder: ${id}`);
      rows.set(id, {
        ...row,
        snoozedUntil: Date.now() + times * DAY_MS,
        snoozeCount: row.snoozeCount + times,
      });
    },
  };
}

/** The onboarding ids, keyed by route, from the exported convention. */
const idFor = (route: string) =>
  ONBOARDING_REMINDERS.find((r) => r.route === route)!.id;

/** The snooze dials the step definitions currently carry, mirrored once so that
 *  re-tuning them — which is meant to be cheap — is a one-line edit here too. */
const SNOOZE_DAYS = 3;
const REPETITIONS = {
  "connect-sync": 2,
  "add-person": 2,
  "pick-self": 2,
} as const;

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

  describe("snooze retirement", () => {
    it("keeps a snoozed-but-not-exhausted step desired, and never prunes it", async () => {
      // Isolate pick-self (2 repetitions): sync is connected, a person exists.
      h.signals.hasEntities = true;
      h.signals.syncConnected = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("pick-self");
      expect(h.activeSystem().map((r) => r.id)).toEqual([id]);

      h.snooze(id); // one "not now" of the two it allows

      // The trap this slice exists to avoid: a deferral that stopped desiring the
      // row would tombstone it here, and a tombstone is never resurrected — so
      // "not now" would silently have meant "never".
      const result = await regenerateSystemReminders(h.deps);
      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(h.byId(id)?.deletedAt).toBeNull();
      expect(h.activeSystem().map((r) => r.id)).toEqual([id]);
    });

    it("retires a step once its snooze count reaches its repetitions", async () => {
      h.signals.hasEntities = true;
      h.signals.syncConnected = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("pick-self");

      h.snooze(id, REPETITIONS["pick-self"]); // one past the boundary above

      const result = await regenerateSystemReminders(h.deps);
      expect(result).toEqual({ created: 0, updated: 0, removed: 1 });
      expect(h.byId(id)?.deletedAt).not.toBeNull();
      expect(h.activeSystem()).toHaveLength(0);
    });

    it("never retires any step on a single 'not now'", async () => {
      // The floor the owner set on 2026-08-01: every step comes back at least
      // once. At one repetition the first "not now" would spend the whole budget
      // and the next reconcile would tombstone the row before its clock was ever
      // read — making the gentle option the permanent one, and hiding "don't ask
      // again" for good, since that only appears on a second sighting.
      for (const route of [
        "connect-sync",
        "add-person",
        "pick-self",
      ] as const) {
        expect(REPETITIONS[route]).toBeGreaterThanOrEqual(2);
      }

      // Proven through the engine for one of them, not just asserted on a literal.
      h.signals.hasEntities = true;
      h.signals.hasSelf = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("connect-sync");
      expect(h.activeSystem().map((r) => r.id)).toEqual([id]);

      h.snooze(id);

      const result = await regenerateSystemReminders(h.deps);
      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(h.byId(id)?.deletedAt).toBeNull();
    });

    it("leaves an exhausted step gone, though its condition still holds", async () => {
      h.signals.hasEntities = true;
      h.signals.hasSelf = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("connect-sync");
      h.snooze(id, REPETITIONS["connect-sync"]);
      await regenerateSystemReminders(h.deps); // retired

      // Sync is still not connected, so the step still applies — and stays dead.
      const result = await regenerateSystemReminders(h.deps);
      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(h.byId(id)?.deletedAt).not.toBeNull();
      expect(h.activeSystem()).toHaveLength(0);
    });

    it("never clears or resets a snooze on reconcile", async () => {
      h.signals.hasEntities = true;
      h.signals.syncConnected = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("pick-self");
      h.snooze(id);
      const snoozed = h.byId(id);

      const result = await regenerateSystemReminders(h.deps);

      // A snooze is the user's, and reconcile runs on a schedule they didn't ask
      // for — so it must leave both fields exactly as it found them.
      expect(result.updated).toBe(0);
      expect(h.byId(id)?.snoozedUntil).toBe(snoozed?.snoozedUntil);
      expect(h.byId(id)?.snoozeCount).toBe(1);
    });
  });

  describe("snoozePolicyOf", () => {
    const NOW = Date.UTC(2026, 5, 1, 9, 30);

    it("offers a snooze running to the step's duration from now", () => {
      expect(
        snoozePolicyOf({ id: idFor("pick-self"), snoozeCount: 0 }, NOW),
      ).toEqual({ until: NOW + SNOOZE_DAYS * DAY_MS });
    });

    it("stops offering once the step's repetitions are spent", () => {
      const id = idFor("pick-self");
      expect(
        snoozePolicyOf({ id, snoozeCount: REPETITIONS["pick-self"] - 1 }, NOW),
      ).not.toBeNull();
      expect(
        snoozePolicyOf({ id, snoozeCount: REPETITIONS["pick-self"] }, NOW),
      ).toBeNull();
    });

    it("reads each step's own budget, whatever it is set to", () => {
      // The dials are per-step by construction even while all three share a
      // value today — so this asserts the lookup, against each step's own number.
      for (const route of [
        "connect-sync",
        "add-person",
        "pick-self",
      ] as const) {
        const id = idFor(route);
        const last = REPETITIONS[route] - 1;
        expect(snoozePolicyOf({ id, snoozeCount: last }, NOW)).not.toBeNull();
        expect(snoozePolicyOf({ id, snoozeCount: last + 1 }, NOW)).toBeNull();
      }
    });

    it("still offers a snooze on the second encounter, for every step", () => {
      // The user-visible half of the floor above: after one "not now" the row
      // returns *and* can be put off again, so "don't ask again" — which appears
      // only from a count of 1 — is never the only remaining choice.
      for (const route of [
        "connect-sync",
        "add-person",
        "pick-self",
      ] as const) {
        expect(
          snoozePolicyOf({ id: idFor(route), snoozeCount: 1 }, NOW),
        ).not.toBeNull();
      }
    });

    it("offers nothing for a non-onboarding (milestone / user) reminder", () => {
      expect(
        snoozePolicyOf({ id: crypto.randomUUID(), snoozeCount: 0 }, NOW),
      ).toBeNull();
    });
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
