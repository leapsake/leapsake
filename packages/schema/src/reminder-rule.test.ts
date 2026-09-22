import { describe, expect, it } from "vitest";
import {
  type ReminderRule,
  type ReminderRuleInput,
  actionDefOf,
  actionDefs,
  actionKeyOf,
  formatAction,
  isReminderAction,
  kindDefs,
  KNOWN_ACTIONS,
  parseAction,
  reminderRuleInputSchema,
  reminderRuleLabel,
  reminderRuleSchema,
  reminderScheduleInputSchema,
  resolveReminderSchedule,
  SCHEDULABLE_ACTIONS,
  nextSchedulableRule,
  promptOffsetDays,
  leadTimeLabel,
  offerLabel,
  promptGroupsOf,
  setPromptItem,
  setPromptDelivery,
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
  it("has a usable registry entry for every registered action", () => {
    for (const action of KNOWN_ACTIONS) {
      expect(actionDefOf(action).label.length).toBeGreaterThan(0);
    }
  });

  // Two exclusions, for two unrelated reasons, and an explicit list rather than
  // an arithmetic check on the registry's length — the count said "everything
  // but `plan`", which stopped being the rule the day a channel stopped being an
  // errand, and a length assertion would have gone on passing while offering the
  // wrong set.
  //
  // `plan` is the engine's own question, synthesized per reconcile — never a row
  // a user schedules. `call` and `message:sms` are the channel actions: how you
  // reach someone is a button on the acknowledgment, not an errand scheduled
  // weeks ahead. Anything that lists actions for a picker must read this and not
  // the registry.
  it("offers neither `plan` nor a channel", () => {
    expect(SCHEDULABLE_ACTIONS).toEqual([
      "wish",
      "get:gift",
      "get:card",
      "send:card",
      "send:gift",
      "visit",
      "remember",
      "other",
    ]);
    // ⚠️ The unoffered ones keep their registry entries on purpose: a rule stored
    // under one before this narrowed still has to render its real copy.
    for (const action of ["plan", "call", "message:sms"] as const) {
      expect(KNOWN_ACTIONS).toContain(action);
      expect(SCHEDULABLE_ACTIONS).not.toContain(action);
    }
  });

  // Pressing Add twice used to append the same action twice, which
  // `reminderScheduleInputSchema` then rejected as a duplicate — the collapse
  // whole-set validation exists to catch, reachable from a button.
  it("seeds a new rule with an action the schedule does not already hold", () => {
    expect(nextSchedulableRule([]).action).toBe("wish");
    expect(nextSchedulableRule([{ action: "wish" }]).action).toBe("get:gift");
    // Every offered action taken: `other` is the escape hatch, and the one
    // action a schedule may hold more than one of, since its identity is its
    // label.
    expect(
      nextSchedulableRule(SCHEDULABLE_ACTIONS.map((action) => ({ action })))
        .action,
    ).toBe("other");
  });

  // The whole point of the split: one verb, two errands, two identities. Before
  // it, `get:gift` and `get:card` would have been one `get` action and the
  // engine's id-keyed desired set would have silently collapsed them.
  it("keeps a verb's qualifiers apart, with their own numbers", () => {
    expect(parseAction("get:gift")).toEqual({ verb: "get", qualifier: "gift" });
    expect(parseAction("wish")).toEqual({ verb: "wish", qualifier: null });
    expect(formatAction("get", "card")).toBe("get:card");
    expect(formatAction("wish", null)).toBe("wish");
    // Buying a card is a shop trip like buying a gift; *posting* it is the
    // errand with the shorter fuse.
    expect(actionDefOf("get:card").activeDays).toBe(
      actionDefOf("get:gift").activeDays,
    );
    expect(actionDefOf("send:card").activeDays).toBeLessThan(
      actionDefOf("get:card").activeDays,
    );
  });

  it("validates the shape of an action, not membership of a qualifier list", () => {
    expect(isReminderAction("wish")).toBe(true);
    expect(isReminderAction("message:discord")).toBe(true);
    // A qualifier wearing a verb's clothes — the pre-split name.
    expect(isReminderAction("gift")).toBe(false);
    expect(isReminderAction("get:")).toBe(false);
    expect(isReminderAction("get:a:b")).toBe(false);
    expect(isReminderAction("get:Gift")).toBe(false);
    // `plan` is a question about the occasion, never an action toward a person.
    expect(isReminderAction("plan:birthday")).toBe(false);
  });

  // The stored-row schema parses on **every** read, so this is what migration 35
  // had to rewrite rows for rather than leave them: a leftover pre-split action
  // does not degrade, it fails the read of that rule outright. Worth asserting
  // because `z.custom` is the one Zod combinator that could plausibly wave an
  // absent value through.
  it("fails a stored row whose action is pre-split, absent or null", () => {
    const row = {
      id: crypto.randomUUID(),
      bearerType: "milestone",
      bearerId: crypto.randomUUID(),
      label: null,
      offsetDays: 0,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    expect(reminderRuleSchema.safeParse(row).success).toBe(false);
    expect(reminderRuleSchema.safeParse({ ...row, action: null }).success).toBe(
      false,
    );
    expect(
      reminderRuleSchema.safeParse({ ...row, action: "gift" }).success,
    ).toBe(false);
    expect(
      reminderRuleSchema.safeParse({ ...row, action: "get:gift" }).success,
    ).toBe(true);
  });

  // A row from a later version has to render, not throw: the throw would land
  // inside the engine's reconcile transaction and cost the user their whole
  // list. Dull copy and a zero window are the safe answer.
  it("answers for an action it has never heard of", () => {
    const def = actionDefOf("post:instagram");
    expect(def.activeDays).toBe(0);
    expect(def.label.length).toBeGreaterThan(0);
    expect(
      def.template({
        subject: "@Violet",
        greeting: "hi",
        occasion: "birthday",
      }),
    ).toContain("@Violet");
  });
});

