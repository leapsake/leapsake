import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import {
  type CivilDate,
  actionDefs,
  promptOffsetDays,
  todayCivil,
} from "@leapsake/schema";
import { reminderActionKey, reminderActionsOf } from "@leapsake/view-models";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The composition root's half of two things the engine can only be told about:
 * what a **relationship** is called, and whether a milestone is about a romantic
 * partnership the user is in.
 *
 * `packages/reminders/test/relationship-bearers.test.ts` pins the engine's
 * behaviour given those answers. These pin the answers themselves, against real
 * repositories — which is where the original bug lived: the port said `null` for
 * a relationship bearer, the engine reads `null` as "the bearer is gone", and a
 * wedding anniversary linked to its relationship generated nothing at all.
 */

let driver: SqliteDriver;
let cleanup: () => void;
let core: CoreApi;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  core = createCore(driver);
});

afterEach(() => {
  cleanup();
});

/** The civil date `days` after today, normalised across month/year boundaries. */
function civilDaysFromToday(days: number): CivilDate {
  const t = todayCivil();
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** Every live `system` reminder's title. */
async function titles(): Promise<string[]> {
  const rows = await core.reminders.list();
  return rows.filter((r) => r.source === "system").map((r) => r.title ?? "");
}

/** Me, and someone else, with `me` recorded as the self-person. */
async function twoPeople() {
  const me = await core.people.create({ firstName: "George" }, []);
  const partner = await core.people.create({ firstName: "Violet" }, []);
  await core.self.set(me.id);
  return { me, partner };
}

/**
 * A first date 30 days out — inside that kind's prompt window, which opens at
 * `promptOffsetDays("first-date") + actionDefs.plan.activeDays` = 35 days.
 * Derived rather than written down, so moving an offset moves this with it.
 */
const FIRST_DATE_SOON = civilDaysFromToday(
  promptOffsetDays("first-date") + actionDefs.plan.activeDays - 5,
);

describe("a milestone borne by a relationship", () => {
  it("is reminded about, and names the relationship's other end when it is yours", async () => {
    const { me, partner } = await twoPeople();
    const rel = await core.relationships.create({
      aType: "person",
      aId: me.id,
      aRole: "spouse",
      bType: "person",
      bId: partner.id,
      bRole: "spouse",
    });
    await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: rel.id,
      year: 2015,
      month: civilDaysFromToday(45).month,
      day: civilDaysFromToday(45).day,
    });

    // The regression: before the label port could name a relationship this was
    // an empty list, silently. And the wording is the *shared* one — the
    // relationship resolves to the other end's name, so the question names her.
    expect(await titles()).toContain(
      "🗓 What do you want to do for your anniversary with Violet?",
    );
  });

  it("names both ends when the relationship is somebody else's", async () => {
    await twoPeople();
    const harry = await core.people.create({ firstName: "Harry" }, []);
    const tilly = await core.people.create({ firstName: "Tilly" }, []);
    const rel = await core.relationships.create({
      aType: "person",
      aId: harry.id,
      aRole: "spouse",
      bType: "person",
      bId: tilly.id,
      bRole: "spouse",
    });
    // Inside that kind's own prompt window, derived rather than written down.
    const occ = civilDaysFromToday(
      promptOffsetDays("wedding") + actionDefs.plan.activeDays - 5,
    );
    await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: rel.id,
      year: 2015,
      month: occ.month,
      day: occ.day,
    });

    expect(await titles()).toContain(
      "🗓 What do you want to do for Harry & Tilly's anniversary?",
    );
  });
});

