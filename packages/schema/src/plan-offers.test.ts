import { describe, expect, it } from "vitest";
import { observanceDefaultReminderSchedule } from "./holiday.js";
import {
  type DefaultReminderRule,
  OFFER_NOTICE_DAYS,
  effectiveOffsetDays,
  effectiveOffsets,
  fitsAt,
  isPartialAnswer,
  kindDefs,
  latestOffsetDays,
  milestoneKindSchema,
  planOffers,
  planTiming,
  promptOffsetDays,
} from "./milestone.js";
import {
  type ReminderAction,
  type ReminderRuleInput,
  actionDefOf,
} from "./reminder-rule.js";

/** A rule as the engine hands it to {@link effectiveOffsets}. */
const rule = (
  action: ReminderRuleInput["action"],
  offsetDays: number,
): ReminderRuleInput => ({ action, label: null, offsetDays, enabled: true });

const actionsOf = (rules: ReminderRuleInput[]) => rules.map((r) => r.action);

// A birthday's post date is a week out; its gift and card are due 12 days out
// but can be handed over in person the day before.
const POST = 7;
const IN_PERSON = 1;

describe("latestOffsetDays", () => {
  it("slides an in-person errand to the day before", () => {
    expect(latestOffsetDays("get:gift", 12)).toBe(IN_PERSON);
    expect(latestOffsetDays("get:card", 12)).toBe(IN_PERSON);
  });

  it("never slides later than the rule's own offset", () => {
    expect(latestOffsetDays("get:gift", 0)).toBe(0);
  });

  it("never moves a post date", () => {
    expect(latestOffsetDays("send:card", POST)).toBe(POST);
  });
});

describe("fitsAt", () => {
  it("offers posting until the post date is closer than the notice", () => {
    expect(fitsAt("send:card", POST, POST + OFFER_NOTICE_DAYS)).toBe(true);
    expect(fitsAt("send:card", POST, POST + OFFER_NOTICE_DAYS - 1)).toBe(false);
  });

  it("offers getting a gift until the day before is closer than the notice", () => {
    expect(fitsAt("get:gift", 12, IN_PERSON + OFFER_NOTICE_DAYS)).toBe(true);
    expect(fitsAt("get:gift", 12, IN_PERSON + OFFER_NOTICE_DAYS - 1)).toBe(
      false,
    );
  });

  it("offers a day-of action right up to the occasion, and not after", () => {
    expect(fitsAt("wish", 0, 0)).toBe(true);
    expect(fitsAt("wish", 0, -1)).toBe(false);
  });
});

describe("planOffers", () => {
  it("offers a birthday everything two months out", () => {
    expect(actionsOf(planOffers("birthday", [], 60))).toEqual([
      "get:gift",
      "get:card",
      "send:card",
      "send:gift",
      "wish",
    ]);
  });

  it("stops offering to post once the post date is too close", () => {
    expect(actionsOf(planOffers("birthday", [], 5))).toEqual([
      "get:gift",
      "get:card",
      "wish",
    ]);
  });

  it("offers only the wish the day before", () => {
    expect(actionsOf(planOffers("birthday", [], 1))).toEqual(["wish"]);
  });

  it("takes each offer's offset and tick from a stored answer", () => {
    const stored: ReminderRuleInput = {
      action: "get:gift",
      label: null,
      offsetDays: 20,
      enabled: true,
    };
    expect(planOffers("birthday", [stored], 60)[0]).toEqual(stored);
  });
});

describe("planTiming", () => {
  const usual = promptOffsetDays("birthday");

  it("keeps the usual deadline when there was time for it", () => {
    expect(planTiming("birthday", [], usual + OFFER_NOTICE_DAYS)).toEqual({
      dueOffsetDays: usual,
      late: false,
    });
  });

  it("is due on the last day to post, when learned three weeks out", () => {
    expect(planTiming("birthday", [], 20)).toEqual({
      dueOffsetDays: POST + OFFER_NOTICE_DAYS,
      late: true,
    });
  });

  it("is due on the last day to shop, when learned five days out", () => {
    expect(planTiming("birthday", [], 5)).toEqual({
      dueOffsetDays: IN_PERSON + OFFER_NOTICE_DAYS,
      late: true,
    });
  });

  it("is not set by an offer that expires the day it arrives", () => {
    expect(planTiming("birthday", [], IN_PERSON + OFFER_NOTICE_DAYS)).toEqual({
      dueOffsetDays: 0,
      late: true,
    });
  });
});

