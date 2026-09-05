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
    const resolved = resolveReminderSchedule("birthday", []);
    // Furthest-out first: gift a dozen days out, card a week out, then the
    // day-of group. `offsetDays` is when a thing is *due*; how long it then
    // sits on the list is the action's own `activeDays`.
    expect(resolved.map((r) => r.action)).toEqual([
      "gift",
      "card",
      "wish",
      "call",
      "text",
    ]);
    expect(resolved.map((r) => r.offsetDays)).toEqual([12, 7, 0, 0, 0]);
    // "Wish them a happy birthday" is the only rule on by default; the staggered
    // gift/card/call/text are offered but start off.
    const enabled = resolved.filter((r) => r.enabled).map((r) => r.action);
    expect(enabled).toEqual(["wish"]);
  });

  it("offers a quiet death default — off by default, and never a text", () => {
    const resolved = resolveReminderSchedule("death", []);
    expect(resolved.map((r) => r.action)).toEqual(["remember"]);
    // Nothing but a birthday wish is on by default — the death "remember" is off.
    expect(resolved.every((r) => !r.enabled)).toBe(true);
    expect(resolved.some((r) => r.action === "text")).toBe(false);
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
    const resolved = resolveReminderSchedule("birthday", stored);
    // Stored set wins over the kind defaults, furthest-out first.
    expect(resolved.map((r) => r.action)).toEqual(["gift", "other"]);
    expect(resolved[0]).toMatchObject({ offsetDays: 14, enabled: false });
    expect(resolved[1]).toMatchObject({ label: "Bake a cake", offsetDays: 0 });
  });
});