describe("a first date, asked about everyone's", () => {
  /** A first date recorded on `bearerId`, the common shape: borne by the person. */
  const recordFirstDate = (bearerId: string) =>
    core.milestones.create({
      kind: "first-date",
      bearerType: "person",
      bearerId,
      year: null,
      month: FIRST_DATE_SOON.month,
      day: FIRST_DATE_SOON.day,
    });

  const romance = (me: string, partner: string, aRole = "partner" as const) =>
    core.relationships.create({
      aType: "person",
      aId: me,
      aRole,
      bType: "person",
      bId: partner,
      bRole: aRole,
    });

  // It can only have been with you, so it moves onto your relationship unasked.
  it("links a first date on your partner to your relationship", async () => {
    const { me, partner } = await twoPeople();
    const rel = await romance(me.id, partner.id);
    await recordFirstDate(partner.id);

    expect(await core.milestones.listForBearer("person", partner.id)).toEqual(
      [],
    );
    expect(
      await core.milestones.listForBearer("relationship", rel.id),
    ).toHaveLength(1);
    expect(await titles()).toContain(
      "🗓 What do you want to do for your first date anniversary with Violet?",
    );
  });

  // Recorded before the partner was: linked once the relationship exists.
  it("links it when the partnership comes later", async () => {
    const { me, partner } = await twoPeople();
    await recordFirstDate(partner.id);
    const rel = await core.relationships.create({
      aType: "person",
      aId: me.id,
      aRole: "husband",
      bType: "person",
      bId: partner.id,
      bRole: "wife",
    });

    expect(
      await core.milestones.listForBearer("relationship", rel.id),
    ).toHaveLength(1);
  });

  it("asks about a first date between two other people", async () => {
    await twoPeople();
    const harry = await core.people.create({ firstName: "Harry" }, []);
    await recordFirstDate(harry.id);

    expect(
      (await titles()).some((t) => t.includes("first date anniversary")),
    ).toBe(true);
    expect(
      await core.milestones.listForBearer("person", harry.id),
    ).toHaveLength(1);
  });

  // A friendship is not a partnership: asked about, but not linked.
  it("leaves it alone when the edge is not a romantic one", async () => {
    const { me, partner } = await twoPeople();
    await core.relationships.create({
      aType: "person",
      aId: me.id,
      aRole: "friend",
      bType: "person",
      bId: partner.id,
      bRole: "friend",
    });
    await recordFirstDate(partner.id);

    expect(
      await core.milestones.listForBearer("person", partner.id),
    ).toHaveLength(1);
  });

  it("asks, unlinked, when nobody has said who they are", async () => {
    const partner = await core.people.create({ firstName: "Violet" }, []);
    await recordFirstDate(partner.id);

    expect(
      (await titles()).some((t) => t.includes("first date anniversary")),
    ).toBe(true);
    expect(
      await core.milestones.listForBearer("person", partner.id),
    ).toHaveLength(1);
  });
});