describe("effectiveOffsetDays", () => {
  it("keeps the rule's deadline when it was chosen in time", () => {
    expect(effectiveOffsetDays("get:gift", 12, 60)).toBe(12);
    expect(effectiveOffsetDays("get:gift", 12, 12 + OFFER_NOTICE_DAYS)).toBe(
      12,
    );
  });

  it("slides a last-minute gift to the day before", () => {
    expect(effectiveOffsetDays("get:gift", 12, 5)).toBe(IN_PERSON);
  });

  it("never moves a post date", () => {
    expect(effectiveOffsetDays("send:card", POST, POST + 1)).toBe(POST);
  });

  it("leaves a rule written after the occasion alone", () => {
    expect(effectiveOffsetDays("get:gift", 12, -1)).toBe(12);
  });
});

describe("effectiveOffsets", () => {
  const card = rule("get:card", 12);
  const post = rule("send:card", POST);
  const wish = rule("wish", 0);

  // ⚠️ The regression. A card learned of twelve days out has no slack left for
  // its own twelve-day deadline, so **on its own** it slides to the day before
  // — landing six days after the posting it feeds, which is impossible.
  it("does not slide an errand past the one authored to follow it", () => {
    expect(effectiveOffsetDays("get:card", 12, 12)).toBe(IN_PERSON);
    expect(effectiveOffsets([card, post], 12)).toEqual([
      { rule: card, offsetDays: 12 },
      { rule: post, offsetDays: POST },
    ]);
  });

  it("still slides an errand with nothing waiting on it", () => {
    expect(effectiveOffsets([rule("get:gift", 12), wish], 5)).toEqual([
      { rule: rule("get:gift", 12), offsetDays: IN_PERSON },
      { rule: wish, offsetDays: 0 },
    ]);
  });

  it("leaves a set chosen in time alone", () => {
    expect(effectiveOffsets([card, post, wish], 60)).toEqual([
      { rule: card, offsetDays: 12 },
      { rule: post, offsetDays: POST },
      { rule: wish, offsetDays: 0 },
    ]);
  });

  it("orders by the authored offsets however it is given them", () => {
    expect(effectiveOffsets([wish, post, card], 60).map((t) => t.rule)).toEqual(
      [card, post, wish],
    );
  });

  // The guarantee itself, stated over every day a birthday's schedule could be
  // learned on: the derived deadlines never come out in a different order from
  // the offsets that authored them.
  it("never reorders a birthday's schedule, whenever it is learned", () => {
    const rules = kindDefs.birthday.defaultReminderSchedule.map((d) =>
      rule(d.action, d.offsetDays),
    );
    for (let learned = -1; learned <= 60; learned++) {
      const offsets = effectiveOffsets(rules, learned).map((t) => t.offsetDays);
      expect([...offsets].sort((a, b) => b - a)).toEqual(offsets);
    }
  });
});

// The other half of the ordering guarantee. `effectiveOffsets` preserves the
// order the authored offsets encode; this is what makes that order right to
// begin with, and it fails the day a schedule authors a delivery ahead of the
// thing it delivers — "go to dinner" before "make the reservation".
describe("the authored defaults agree with the delivery edges", () => {
  const schedules: [string, readonly DefaultReminderRule[]][] = [
    ...milestoneKindSchema.options.map(
      (kind): [string, readonly DefaultReminderRule[]] => [
        kind,
        kindDefs[kind].defaultReminderSchedule,
      ],
    ),
    ["observance", observanceDefaultReminderSchedule],
  ];

  it("gives every delivery's parent the wider lead", () => {
    const wrong: string[] = [];
    for (const [name, rules] of schedules) {
      // Keyed by the **open** action type: a default's own action is a known
      // one, but `deliveryOf` names any action, so a narrower key would not
      // take the lookup below.
      const offsets = new Map<ReminderAction, number>(
        rules.map((r) => [r.action, r.offsetDays]),
      );
      for (const r of rules) {
        const parent = actionDefOf(r.action).deliveryOf;
        if (parent === undefined) continue;
        const parentOffset = offsets.get(parent);
        // A delivery whose parent this schedule does not offer stands on its
        // own — legal, and `promptGroupsOf` already treats it as an item.
        if (parentOffset === undefined) continue;
        if (parentOffset < r.offsetDays)
          wrong.push(
            `${name}: ${parent} at ${parentOffset} is after ${r.action} at ${r.offsetDays}`,
          );
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("isPartialAnswer", () => {
  it("is a full answer when everything was on offer", () => {
    expect(isPartialAnswer("birthday", [], 60)).toBe(false);
  });

  it("is partial when the post date had already gone", () => {
    expect(isPartialAnswer("birthday", [], 5)).toBe(true);
  });

  it("is never partial for a kind that does not ask", () => {
    expect(isPartialAnswer("death", [], 0)).toBe(false);
  });
});
