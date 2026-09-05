import { describe, expect, it } from "vitest";
import {
  type ReminderRule,
  actionDefs,
  kindDefs,
  reminderActionSchema,
  reminderRuleInputSchema,
  reminderRuleLabel,
  reminderRuleSchema,
  resolveReminderSchedule,
  SCHEDULABLE_ACTIONS,
  promptOffsetDays,
} from "./index.js";

/** Assemble a stored rule row from the parts a test cares about. */
function rule(over: Partial<ReminderRule>): ReminderRule {
  return reminderRuleSchema.parse({
    id: crypto.randomUUID(),
    bearerType: "milestone",
    bearerId: crypto.randomUUID(),
    action: "call",
    label: null,
    offsetDays: 0,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...over,
  });
}

describe("reminderActionSchema / actionDefs", () => {
  it("has a registry entry for every action", () => {
    for (const action of reminderActionSchema.options) {
      expect(actionDefs[action]).toBeDefined();
      expect(actionDefs[action].label.length).toBeGreaterThan(0);
    }
  });

  // `plan` is the engine's own question, synthesized per reconcile — never a
  // row a user schedules. Anything that lists actions for a picker must read
  // this and not the enum, so the editors can't quietly start offering "decide
  // how to mark it" as a thing to decide to do.
  it("excludes `plan` from the schedulable set, and nothing else", () => {
    expect(SCHEDULABLE_ACTIONS).not.toContain("plan");
    expect(SCHEDULABLE_ACTIONS.length).toBe(
      reminderActionSchema.options.length - 1,
    );
  });
});

describe("promptOffsetDays", () => {
  // The furthest reach of anything a birthday offers: `gift` at offset 12 with
  // its own 30-day run-up. Ticking the gift on the prompt has to leave that run
  // -up intact, so the question is due before the errand would have started.
  it("is the widest (offset + run-up) of the offered set", () => {
    expect(promptOffsetDays("birthday")).toBe(12 + actionDefs.gift.activeDays);
    expect(promptOffsetDays("anniversary")).toBe(
      7 + actionDefs.card.activeDays,
    );
  });

  // Every kind that asks the question has to have more than one answer to it,
  // and `death` must not ask at all.
  it("only prompts where there is a real choice to make", () => {
    expect(kindDefs.death.prompt).toBeUndefined();
    for (const [kind, def] of Object.entries(kindDefs)) {
      if (def.prompt === undefined) continue;
      expect(
        def.defaultReminderSchedule.length,
        `${kind} prompts with one answer`,
      ).toBeGreaterThan(1);
      expect(def.prompt.occasion.length).toBeGreaterThan(0);
    }
  });
});

describe("reminderRuleInputSchema", () => {
  it("accepts a normal action with no label", () => {
    const parsed = reminderRuleInputSchema.parse({
      action: "gift",
      offsetDays: 30,
      enabled: true,
    });
    expect(parsed.action).toBe("gift");
  });

  it("rejects a stored `plan` rule", () => {
    expect(() =>
      reminderRuleInputSchema.parse({
        action: "plan",
        offsetDays: 42,
        enabled: true,
      }),
    ).toThrow();
  });

  it("requires a non-empty label for the `other` action", () => {
    expect(() =>
      reminderRuleInputSchema.parse({
        action: "other",
        label: "   ",
        offsetDays: 0,
        enabled: true,
      }),
    ).toThrow();
    const ok = reminderRuleInputSchema.parse({
      action: "other",
      label: "Send flowers",
      offsetDays: 0,
      enabled: true,
    });
    expect(ok.label).toBe("Send flowers");
  });

  it("rejects a negative lead time", () => {
    expect(() =>
      reminderRuleInputSchema.parse({
        action: "call",
        offsetDays: -1,
        enabled: true,
      }),
    ).toThrow();
  });
});