describe("the partnership question, against real repositories", () => {
  /** Me and a partner, joined by `role`, with no dates recorded anywhere. */
  async function partnered(role: "spouse" | "partner" | "husband") {
    const { me, partner } = await twoPeople();
    const rel = await core.relationships.create({
      aType: "person",
      aId: me.id,
      aRole: role,
      bType: "person",
      bId: partner.id,
      bRole: role === "husband" ? "wife" : role,
    });
    return { me, partner, rel };
  }

  const questions = async () =>
    (await titles()).filter((t) => t.startsWith("💍") || t.startsWith("💞"));

  it("asks for an anniversary when the role is a marriage", async () => {
    const { partner } = await partnered("spouse");
    expect(await questions()).toEqual([
      `💍 When is your anniversary with @[Violet](person:${partner.id})?`,
    ]);
  });

  it("asks for a first date when the role is an unmarried partnership", async () => {
    const { partner } = await partnered("partner");
    expect(await questions()).toEqual([
      `💞 When was your first date with @[Violet](person:${partner.id})?`,
    ]);
  });

  it("reads a marriage through its gendered roles too", async () => {
    await partnered("husband");
    expect((await questions())[0]).toContain("💍 When is your anniversary");
  });

  // ⚠️ The one that matters most. A wedding lives on the *person* until its
  // other party exists and on the *relationship* afterwards, so a check that
  // looked at only one bearer would re-ask for a date already given — the worst
  // thing a collection nudge can do.
  it("stops asking once the date is recorded on the relationship", async () => {
    const { rel } = await partnered("spouse");
    expect(await questions()).toHaveLength(1);

    await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: rel.id,
      year: 2015,
      month: 6,
      day: 12,
    });

    expect(await questions()).toHaveLength(0);
  });

  it("stops asking once the date is recorded on the partner instead", async () => {
    const { partner } = await partnered("spouse");
    await core.milestones.create({
      kind: "wedding",
      bearerType: "person",
      bearerId: partner.id,
      year: 2015,
      month: 6,
      day: 12,
    });

    expect(await questions()).toHaveLength(0);
  });

  // A date of the *other* kind is not an answer to this question.
  it("keeps asking when the recorded date is a different occasion", async () => {
    const { partner } = await partnered("spouse");
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: partner.id,
      year: 1990,
      month: 6,
      day: 12,
    });

    expect(await questions()).toHaveLength(1);
  });

  it("says nothing about relationships that are not romantic", async () => {
    await partnered("spouse");
    const harry = await core.people.create({ firstName: "Harry" }, []);
    const tilly = await core.people.create({ firstName: "Tilly" }, []);
    // Someone else's marriage, and a friendship of mine: neither is a question
    // for me to answer.
    await core.relationships.create({
      aType: "person",
      aId: harry.id,
      aRole: "spouse",
      bType: "person",
      bId: tilly.id,
      bRole: "spouse",
    });
    expect(await questions()).toHaveLength(1);
  });

  it("says nothing when nobody has said who they are", async () => {
    const a = await core.people.create({ firstName: "George" }, []);
    const b = await core.people.create({ firstName: "Violet" }, []);
    await core.relationships.create({
      aType: "person",
      aId: a.id,
      aRole: "spouse",
      bType: "person",
      bId: b.id,
      bRole: "spouse",
    });

    expect(await questions()).toHaveLength(0);
  });

  // The row and the CTA must agree on which reminder is which, and they derive
  // the id independently — core recomputes what the engine minted.
  it("pairs each question with the row it minted", async () => {
    const { rel } = await partnered("spouse");
    const { partnerships } = await core.reminders.targets();
    const ids = (await core.reminders.list()).map((r) => r.id);

    expect(partnerships).toHaveLength(1);
    expect(partnerships[0].relationshipId).toBe(rel.id);
    expect(partnerships[0].milestoneKind).toBe("wedding");
    expect(ids).toContain(partnerships[0].reminderId);
  });
});

describe("a wedding with nobody on the other side of it", () => {
  // The user's own case: an anniversary recorded before the spouse is in the app
  // at all. It reminds — that was never in question — and now it also offers to
  // collect the half it is missing.
  it("offers to say who it is with, naming it as your spouse when it is yours", async () => {
    const { me } = await twoPeople();
    const milestone = await core.milestones.create({
      kind: "wedding",
      bearerType: "person",
      bearerId: me.id,
      year: 2015,
      month: civilDaysFromToday(45).month,
      day: civilDaysFromToday(45).day,
    });

    const { linkPartners } = await core.reminders.targets();

    expect(linkPartners).not.toHaveLength(0);
    expect(linkPartners[0].milestoneId).toBe(milestone.id);
    expect(linkPartners[0].personId).toBe(me.id);
    // Wording only, but it is the case the affordance was asked for.
    expect(linkPartners[0].isSelf).toBe(true);
    // And it still reminds, which is the half that must never depend on the
    // record being complete.
    expect(await titles()).toContain(
      "🗓 What do you want to do for your own anniversary?",
    );
  });

  // Once it is bound, there is nothing left to ask.
  it("stops offering once the wedding is bound to a relationship", async () => {
    const { me, partner } = await twoPeople();
    const rel = await core.relationships.create({
      aType: "person",
      aId: me.id,
      aRole: "spouse",
      bType: "person",
      bId: partner.id,
      bRole: "spouse",
    });
    await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: rel.id,
      year: 2015,
      month: civilDaysFromToday(45).month,
      day: civilDaysFromToday(45).day,
    });

    expect((await core.reminders.targets()).linkPartners).toHaveLength(0);
  });

  // ⚠️ Weddings only. A first date stored on a person *is* about that person, so
  // asking who it is with would be asking a question whose answer is the row.
  it("says nothing about a first date, whose other party is the bearer", async () => {
    const { me, partner } = await twoPeople();
    await core.relationships.create({
      aType: "person",
      aId: me.id,
      aRole: "partner",
      bType: "person",
      bId: partner.id,
      bRole: "partner",
    });
    await core.milestones.create({
      kind: "first-date",
      bearerType: "person",
      bearerId: partner.id,
      year: null,
      month: FIRST_DATE_SOON.month,
      day: FIRST_DATE_SOON.day,
    });

    expect((await core.reminders.targets()).linkPartners).toHaveLength(0);
  });
});

