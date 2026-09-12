import { describe, expect, it } from "vitest";
import {
  OFFER_NOTICE_DAYS,
  effectiveOffsetDays,
  fitsAt,
  isPartialAnswer,
  latestOffsetDays,
  planOffers,
  planTiming,
  promptOffsetDays,
} from "./milestone.js";
import type { ReminderRuleInput } from "./reminder-rule.js";

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
