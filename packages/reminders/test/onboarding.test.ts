import {
  type CivilDate,
  type RemindEligibleMilestone,
  type Reminder,
  compareReminderDue,
  resolveReminderSchedule,
} from "@leapsake/schema";
import {
  resetFlagOverrides,
  setLocalFlagOverrides,
  withFlags,
} from "@leapsake/flags";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ONBOARDING_REMINDERS,
  type OnboardingRoute,
  type ReminderEngineDeps,
  onboardingRouteOf,
  regenerateSystemReminders,
  snoozePolicyOf,
} from "../src/index.js";

/**
 * These tests describe the world where multi-device sync exists, so they turn it
 * on: the sign-in nudge is gated behind `multiDevice`, which is off in what v0.1
 * ships. What the shipping default does instead is the last describe below.
 */
beforeEach(() => setLocalFlagOverrides({ multiDevice: true }));
afterEach(resetFlagOverrides);

/** A fixed local "today" (no milestones under test, so the value is immaterial). */
const TODAY: CivilDate = { year: 2026, month: 6, day: 1 };

/** Milliseconds in a day — the unit the steps' snooze durations are expressed in. */
const DAY_MS = 86_400_000;

/**
 * The engine harness for the onboarding family: an in-memory store plus a fakeable
 * `onboarding` port driven by mutable signals. No milestones here — the
 * onboarding nudges are the whole subject — so the milestone ports are inert.
 *
 * `syncConnected` and `hasAccount` are separate switches on purpose: a local-only
 * account is the state where they disagree, and it is the state both custody
 * nudges turn on.
 */