describe("promptOffsetDays", () => {
  // The furthest reach of anything a birthday offers: `get:gift` at offset 12
  // with its own 30-day run-up. Ticking the gift on the prompt has to leave that run
  // -up intact, so the question is due before the errand would have started.
  it("is the widest (offset + run-up) of the offered set", () => {
    expect(promptOffsetDays("birthday")).toBe(
      12 + actionDefOf("get:gift").activeDays,
    );
    // ⚠️ **`get:card`, not `send:card`** — and so 42 days, not 21. Anniversary
    // offered a posting with nothing to post until the delivery pairing landed
    // (2026-09-06); giving it the shop trip it was missing also gives it that
    // trip's 30-day run-up, which is the widest thing it now offers. The question
    // has to come and go before the errand it unlocks would have started, so a
    // wider offer *means* an earlier prompt. That is the arithmetic working, not
    // a regression — but it is a visible one: the anniversary and first-date
    // prompts now arrive six weeks out rather than three.
    expect(promptOffsetDays("anniversary")).toBe(
      12 + actionDefOf("get:card").activeDays,
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
      action: "get:gift",
      offsetDays: 30,
      enabled: true,
    });
    expect(parsed.action).toBe("get:gift");
  });

  // The pre-split names are not merely unknown, they are malformed: a bare
  // qualifier has no verb. Rejecting them is what stops a stale caller writing
  // rows the resolver would then have to guess at.
  it("rejects a bare qualifier", () => {
    expect(() =>
      reminderRuleInputSchema.parse({
        action: "gift",
        offsetDays: 12,
        enabled: true,
      }),
    ).toThrow();
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
    expect(reminderRuleLabel({ action: "get:gift", label: null })).toBe(
      actionDefOf("get:gift").label,
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
    // Furthest-out first: the two shop trips a dozen days out, posting the card
    // a week out, then the day-of group. `offsetDays` is when a thing is *due*; how long it then
    // sits on the list is the action's own `activeDays`.
    expect(rules.map((r) => r.action)).toEqual([
      "get:gift",
      "get:card",
      "send:card",
      "send:gift",
      "wish",
    ]);
    // The two deliveries share an offset deliberately: the prompt asks *in
    // person or by mail?* once for the whole occasion, so a caption that had to
    // say "7 days, or 9 for the gift" would describe a distinction the control
    // does not offer.
    expect(rules.map((r) => r.offsetDays)).toEqual([12, 12, 7, 7, 0]);
    // ⚠️ No `call`, no `message:sms`. They sat in this list until 2026-09-05 and
    // folded into the one `wish` row: a channel is a button on the
    // acknowledgment, not a second errand to tick.
    expect(rules.map((r) => r.action)).not.toContain("call");
    // "Wish them a happy birthday" is the only rule on by default; the staggered
    // gift, card and message actions are offered but start off.
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
    expect(rules.some((r) => r.action === "message:sms")).toBe(false);
    // The kind registry itself excludes it (the "disabled entirely" case).
    expect(
      kindDefs.death.defaultReminderSchedule.some(
        (d) => d.action === "message:sms",
      ),
    ).toBe(false);
  });

  it("uses the stored rules verbatim when the milestone is customised", () => {
    const stored = [
      rule({ action: "get:gift", offsetDays: 14, enabled: false }),
      rule({
        action: "other",
        label: "Bake a cake",
        offsetDays: 0,
        enabled: true,
      }),
    ];
    const { rules, source } = resolveReminderSchedule("birthday", stored);
    // Stored set wins over the kind defaults, furthest-out first.
    expect(rules.map((r) => r.action)).toEqual(["get:gift", "other"]);
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
      rule({ action: "get:gift", offsetDays: 12, enabled: false }),
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

// The set-level guard. A per-row schema cannot see a duplicate, and nothing in
// the DB prevents one — so this is the only thing standing between the schedule
// editor and the collapse the qualifier was introduced to fix.
/** A rule input from just the parts a duplicate test cares about. */
const at = (action: string, over: Record<string, unknown> = {}) => ({
  action,
  offsetDays: 0,
  enabled: true,
  ...over,
});

describe("reminderScheduleInputSchema", () => {
  it("accepts two qualifiers of one verb", () => {
    const parsed = reminderScheduleInputSchema.parse([
      at("get:gift", { offsetDays: 12 }),
      at("get:card", { offsetDays: 5 }),
    ]);
    expect(parsed).toHaveLength(2);
  });

  it("rejects the same action twice on one bearer", () => {
    const result = reminderScheduleInputSchema.safeParse([
      at("get:gift", { offsetDays: 12 }),
      at("get:gift", { offsetDays: 5 }),
    ]);
    expect(result.success).toBe(false);
    // Flagged against the *second* row — the one the user just added.
    expect(result.error?.issues[0].path).toEqual([1, "action"]);
  });

  // `other` carries no information in its action at all: the errand is its
  // label. Two custom rows are the most reachable form of the collapse, since
  // the editor visibly invites a second one.
  it("keeps two `other` rules apart by their labels", () => {
    const parsed = reminderScheduleInputSchema.parse([
      at("other", { label: "Send flowers" }),
      at("other", { label: "Book the restaurant" }),
    ]);
    expect(parsed).toHaveLength(2);
    const clash = reminderScheduleInputSchema.safeParse([
      at("other", { label: "Send flowers" }),
      at("other", { label: "  send FLOWERS " }),
    ]);
    expect(clash.success).toBe(false);
    expect(clash.error?.issues[0].path).toEqual([1, "label"]);
  });
});

describe("actionKeyOf", () => {
  it("is the action itself, except for `other`", () => {
    expect(actionKeyOf({ action: "get:gift", label: null })).toBe("get:gift");
    expect(actionKeyOf({ action: "other", label: "Bake a cake" })).toBe(
      "other:bake a cake",
    );
    // Re-capitalising a custom errand is an edit, not a new reminder.
    expect(actionKeyOf({ action: "other", label: " Bake A Cake " })).toBe(
      actionKeyOf({ action: "other", label: "bake a cake" }),
    );
  });
});

describe("offerLabel", () => {
  it("names the occasion where the action's label would not", () => {
    expect(offerLabel("wish", kindDefs.birthday.greeting)).toBe(
      "Wish them a happy birthday",
    );
    expect(offerLabel("get:gift", kindDefs.birthday.greeting)).toBe(
      "Get a gift",
    );
  });
});

describe("leadTimeLabel", () => {
  it("says days, never weeks", () => {
    // One unit across the whole list: "1 week before" beside "12 days before"
    // makes two rows look like they are measured in different things — and the
    // number is what the prompt is about to let the user edit.
    expect(leadTimeLabel(0)).toBe("on the day");
    expect(leadTimeLabel(1)).toBe("1 day before");
    expect(leadTimeLabel(7)).toBe("7 days before");
    expect(leadTimeLabel(12)).toBe("12 days before");
  });
});

describe("promptGroupsOf / setPromptItem / setPromptDelivery", () => {
  /** A birthday's offer set as the prompt is handed it: kind defaults, wish on. */
  const offers = () => resolveReminderSchedule("birthday", []).rules;
  const enabledIn = (rules: readonly ReminderRuleInput[]) =>
    rules.filter((r) => r.enabled).map((r) => r.action);

  it("lifts the deliveries out of the items", () => {
    const { items, delivery } = promptGroupsOf(offers());

    // Posting is not a peer of buying: offered side by side, the prompt let you
    // schedule a posting for a card you were never getting.
    expect(items.map((i) => i.rule.action)).toEqual([
      "get:gift",
      "get:card",
      "wish",
    ]);
    // Nothing it could deliver is on, so it has nothing to ask about yet.
    expect(delivery).toEqual({
      mailed: false,
      visible: false,
      offsetDays: null,
    });
  });

  it("asks the delivery question only once something needs delivering", () => {
    const card = offers().findIndex((r) => r.action === "get:card");

    expect(
      promptGroupsOf(setPromptItem(offers(), card, true)).delivery,
    ).toEqual({ mailed: false, visible: true, offsetDays: 7 });
  });

  it("is one answer for the occasion, not one per item", () => {
    const rules = offers();
    const card = rules.findIndex((r) => r.action === "get:card");
    const gift = rules.findIndex((r) => r.action === "get:gift");

    let next = setPromptItem(rules, card, true);
    next = setPromptItem(next, gift, true);
    next = setPromptDelivery(next, true);

    // ⚠️ Both postings, from the one choice. Asking under the gift and again
    // under the card is two questions where nobody has two answers.
    expect(enabledIn(next).sort()).toEqual([
      "get:card",
      "get:gift",
      "send:card",
      "send:gift",
      "wish",
    ]);
  });

  it("never posts a thing that is no longer being got", () => {
    const rules = offers();
    const card = rules.findIndex((r) => r.action === "get:card");

    const mailing = setPromptDelivery(setPromptItem(rules, card, true), true);
    expect(enabledIn(mailing)).toContain("send:card");

    // Turning the item off has to take its delivery with it — otherwise the
    // write schedules a posting for a card nobody is buying.
    const off = setPromptItem(mailing, card, false);
    expect(enabledIn(off)).toEqual(["wish"]);
  });

  it("writes the whole set, disabled rows included", () => {
    const rules = offers();
    const gift = rules.findIndex((r) => r.action === "get:gift");

    // Rows existing is what makes "asked, and chose nothing" distinguishable
    // from "never asked", so no edit may drop one — a partial write would have
    // the question return next year.
    for (const next of [
      setPromptItem(rules, gift, true),
      setPromptDelivery(rules, true),
      setPromptItem(setPromptDelivery(rules, true), gift, false),
    ]) {
      expect(next.map((r) => r.action)).toEqual(rules.map((r) => r.action));
    }
  });

  it("keeps an orphaned delivery visible as an item of its own", () => {
    // A schedule may hold a `send:card` with no `get:card` beside it — the full
    // editor writes flat, and a peer on an older build synced sets like this.
    // Grouped under an absent parent it would only ever show when that parent
    // was on, i.e. never; orphaned, it is simply an item again.
    const orphan: ReminderRuleInput[] = [
      { action: "send:card", label: null, offsetDays: 7, enabled: true },
      { action: "wish", label: null, offsetDays: 0, enabled: true },
    ];
    const { items, delivery } = promptGroupsOf(orphan);

    expect(items.map((i) => i.rule.action)).toEqual(["send:card", "wish"]);
    expect(delivery).toBeNull();
  });

  it("reports no delivery question when the set holds none", () => {
    expect(
      promptGroupsOf(resolveReminderSchedule("moved", []).rules).delivery,
    ).toBeNull();
  });
});