describe("reminderRuleLabel", () => {
  it("uses the action's registry label for a typed action", () => {
    expect(reminderRuleLabel({ action: "gift", label: null })).toBe(
      actionDefs.gift.label,
    );
  });

  it("uses the free-text label for `other`, falling back when blank", () => {
    expect(reminderRuleLabel({ action: "other", label: "Send flowers" })).toBe(
      "Send flowers",
    );
    expect(reminderRuleLabel({ action: "other", label: null })).toBe(
      actionDefs.other.label,
    );
  });
});

describe("resolveReminderSchedule", () => {
  it("falls back to the kind defaults when there are no stored rules", () => {
    const { rules, source } = resolveReminderSchedule("birthday", []);
    // Furthest-out first: gift a dozen days out, card a week out, then the
    // day-of group. `offsetDays` is when a thing is *due*; how long it then
    // sits on the list is the action's own `activeDays`.
    expect(rules.map((r) => r.action)).toEqual([
      "gift",
      "card",
      "wish",
      "call",
      "text",
    ]);
    expect(rules.map((r) => r.offsetDays)).toEqual([12, 7, 0, 0, 0]);
    // "Wish them a happy birthday" is the only rule on by default; the staggered
    // gift/card/call/text are offered but start off.
    const enabled = rules.filter((r) => r.enabled).map((r) => r.action);
    expect(enabled).toEqual(["wish"]);
    // The condition the prompt is minted on — not a diagnostic.
    expect(source).toBe("kind-default");
  });

  it("offers a quiet death default — off by default, and never a text", () => {
    const { rules } = resolveReminderSchedule("death", []);
    expect(rules.map((r) => r.action)).toEqual(["remember"]);
    // Nothing but a birthday wish is on by default — the death "remember" is off.
    expect(rules.every((r) => !r.enabled)).toBe(true);
    expect(rules.some((r) => r.action === "text")).toBe(false);
    // The kind registry itself excludes it (the "disabled entirely" case).
    expect(
      kindDefs.death.defaultReminderSchedule.some((d) => d.action === "text"),
    ).toBe(false);
  });

  it("uses the stored rules verbatim when the milestone is customised", () => {
    const stored = [
      rule({ action: "gift", offsetDays: 14, enabled: false }),
      rule({
        action: "other",
        label: "Bake a cake",
        offsetDays: 0,
        enabled: true,
      }),
    ];
    const { rules, source } = resolveReminderSchedule("birthday", stored);
    // Stored set wins over the kind defaults, furthest-out first.
    expect(rules.map((r) => r.action)).toEqual(["gift", "other"]);
    expect(rules[0]).toMatchObject({ offsetDays: 14, enabled: false });
    expect(rules[1]).toMatchObject({ label: "Bake a cake", offsetDays: 0 });
    // Rows existing is the "answered" marker the prompt reads.
    expect(source).toBe("stored");
  });

  // An all-disabled set is an *answer* — "ask me about nothing" — and has to be
  // distinguishable from never having been asked, or the prompt returns every
  // year. Rows existing is what carries that, so a set with nothing enabled
  // still reads as `stored`.
  it("treats an all-disabled stored set as answered", () => {
    const stored = [
      rule({ action: "wish", offsetDays: 0, enabled: false }),
      rule({ action: "gift", offsetDays: 12, enabled: false }),
    ];
    expect(resolveReminderSchedule("birthday", stored).source).toBe("stored");
  });

  // Nothing writes one — the input schema rejects it — so this only fires on a
  // corrupt row. The failure it prevents reads as the app forgetting: a
  // milestone that *has* been configured being asked how to configure it.
  it("drops a stored `plan` rule and falls back to the kind defaults", () => {
    const stored = [rule({ action: "plan", offsetDays: 42, enabled: true })];
    const { rules, source } = resolveReminderSchedule("birthday", stored);
    expect(source).toBe("kind-default");
    expect(rules.some((r) => r.action === "plan")).toBe(false);
  });
});