function makeHarness() {
  const rows = new Map<string, Reminder>();
  const signals = {
    hasEntitiesBesidesSelf: false,
    syncConnected: false,
    hasSelf: false,
    hasAccount: false,
    hasNotificationPolicy: false,
  };

  const deps: ReminderEngineDeps = {
    milestones: { listRemindEligible: async () => [] },
    resolveSchedule: async () => ({
      rules: [],
      source: "stored" as const,
      writtenAt: null,
    }),
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
      hasAnyEntityBesidesSelf: async () => signals.hasEntitiesBesidesSelf,
      isSyncConnected: async () => signals.syncConnected,
      hasSelf: async () => signals.hasSelf,
      hasAccount: async () => signals.hasAccount,
      hasNotificationPolicy: async () => signals.hasNotificationPolicy,
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
 *  re-tuning them — which is meant to be cheap — is a one-line edit here too.
 *
 *  ⚠️ **The durations are all different, and that is the point.** Shared values
 *  put every put-off row back on Home on the same morning; see
 *  `OnboardingStep.snoozeDurationDays`. Asserting them route by route is what
 *  keeps a future edit from quietly collapsing two back together. */
const SNOOZE_DAYS: Record<OnboardingRoute, number> = {
  "connect-sync": 7,
  "create-account": 4,
  import: 5,
  "about-you": 6,
  "enable-notifications": 3,
};
const REPETITIONS: Record<OnboardingRoute, number> = {
  "connect-sync": 2,
  "create-account": 3,
  import: 2,
  "about-you": 2,
  "enable-notifications": 2,
};

/** Every route there is, read off the exported convention rather than listed —
 *  so a step added to the engine joins the sweeps below automatically, and the
 *  total `REPETITIONS` above stops compiling until its dial is mirrored here. */
const ROUTES = ONBOARDING_REMINDERS.map((r) => r.route);

describe("onboarding reminders", () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it("seeds the day-one nudges for a fresh store — dateless, system-sourced, exact copy", async () => {
    const result = await regenerateSystemReminders(h.deps);
    // A fresh store has nobody in it, so the account invitation (which waits for
    // data worth protecting) and the notifications step (which waits for
    // something to be notified about) both stay away. The three that are
    // answerable on day one do not: sign in, import, and say who you are.
    expect(result).toEqual({ created: 3, updated: 0, removed: 0 });

    const rows = h.activeSystem();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.source).toBe("system");
      expect(r.dueDate).toBeNull(); // onboarding nudges carry no due date
      expect(r.completedAt).toBeNull();
      expect(r.body).toBeNull();
    }

    // Ids are exactly the exported convention, so client CTA lookup lines up.
    expect(new Set(rows.map((r) => r.id))).toEqual(
      new Set([idFor("connect-sync"), idFor("import"), idFor("about-you")]),
    );
    expect(h.byId(idFor("import"))?.title).toBe(
      "📇 Import your contacts to get started",
    );
    expect(h.byId(idFor("connect-sync"))?.title).toBe(
      "🔄 Already have Leapsake on another device? Sign in.",
    );
    expect(h.byId(idFor("about-you"))?.title).toBe("🙋 Tell us about yourself");
  });

  it("orders the day-one nudges: sign in, then import, then who you are", async () => {
    await regenerateSystemReminders(h.deps);

    // Home sorts open reminders with compareReminderDue; all three are dateless,
    // so the createdAt back-off is what holds them in array order. Import leads
    // the two that are answerable from an empty store because it is the one that
    // fills the app; saying who you are is worth less on its own.
    const ordered = h.activeSystem().sort(compareReminderDue);
    expect(ordered.map((r) => r.id)).toEqual([
      idFor("connect-sync"),
      idFor("import"),
      idFor("about-you"),
    ]);
  });

  it("is idempotent: a second run adds/changes nothing", async () => {
    await regenerateSystemReminders(h.deps);
    const second = await regenerateSystemReminders(h.deps);
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(3);
  });

  it("retires 'import your contacts' once an entity exists, keeping the sign-in nudge", async () => {
    await regenerateSystemReminders(h.deps);

    h.signals.hasEntitiesBesidesSelf = true; // user added their first person/pet
    h.signals.hasSelf = true; // ...and said who they are (retiring that one too)
    h.signals.hasNotificationPolicy = true; // ...and answered notifications (isolating this)
    const result = await regenerateSystemReminders(h.deps);
    // The same data that retires "import your contacts" is what there is now to
    // protect, so the account invitation arrives in the very same reconcile.
    expect(result).toEqual({ created: 1, updated: 0, removed: 2 });

    const live = h.activeSystem();
    expect(new Set(live.map((r) => r.id))).toEqual(
      new Set([idFor("connect-sync"), idFor("create-account")]),
    );
  });

  it("retires the sign-in nudge once sync is connected", async () => {
    await regenerateSystemReminders(h.deps);

    h.signals.syncConnected = true; // relay bound
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 1 });

    const live = h.activeSystem();
    expect(new Set(live.map((r) => r.id))).toEqual(
      new Set([idFor("import"), idFor("about-you")]),
    );
  });

  it("retires both once each condition is met", async () => {
    await regenerateSystemReminders(h.deps);
    h.signals.hasEntitiesBesidesSelf = true;
    h.signals.syncConnected = true;
    h.signals.hasSelf = true;
    h.signals.hasAccount = true;
    h.signals.hasNotificationPolicy = true; // every condition met

    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 3 });
    expect(h.activeSystem()).toHaveLength(0);
  });

  it("never resurrects a dismissed nudge, even while its condition still holds", async () => {
    await regenerateSystemReminders(h.deps);
    const id = idFor("import");

    await h.deps.reminders.softDelete(id); // user dismissed it

    // Condition (no entities) is still true, but the tombstone stays dead.
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.byId(id)?.deletedAt).not.toBeNull();
    expect(new Set(h.activeSystem().map((r) => r.id))).toEqual(
      new Set([idFor("connect-sync"), idFor("about-you")]),
    );
  });

  it("does not re-nag a retired nudge if its condition later reverts", async () => {
    // An account already exists, so neither custody nudge is in play and
    // 'import' is the only step this walks through its whole life.
    h.signals.hasAccount = true;
    await regenerateSystemReminders(h.deps);
    h.signals.hasEntitiesBesidesSelf = true;
    h.signals.hasSelf = true; // isolate: retire the who-are-you nudge too
    h.signals.hasNotificationPolicy = true; // ...and never raise the notifications one
    await regenerateSystemReminders(h.deps); // 'import' retired (tombstoned)

    // The user deletes all their people again — the condition reverts, but the
    // retired nudge must stay gone (the intentional "don't re-nag" semantic).
    h.signals.hasEntitiesBesidesSelf = false;
    const result = await regenerateSystemReminders(h.deps);
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.byId(idFor("import"))?.deletedAt).not.toBeNull();
  });

  it("asks who you are on an empty store, waiting for no one else", async () => {
    // The whole point of the reframe: it used to read `hasEntities && !hasSelf`,
    // which made it a question the app could only ask once the user had already
    // done something else — and stacked it onto the moment they did. Its screen
    // takes the answer as a form, so nothing has to exist first.
    await regenerateSystemReminders(h.deps);
    const aboutYou = h.byId(idFor("about-you"));
    expect(aboutYou?.title).toBe("🙋 Tell us about yourself");
    expect(aboutYou?.dueDate).toBeNull();
    expect(h.activeSystem().map((r) => r.id)).toContain(idFor("about-you"));
  });

  it("keeps asking who you are while people arrive and self stays unset", async () => {
    await regenerateSystemReminders(h.deps);
    // Somebody else landing is not an answer to this question.
    h.signals.hasEntitiesBesidesSelf = true;
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem().map((r) => r.id)).toContain(idFor("about-you"));
  });

  it("retires the who-are-you nudge once the self-person is set", async () => {
    await regenerateSystemReminders(h.deps);
    expect(h.activeSystem().map((r) => r.id)).toContain(idFor("about-you"));

    h.signals.hasSelf = true; // user picked themselves
    const result = await regenerateSystemReminders(h.deps);
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(h.activeSystem().map((r) => r.id)).not.toContain(idFor("about-you"));
  });

  describe("the notifications nudge", () => {
    it("stays away until there is something to be notified about", async () => {
      // An empty store has no reminders to deliver, so asking for permission to
      // deliver them would be asking for its own sake — the rule every
      // collection nudge has to clear (README → *the rule that stops this eating
      // the home screen*).
      await regenerateSystemReminders(h.deps);
      expect(h.activeSystem().map((r) => r.id)).not.toContain(
        idFor("enable-notifications"),
      );

      h.signals.hasEntitiesBesidesSelf = true; // the user's first person/pet lands
      await regenerateSystemReminders(h.deps);
      const nudge = h.byId(idFor("enable-notifications"));
      expect(nudge?.title).toBe(
        "🔔 Turn on notifications so reminders reach you",
      );
      expect(nudge?.dueDate).toBeNull();
    });

    it("retires once notifications have been answered, on or off", async () => {
      h.signals.hasEntitiesBesidesSelf = true;
      await regenerateSystemReminders(h.deps);
      expect(h.activeSystem().map((r) => r.id)).toContain(
        idFor("enable-notifications"),
      );

      // The signal is "a policy exists", not "notifications are on" — a device
      // that was asked and left them off has answered the question, and asking
      // again would be arguing with it.
      h.signals.hasNotificationPolicy = true;
      const result = await regenerateSystemReminders(h.deps);
      expect(result.removed).toBeGreaterThanOrEqual(1);
      expect(h.activeSystem().map((r) => r.id)).not.toContain(
        idFor("enable-notifications"),
      );
    });
  });

  describe("the account invitation", () => {
    it("stays away until there is data worth protecting", async () => {
      // A brand-new profile sees no custody invitation at all: an Unauthenticated
      // store is plaintext with nothing in it, so there is nothing an account
      // would protect access to yet.
      await regenerateSystemReminders(h.deps);
      expect(h.activeSystem().map((r) => r.id)).not.toContain(
        idFor("create-account"),
      );

      h.signals.hasEntitiesBesidesSelf = true; // the user's first person/pet lands
      await regenerateSystemReminders(h.deps);

      const invitation = h.byId(idFor("create-account"));
      expect(invitation?.deletedAt).toBeNull();
      expect(invitation?.title).toBe(
        "🔐 Set up your login to protect the data on this device",
      );
      // Dateless like every nudge — it is a standing offer, not a deadline.
      expect(invitation?.dueDate).toBeNull();
    });

    it("arrives on the first reconcile after an import, with no elapsed-time floor", async () => {
      // The deliberate consequence of gating on data rather than on days: a user
      // who imports their whole address book on day one is at the moment the
      // account matters most, and that is exactly when they are asked.
      h.signals.hasEntitiesBesidesSelf = true;
      const result = await regenerateSystemReminders(h.deps);
      expect(result.created).toBeGreaterThan(0);
      expect(h.activeSystem().map((r) => r.id)).toContain(
        idFor("create-account"),
      );
    });

    it("sits directly below the sign-in nudge, above everything else", async () => {
      // The fork is only a fork if the two rows are read together: sign in to the
      // account you have, or create the one you don't.
      h.signals.hasEntitiesBesidesSelf = true;
      await regenerateSystemReminders(h.deps);

      const ordered = h.activeSystem().sort(compareReminderDue);
      expect(ordered.map((r) => r.id)).toEqual([
        idFor("connect-sync"),
        idFor("create-account"),
        idFor("about-you"),
        // Last, and the only step whose delay costs nothing: a reminder that
        // comes due with notifications off is still on Home when the app opens.
        idFor("enable-notifications"),
      ]);
    });

    it("retires the moment an account exists, relay or no relay", async () => {
      h.signals.hasEntitiesBesidesSelf = true;
      await regenerateSystemReminders(h.deps);
      expect(h.activeSystem().map((r) => r.id)).toContain(
        idFor("create-account"),
      );

      // A **local-only** account: created here, never published to a relay. It is
      // still an account, so the invitation has been taken.
      h.signals.hasAccount = true;
      await regenerateSystemReminders(h.deps);

      expect(h.signals.syncConnected).toBe(false);
      expect(h.byId(idFor("create-account"))?.deletedAt).not.toBeNull();
    });

    it("retires the sign-in nudge too, for a local-only account", async () => {
      // The collision this increment had to resolve. Both nudges deep-link to the
      // same screen, and the sign-in step used to retire on `relayUrl` alone — so
      // a user who created a local-only account was left being nudged toward a
      // flow that could no longer satisfy it.
      await regenerateSystemReminders(h.deps);
      expect(h.activeSystem().map((r) => r.id)).toContain(
        idFor("connect-sync"),
      );

      h.signals.hasAccount = true;
      await regenerateSystemReminders(h.deps);

      expect(h.signals.syncConnected).toBe(false); // no relay was ever bound
      expect(h.byId(idFor("connect-sync"))?.deletedAt).not.toBeNull();
    });

    it("takes one more 'not now' than any other step before it gives up", async () => {
      // The step that must never be wrongly silenced, so it is the one that buys
      // an extra repetition — proven through the engine, not off the literal.
      h.signals.hasEntitiesBesidesSelf = true;
      h.signals.hasSelf = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("create-account");

      // Two "not now"s would have exhausted any other step; this one comes back.
      h.snooze(id, 2);
      expect(await regenerateSystemReminders(h.deps)).toEqual({
        created: 0,
        updated: 0,
        removed: 0,
      });
      expect(h.byId(id)?.deletedAt).toBeNull();

      h.snooze(id); // the third spends the budget
      await regenerateSystemReminders(h.deps);
      expect(h.byId(id)?.deletedAt).not.toBeNull();
    });

    it("stays gone once dismissed, though the data is still unprotected", async () => {
      // "Don't ask again" is permanent by the same tombstone every nudge uses —
      // the honest reading of a choice the user only gets offered on a second
      // sighting.
      h.signals.hasEntitiesBesidesSelf = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("create-account");

      await h.deps.reminders.softDelete(id);

      const result = await regenerateSystemReminders(h.deps);
      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(h.byId(id)?.deletedAt).not.toBeNull();
    });
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
      // Isolate pick-self (2 repetitions): an account exists, a person exists,
      // notifications have been answered.
      h.signals.hasEntitiesBesidesSelf = true;
      h.signals.syncConnected = true;
      h.signals.hasAccount = true;
      h.signals.hasNotificationPolicy = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("about-you");
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
      h.signals.hasEntitiesBesidesSelf = true;
      h.signals.syncConnected = true;
      h.signals.hasAccount = true;
      h.signals.hasNotificationPolicy = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("about-you");

      h.snooze(id, REPETITIONS["about-you"]); // one past the boundary above

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
      for (const route of ROUTES) {
        expect(REPETITIONS[route]).toBeGreaterThanOrEqual(2);
      }

      // Proven through the engine for one of them, not just asserted on a literal.
      h.signals.hasEntitiesBesidesSelf = true;
      h.signals.hasSelf = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("connect-sync");
      expect(h.activeSystem().map((r) => r.id)).toContain(id);

      h.snooze(id);

      const result = await regenerateSystemReminders(h.deps);
      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(h.byId(id)?.deletedAt).toBeNull();
    });

    it("leaves an exhausted step gone, though its condition still holds", async () => {
      h.signals.hasEntitiesBesidesSelf = true;
      h.signals.hasSelf = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("connect-sync");
      h.snooze(id, REPETITIONS["connect-sync"]);
      await regenerateSystemReminders(h.deps); // retired

      // Sync is still not connected, so the step still applies — and stays dead.
      const result = await regenerateSystemReminders(h.deps);
      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(h.byId(id)?.deletedAt).not.toBeNull();
      expect(h.activeSystem().map((r) => r.id)).not.toContain(id);
    });

    it("never clears or resets a snooze on reconcile", async () => {
      h.signals.hasEntitiesBesidesSelf = true;
      h.signals.syncConnected = true;
      h.signals.hasAccount = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("about-you");
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

    it("offers a snooze running to the step's own duration from now", () => {
      expect(
        snoozePolicyOf({ id: idFor("about-you"), snoozeCount: 0 }, NOW),
      ).toEqual({ until: NOW + SNOOZE_DAYS["about-you"] * DAY_MS });
    });

    it("gives every step a different one, so put-off rows don't return together", () => {
      const untils = ROUTES.map(
        (route) =>
          snoozePolicyOf({ id: idFor(route), snoozeCount: 0 }, NOW)?.until,
      );
      // Each step reads its own dial...
      expect(untils).toEqual(
        ROUTES.map((route) => NOW + SNOOZE_DAYS[route] * DAY_MS),
      );
      // ...and no two of them land on the same day, which is the property that
      // stops Home refilling in one go with what the user just cleared.
      expect(new Set(untils).size).toBe(ROUTES.length);
    });

    it("stops offering once the step's repetitions are spent", () => {
      const id = idFor("about-you");
      expect(
        snoozePolicyOf({ id, snoozeCount: REPETITIONS["about-you"] - 1 }, NOW),
      ).not.toBeNull();
      expect(
        snoozePolicyOf({ id, snoozeCount: REPETITIONS["about-you"] }, NOW),
      ).toBeNull();
    });

    it("reads each step's own budget, whatever it is set to", () => {
      // The dials are per-step by construction, and the account invitation is the
      // one that spends that: it takes an extra "not now" the rest don't. This
      // asserts the lookup, against each step's own number.
      expect(REPETITIONS["create-account"]).toBeGreaterThan(
        Math.max(
          ...ROUTES.filter((r) => r !== "create-account").map(
            (r) => REPETITIONS[r],
          ),
        ),
      );
      for (const route of ROUTES) {
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
      for (const route of ROUTES) {
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
    createdAt: 0,
  };
}

/**
 * The shipping default — every other test in this file has turned `multiDevice`
 * on, so this is the only place that sees what a v0.1 user gets.
 */
describe("with multi-device held back", () => {
  beforeEach(resetFlagOverrides);

  it("seeds no sign-in nudge, leaving the rest of onboarding intact", async () => {
    const h = makeHarness();
    await regenerateSystemReminders(h.deps);

    const routes = h.activeSystem().map((r) => onboardingRouteOf(r.id));
    expect(routes).not.toContain("connect-sync");
    expect(routes).toContain("import");
  });

  it("still invites an account, which is the encryption story rather than sync", async () => {
    const h = makeHarness();
    h.signals.hasEntitiesBesidesSelf = true;
    await regenerateSystemReminders(h.deps);

    const routes = h.activeSystem().map((r) => onboardingRouteOf(r.id));
    expect(routes).toContain("create-account");
  });

  it("retires a sign-in nudge left behind by a build that had it", async () => {
    const h = makeHarness();
    // Seeded while the flag was on — the state a developer toggling the switch
    // lands in, and the one a v0.1 user must never see a stale row from.
    await withFlags({ multiDevice: true }, () =>
      regenerateSystemReminders(h.deps),
    );
    const signIn = ONBOARDING_REMINDERS.find(
      (r) => r.route === "connect-sync",
    )!.id;
    expect(h.byId(signIn)?.deletedAt).toBeNull();

    await regenerateSystemReminders(h.deps);
    expect(h.byId(signIn)?.deletedAt).not.toBeNull();
  });
});

describe("onboarding + milestone families coexist", () => {
  it("keeps a birthday reminder and the onboarding nudges in one reconcile", async () => {
    const h = makeHarness();
    // Add a birthday falling today alongside the fresh-store onboarding nudges
    // — the day a default schedule's day-of wish is actually on display.
    const occ: CivilDate = TODAY;
    h.deps.milestones.listRemindEligible = async () => [
      birthday("m1", "p1", occ),
    ];
    h.deps.resolveSchedule = async (m) => resolveReminderSchedule(m.kind, []);
    h.deps.resolveLabel = async () => "Violet";

    const result = await regenerateSystemReminders(h.deps);
    // Three onboarding nudges + the birthday's day-of wish, none pruning the
    // others. No `plan` prompt: on the day itself the wish is all that is left
    // to choose, and a question with one answer is not asked.
    expect(result).toEqual({ created: 4, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(4);
  });
});
