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
  type ReminderEngineDeps,
  onboardingRouteOf,
  regenerateSystemReminders,
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

/** Milliseconds in a day. */
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
    /** Put a row off until tomorrow, as "Remind me tomorrow" does — the engine
     *  only ever *reads* the field this sets. */
    snooze: (id: string) => {
      const row = rows.get(id);
      if (row === undefined) throw new Error(`no such reminder: ${id}`);
      rows.set(id, { ...row, snoozedUntil: Date.now() + DAY_MS });
    },
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

  it("seeds the day-one nudges for a fresh store — dateless, system-sourced, exact copy", async () => {
    const result = await regenerateSystemReminders(h.deps);
    // A fresh store has nobody in it, so only the notifications step (which waits
    // for something to be notified about) stays away. The four answerable on day
    // one do not: sign in, protect this device, import, and say who you are. The
    // account invitation is among them deliberately — asking after the import
    // would mean the import had already landed in a plaintext store.
    expect(result).toEqual({ created: 4, updated: 0, removed: 0 });

    const rows = h.activeSystem();
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.source).toBe("system");
      expect(r.dueDate).toBeNull(); // onboarding nudges carry no due date
      expect(r.completedAt).toBeNull();
      expect(r.body).toBeNull();
    }

    // Ids are exactly the exported convention, so client CTA lookup lines up.
    expect(new Set(rows.map((r) => r.id))).toEqual(
      new Set([
        idFor("connect-sync"),
        idFor("create-account"),
        idFor("import"),
        idFor("about-you"),
      ]),
    );
    expect(h.byId(idFor("import"))?.title).toBe("📇 Import your contacts");
    expect(h.byId(idFor("connect-sync"))?.title).toBe(
      "🔄 Already have Leapsake on another device? Sign in.",
    );
    expect(h.byId(idFor("about-you"))?.title).toBe("🙋 Tell us about yourself");
  });

  it("orders the day-one nudges: sign in, protect, import, then who you are", async () => {
    await regenerateSystemReminders(h.deps);

    // Home sorts open reminders with compareReminderDue; all four are dateless, so
    // the createdAt back-off is what holds them in array order. Protecting the
    // device sits above importing into it on purpose: taken in that order the
    // import lands in an encrypted store rather than a plaintext one.
    const ordered = h.activeSystem().sort(compareReminderDue);
    expect(ordered.map((r) => r.id)).toEqual([
      idFor("connect-sync"),
      idFor("create-account"),
      idFor("import"),
      idFor("about-you"),
    ]);
  });

  it("is idempotent: a second run adds/changes nothing", async () => {
    await regenerateSystemReminders(h.deps);
    const second = await regenerateSystemReminders(h.deps);
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(4);
  });

  it("retires 'import your contacts' once an entity exists, keeping the sign-in nudge", async () => {
    await regenerateSystemReminders(h.deps);

    h.signals.hasEntitiesBesidesSelf = true; // user added their first person/pet
    h.signals.hasSelf = true; // ...and said who they are (retiring that one too)
    h.signals.hasNotificationPolicy = true; // ...and answered notifications (isolating this)
    const result = await regenerateSystemReminders(h.deps);
    // Nothing is created: the account invitation has stood since day one, so
    // arriving at data does not summon it — it is already there, unanswered.
    expect(result).toEqual({ created: 0, updated: 0, removed: 2 });

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
    // The account invitation stands: a bound relay is not an account, and this
    // store still holds none.
    expect(new Set(live.map((r) => r.id))).toEqual(
      new Set([idFor("create-account"), idFor("import"), idFor("about-you")]),
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
    expect(result).toEqual({ created: 0, updated: 0, removed: 4 });
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
      new Set([
        idFor("connect-sync"),
        idFor("create-account"),
        idFor("about-you"),
      ]),
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
    it("stands from day one, before there is anything to protect", async () => {
      // The reversal *(owner, 2026-09-13)*. It used to wait for
      // `hasEntitiesBesidesSelf`, which paired with the import step's
      // `!hasEntitiesBesidesSelf` to guarantee the address book was written in the
      // clear *before* anyone was asked to encrypt it. Asking first is the whole
      // point: it puts the import inside an encrypted store.
      await regenerateSystemReminders(h.deps);

      const invitation = h.byId(idFor("create-account"));
      expect(invitation?.deletedAt).toBeNull();
      expect(invitation?.title).toBe(
        "🔐 Set up your login to protect the data on this device",
      );
      // Dateless like every nudge — it is a standing offer, not a deadline.
      expect(invitation?.dueDate).toBeNull();
    });

    it("is offered before the import, not after it", async () => {
      // The property the reversal exists for, as a test: on the very first
      // reconcile of an empty store both invitations are on Home together, and
      // the account one is above it (see the ordering test). Nothing has to
      // happen first for it to be askable.
      const result = await regenerateSystemReminders(h.deps);
      expect(result.created).toBeGreaterThan(0);
      const ids = h.activeSystem().map((r) => r.id);
      expect(ids).toContain(idFor("create-account"));
      expect(ids).toContain(idFor("import"));
    });

    it("neither summons nor retires when data later arrives", async () => {
      await regenerateSystemReminders(h.deps);
      h.signals.hasEntitiesBesidesSelf = true; // the user's first person/pet lands
      await regenerateSystemReminders(h.deps);

      expect(h.byId(idFor("create-account"))?.deletedAt).toBeNull();
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

    it("stays gone once dismissed, though the data is still unprotected", async () => {
      // "Don't ask again" is permanent by the same tombstone every nudge uses —
      // offered from the first sighting now, and meaning exactly what it says.
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

  describe("snoozing a step", () => {
    it("keeps a snoozed step desired, and never prunes it", async () => {
      // Isolate about-you: an account exists, a person exists, notifications
      // have been answered.
      h.signals.hasEntitiesBesidesSelf = true;
      h.signals.syncConnected = true;
      h.signals.hasAccount = true;
      h.signals.hasNotificationPolicy = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("about-you");
      expect(h.activeSystem().map((r) => r.id)).toEqual([id]);

      h.snooze(id);

      // The trap this guards: a deferral that stopped desiring the row would
      // tombstone it here, and a tombstone is never resurrected — so "remind me
      // tomorrow" would silently have meant "never".
      const result = await regenerateSystemReminders(h.deps);
      expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
      expect(h.byId(id)?.deletedAt).toBeNull();
      expect(h.activeSystem().map((r) => r.id)).toEqual([id]);
    });

    // *(owner, 2026-09-11)*: only its condition, or the user's own "don't ask
    // again", retires a step. There is no budget of put-offs to run out.
    it("never retires a step for being put off, however often", async () => {
      h.signals.hasEntitiesBesidesSelf = true;
      h.signals.hasSelf = true;
      await regenerateSystemReminders(h.deps);
      const id = idFor("create-account");

      for (let i = 0; i < 10; i++) {
        h.snooze(id);
        expect(await regenerateSystemReminders(h.deps)).toEqual({
          created: 0,
          updated: 0,
          removed: 0,
        });
      }
      expect(h.byId(id)?.deletedAt).toBeNull();
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
      // for — so it must leave it exactly as it found it.
      expect(result.updated).toBe(0);
      expect(h.byId(id)?.snoozedUntil).toBe(snoozed?.snoozedUntil);
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
    // Four onboarding nudges + the birthday's day-of wish, none pruning the
    // others. No `plan` prompt: on the day itself the wish is all that is left
    // to choose, and a question with one answer is not asked.
    expect(result).toEqual({ created: 5, updated: 0, removed: 0 });
    expect(h.activeSystem()).toHaveLength(5);
  });
});