// The moment the request was actually about: the day-of row for your own
// anniversary, when the app still does not know who it is with. No prompt is
// outstanding by then — it was answered weeks earlier — so the collect offer is
// the row's CTA rather than queued behind one.
describe("your own anniversary, on the day, with no spouse attached", () => {
  it("asks who your spouse is, on the row that says it is today", async () => {
    const me = await core.people.create({ firstName: "George" }, []);
    await core.self.set(me.id);
    const today = civilDaysFromToday(0);
    const milestone = await core.milestones.create({
      kind: "wedding",
      bearerType: "person",
      bearerId: me.id,
      year: 2015,
      month: today.month,
      day: today.day,
      reminderSchedule: [
        { action: "wish", label: null, offsetDays: 0, enabled: true },
      ],
    });

    expect(await titles()).toContain("💍 It's your anniversary!");

    const { linkPartners } = await core.reminders.targets();
    const offer = linkPartners.find((l) => l.milestoneId === milestone.id);
    expect(offer).toBeDefined();
    expect(offer?.isSelf).toBe(true);
  });
});

describe("the spouse offer, shown beside the row's own action", () => {
  // ⚠️ The gap this closes. The offer used to be the row's *main* CTA or
  // nothing, so it appeared only where nothing outranked it — the day-of wish,
  // a few days a year. Answer the prompt with only "get a gift" and it never
  // appeared at all.
  it("rides alongside the prompt that outranks it", async () => {
    const me = await core.people.create({ firstName: "George" }, []);
    await core.self.set(me.id);
    const occ = civilDaysFromToday(
      promptOffsetDays("wedding") + actionDefs.plan.activeDays - 3,
    );
    await core.milestones.create({
      kind: "wedding",
      bearerType: "person",
      bearerId: me.id,
      year: 2015,
      month: occ.month,
      day: occ.day,
    });

    const rows = await core.reminders.list();
    const prompt = rows.find((r) => r.title?.startsWith("🗓"));
    expect(prompt).toBeDefined();
    const t = await core.reminders.targets();
    const actions = reminderActionsOf(
      {
        id: prompt!.id,
        completedAt: prompt!.completedAt,
        dueDate: prompt!.dueDate,
      },
      {
        planTarget: t.plans.find((p) => p.reminderId === prompt!.id),
        linkPartnerTarget: t.linkPartners.find(
          (l) => l.reminderId === prompt!.id,
        ),
      },
    );

    const ctas = actions.flatMap((a) => (a.kind === "cta" ? [a.cta.kind] : []));
    // Its own question first, the record-completing offer beside it.
    expect(ctas).toEqual(["plan", "link-partner"]);
    // And the keys stay distinct, which is what two CTAs on one row needs.
    expect(new Set(actions.map(reminderActionKey)).size).toBe(actions.length);
  });
});
