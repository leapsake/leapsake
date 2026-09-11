import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
  seedHolidayCatalog,
} from "@leapsake/core";
import { type CivilDate, reminderLabel, todayCivil } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let core: CoreApi;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  // The bundled catalog: the reminder engine's holiday families need real rows,
  // and `reminders.targets` reads over what the engine mints.
  await seedHolidayCatalog({ driver });
  core = createCore(driver);
});

afterEach(() => {
  cleanup();
});

/** Create a Person and return its id. */
async function makePerson(name: string): Promise<string> {
  const person = await core.people.create(
    { firstName: name, middleName: null, lastName: "X", gender: null },
    [],
  );
  return person.id;
}

/** Create a Pet and return its id. */
async function makePet(name: string): Promise<string> {
  const pet = await core.pets.create({ name }, []);
  return pet.id;
}

describe("core.gifts.ideas", () => {
  it("creates, lists, updates, and removes a gift idea", async () => {
    const idea = await core.gifts.ideas.create({
      title: "The Adventures of Tom Sawyer",
      url: "https://example.com/tom-sawyer",
    });
    expect(await core.gifts.ideas.get(idea.id)).toMatchObject({
      title: "The Adventures of Tom Sawyer",
      url: "https://example.com/tom-sawyer",
      notes: null,
    });

    const renamed = await core.gifts.ideas.update(idea.id, {
      title: "Tom Sawyer",
      notes: "the 200-shot model",
    });
    expect(renamed).toMatchObject({
      title: "Tom Sawyer",
      notes: "the 200-shot model",
    });

    await core.gifts.ideas.softDelete(idea.id);
    expect(await core.gifts.ideas.get(idea.id)).toBeUndefined();
    expect(await core.gifts.ideas.list()).toEqual([]);
  });

  it("lists ideas newest-first", async () => {
    const socks = await core.gifts.ideas.create({ title: "Socks" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const scarf = await core.gifts.ideas.create({ title: "Scarf" });

    expect((await core.gifts.ideas.list()).map((i) => i.title)).toEqual([
      "Scarf",
      "Socks",
    ]);
    expect(scarf.createdAt).toBeGreaterThanOrEqual(socks.createdAt);
  });

  it("attaches recipients in the same call that mints the idea", async () => {
    const violet = await makePerson("Violet");
    const jimmy = await makePet("Jimmy");

    const idea = await core.gifts.ideas.create({
      title: "Tennis balls",
      recipients: [
        { party: { type: "person", id: violet } },
        { party: { type: "pet", id: jimmy }, given: true },
      ],
    });

    const links = await core.gifts.recipients.listForIdea(idea.id);
    expect(links.map((l) => l.recipientLabel).sort()).toEqual([
      "Jimmy",
      "Violet X",
    ]);
    expect(links.find((l) => l.recipientId === jimmy)?.givenAt).not.toBeNull();
    expect(links.find((l) => l.recipientId === violet)?.givenAt).toBeNull();
  });
});

describe("core.gifts.recipients", () => {
  it("joins a party's links with the idea's title and url", async () => {
    const violet = await makePerson("Violet");
    const idea = await core.gifts.ideas.create({
      title: "Kite",
      url: "https://kites.example",
    });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
    });

    const rows = await core.gifts.recipients.listForRecipient("person", violet);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ideaTitle: "Kite",
      ideaUrl: "https://kites.example",
      givenAt: null,
    });
  });

  it("joins an idea's links with the recipient's current label", async () => {
    const violet = await makePerson("Violet");
    const idea = await core.gifts.ideas.create({ title: "Kite" });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
    });

    await core.people.update(violet, { firstName: "Vi" }, []);

    expect(
      (await core.gifts.recipients.listForIdea(idea.id)).map(
        (l) => l.recipientLabel,
      ),
    ).toEqual(["Vi X"]);
  });

  it("ticks and unticks the box", async () => {
    const violet = await makePerson("Violet");
    const idea = await core.gifts.ideas.create({ title: "Kite" });
    const link = await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
    });

    const ticked = await core.gifts.recipients.update(link.id, {
      given: true,
    });
    expect(ticked?.givenAt).not.toBeNull();

    const unticked = await core.gifts.recipients.update(link.id, {
      given: false,
    });
    expect(unticked?.givenAt).toBeNull();
  });

  it("publishes an unpublished party when a gift is attached to them", async () => {
    // Being someone to give something to is a fact about them — the same rule
    // that promotes an unpublished person when they get a milestone.
    const violet = await makePerson("Violet");
    const idea = await core.gifts.ideas.create({ title: "Kite" });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
    });

    expect(await core.people.get(violet)).toBeDefined();
  });

  it("cascades: deleting the idea removes its links", async () => {
    const violet = await makePerson("Violet");
    const idea = await core.gifts.ideas.create({ title: "Kite" });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
    });

    await core.gifts.ideas.softDelete(idea.id);
    expect(
      await core.gifts.recipients.listForRecipient("person", violet),
    ).toEqual([]);
  });

  it("cascades: deleting the recipient removes their links", async () => {
    const violet = await makePerson("Violet");
    const idea = await core.gifts.ideas.create({ title: "Kite" });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
    });

    await core.people.softDelete(violet);
    expect(await core.gifts.recipients.listForIdea(idea.id)).toEqual([]);
  });

  it("repoints a loser's links onto the survivor on merge", async () => {
    const violet = await makePerson("Violet");
    const harry = await makePerson("Harry");
    const idea = await core.gifts.ideas.create({ title: "Kite" });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
    });

    await core.people.merge(harry, violet);

    expect(
      await core.gifts.recipients.listForRecipient("person", violet),
    ).toEqual([]);
    expect(
      (await core.gifts.recipients.listForRecipient("person", harry)).map(
        (l) => l.ideaTitle,
      ),
    ).toEqual(["Kite"]);
  });

  it("collapses a merge's duplicate ideas, keeping the ✓", async () => {
    // Both were down for the same thing and one of them got it. The survivor
    // should hold one row, still ticked — not the same idea listed twice.
    const violet = await makePerson("Violet");
    const harry = await makePerson("Harry");
    const idea = await core.gifts.ideas.create({ title: "Kite" });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: harry },
    });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
      given: true,
    });

    await core.people.merge(harry, violet);

    const rows = await core.gifts.recipients.listForRecipient("person", harry);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.givenAt).not.toBeNull();
  });
});

describe("core.gifts.capture (the consolidated create)", () => {
  it("with no recipients, just creates the idea", async () => {
    const idea = await core.gifts.capture({
      giftIdea: { title: "Socks" },
      recipients: [],
    });
    expect((await core.gifts.ideas.list()).map((i) => i.id)).toEqual([idea.id]);
    expect(await core.gifts.recipients.listForIdea(idea.id)).toEqual([]);
  });

  it("mints the idea once, however many recipients it has", async () => {
    const violet = await makePerson("Violet");
    const harry = await makePerson("Harry");

    const idea = await core.gifts.capture({
      giftIdea: { title: "Scarf", url: "https://scarves.example" },
      recipients: [
        { party: { type: "person", id: violet } },
        { party: { type: "person", id: harry }, given: true },
      ],
    });

    expect(await core.gifts.ideas.list()).toHaveLength(1);
    expect(idea.url).toBe("https://scarves.example");

    const links = await core.gifts.recipients.listForIdea(idea.id);
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.recipientId === harry)?.givenAt).not.toBeNull();
    expect(links.find((l) => l.recipientId === violet)?.givenAt).toBeNull();
  });

  it("reuses an existing idea by id rather than minting a duplicate", async () => {
    const violet = await makePerson("Violet");
    const existing = await core.gifts.ideas.create({ title: "Socks" });

    const idea = await core.gifts.capture({
      giftIdea: { id: existing.id },
      recipients: [{ party: { type: "person", id: violet } }],
    });

    expect(idea.id).toBe(existing.id);
    expect(await core.gifts.ideas.list()).toHaveLength(1);
  });

  it("rejects a capture against a missing idea id", async () => {
    await expect(
      core.gifts.capture({
        giftIdea: { id: crypto.randomUUID() },
        recipients: [],
      }),
    ).rejects.toThrow(/gift idea not found/);
  });

  it("does not double a party already on the idea", async () => {
    // Capture is an *add* surface — it can name an idea somebody is already
    // down for, and saying so again must not list them twice.
    const violet = await makePerson("Violet");
    const idea = await core.gifts.ideas.create({ title: "Socks" });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
    });

    await core.gifts.capture({
      giftIdea: { id: idea.id },
      recipients: [{ party: { type: "person", id: violet } }],
    });

    expect(await core.gifts.recipients.listForIdea(idea.id)).toHaveLength(1);
  });

  it("ticks a party already on the idea when the capture says they got it", async () => {
    const violet = await makePerson("Violet");
    const idea = await core.gifts.ideas.create({ title: "Socks" });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
    });

    await core.gifts.capture({
      giftIdea: { id: idea.id },
      recipients: [{ party: { type: "person", id: violet }, given: true }],
    });

    const [link] = await core.gifts.recipients.listForIdea(idea.id);
    expect(link?.givenAt).not.toBeNull();
  });

  it("never unticks an existing link — that is the checkbox's job", async () => {
    // Capture says "and I gave them this", never "and I did not": re-capturing
    // an idea from a share sheet must not undo a ✓ recorded on their page.
    const violet = await makePerson("Violet");
    const idea = await core.gifts.ideas.create({ title: "Socks" });
    await core.gifts.recipients.create({
      giftIdeaId: idea.id,
      party: { type: "person", id: violet },
      given: true,
    });

    await core.gifts.capture({
      giftIdea: { id: idea.id },
      recipients: [{ party: { type: "person", id: violet } }],
    });

    const [link] = await core.gifts.recipients.listForIdea(idea.id);
    expect(link?.givenAt).not.toBeNull();
  });

  it("attaches a pet as readily as a person", async () => {
    const jimmy = await makePet("Jimmy");
    const idea = await core.gifts.capture({
      giftIdea: { title: "Chew toy" },
      recipients: [{ party: { type: "pet", id: jimmy }, given: true }],
    });

    expect(
      (await core.gifts.recipients.listForRecipient("pet", jimmy)).map(
        (l) => l.ideaTitle,
      ),
    ).toEqual(["Chew toy"]);
    expect(
      (await core.gifts.recipients.listForIdea(idea.id))[0]?.recipientLabel,
    ).toBe("Jimmy");
  });
});

describe("core.gifts.overview (the Gifts screen, keyed by idea)", () => {
  it("returns each idea with everyone it is for", async () => {
    const violet = await makePerson("Violet");
    const harry = await makePerson("Harry");

    const idea = await core.gifts.capture({
      giftIdea: { title: "Kite" },
      recipients: [
        { party: { type: "person", id: violet } },
        { party: { type: "person", id: harry }, given: true },
      ],
    });

    const [row] = await core.gifts.overview();
    expect(row?.idea.id).toBe(idea.id);
    expect(row?.recipients.map((r) => r.recipientLabel).sort()).toEqual([
      "Harry X",
      "Violet X",
    ]);
    expect(
      row?.recipients
        .filter((r) => r.givenAt !== null)
        .map((r) => r.recipientLabel),
    ).toEqual(["Harry X"]);
  });

  it("lists an idea nobody is down for (a bare idea)", async () => {
    await core.gifts.ideas.create({ title: "Socks" });
    const [row] = await core.gifts.overview();
    expect(row?.idea.title).toBe("Socks");
    expect(row?.recipients).toEqual([]);
    expect(row?.tags).toEqual([]);
  });
});

describe("core.gifts.ideas — tags", () => {
  it("saves an idea's tags with the idea itself", async () => {
    const idea = await core.gifts.ideas.create({ title: "Wool socks" }, [
      "stocking",
      "warm",
    ]);
    expect(
      (await core.tags.listForGiftIdea(idea.id)).map((t) => t.name).sort(),
    ).toEqual(["stocking", "warm"]);
  });

  it("replaces the whole set on update, and clears it with an empty list", async () => {
    const idea = await core.gifts.ideas.create({ title: "Wool socks" }, [
      "stocking",
    ]);

    await core.gifts.ideas.update(idea.id, {}, ["warm"]);
    expect(
      (await core.tags.listForGiftIdea(idea.id)).map((t) => t.name),
    ).toEqual(["warm"]);

    await core.gifts.ideas.update(idea.id, {}, []);
    expect(await core.tags.listForGiftIdea(idea.id)).toEqual([]);
  });

  it("leaves the tags alone when an update doesn't mention them", async () => {
    // The distinction that makes the argument optional: renaming an idea must
    // not silently drop its tags, while `[]` still means "clear them".
    const idea = await core.gifts.ideas.create({ title: "Wool socks" }, [
      "warm",
    ]);
    const renamed = await core.gifts.ideas.update(idea.id, {
      title: "Merino socks",
    });
    expect(renamed?.title).toBe("Merino socks");
    expect(
      (await core.tags.listForGiftIdea(idea.id)).map((t) => t.name),
    ).toEqual(["warm"]);
  });

  it("lists tagged ideas on the tag's own page", async () => {
    const socks = await core.gifts.ideas.create({ title: "Wool socks" }, [
      "stocking",
    ]);
    await core.gifts.ideas.create({ title: "Sled" }, ["outdoors"]);
    const [tag] = await core.tags.listForGiftIdea(socks.id);

    expect(
      (await core.tags.giftIdeasForTag(tag.id)).map((i) => i.title),
    ).toEqual(["Wool socks"]);
  });

  it("shares one tag across an idea and a person", async () => {
    // The whole point of a shared tag: the same "#books" reaches both.
    const person = await makePerson("Violet");
    await core.people.update(person, {}, ["books"]);
    const idea = await core.gifts.ideas.create({ title: "Dune" }, ["books"]);
    const [tag] = await core.tags.listForGiftIdea(idea.id);

    expect((await core.tags.peopleForTag(tag.id)).map((p) => p.id)).toEqual([
      person,
    ]);
    expect((await core.tags.giftIdeasForTag(tag.id)).map((i) => i.id)).toEqual([
      idea.id,
    ]);
  });

  it("carries the tags into the Gifts-screen overview", async () => {
    await core.gifts.ideas.create({ title: "Wool socks" }, ["stocking"]);
    const [row] = await core.gifts.overview();
    expect(row?.tags.map((t) => t.name)).toEqual(["stocking"]);
  });

  it("removes the taggings when the idea is deleted, GCing an orphaned tag", async () => {
    const idea = await core.gifts.ideas.create({ title: "Wool socks" }, [
      "stocking",
    ]);
    const [tag] = await core.tags.listForGiftIdea(idea.id);

    await core.gifts.ideas.softDelete(idea.id);
    expect(await core.tags.listForGiftIdea(idea.id)).toEqual([]);
    expect(await core.tags.giftIdeasForTag(tag.id)).toEqual([]);
    // Its last bearer gone, the tag itself is garbage-collected.
    expect(await core.tags.get(tag.id)).toBeUndefined();
  });
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

/**
 * The reminder loop: the `🎁 gift` action has
 * always minted "Get @Violet a gift"; `reminders.targets().gifts` is what tells a client which
 * reminders those are and who they're for, so it can link to the recipient's
 * gifts and — once done — to ticking off what was given.
 */
describe("core.reminders.targets — the gift half", () => {
  /** A person with a birthday `days` out whose schedule turns the gift action on. */
  async function personWithGiftReminder(days: number, name: string) {
    const person = await core.people.create(
      { firstName: name, middleName: null, lastName: "X", gender: null },
      [],
    );
    const occ = civilDaysFromToday(days);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: person.id,
      year: null,
      month: occ.month,
      day: occ.day,
      reminderSchedule: [
        { action: "get:gift", label: null, offsetDays: 30, enabled: true },
        { action: "wish", label: null, offsetDays: 0, enabled: true },
      ],
    });
    return person.id;
  }

  it("names the gift reminder and its recipient", async () => {
    const violet = await personWithGiftReminder(20, "Violet");

    const targets = (await core.reminders.targets()).gifts;
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      recipientType: "person",
      recipientId: violet,
    });

    // The named reminder is the gift one — not the birthday wish beside it.
    const reminder = await core.reminders.get(targets[0].reminderId);
    expect(reminderLabel(reminder!)).toBe("🎁 Get @Violet X a gift");
  });

  it("excludes the wish reminder minted alongside it", async () => {
    await personWithGiftReminder(20, "Violet");
    const targets = (await core.reminders.targets()).gifts;
    const labels = await Promise.all(
      targets.map(async (t) =>
        reminderLabel((await core.reminders.get(t.reminderId))!),
      ),
    );
    expect(labels).toEqual(["🎁 Get @Violet X a gift"]);
  });

  it("keeps naming the reminder once it's completed, so the gift can be recorded", async () => {
    const violet = await personWithGiftReminder(20, "Violet");
    const [target] = (await core.reminders.targets()).gifts;
    await core.reminders.setCompleted(target.reminderId, true);

    const after = (await core.reminders.targets()).gifts;
    expect(after).toEqual([
      {
        reminderId: target.reminderId,
        recipientType: "person",
        recipientId: violet,
      },
    ]);
  });

  it("returns nothing when no gift action is enabled", async () => {
    // The birthday kind defaults leave gift off — only the day-of wish is on.
    const person = await core.people.create(
      { firstName: "Zuzu", middleName: null, lastName: "X", gender: null },
      [],
    );
    const occ = civilDaysFromToday(10);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: person.id,
      year: null,
      month: occ.month,
      day: occ.day,
    });
    expect((await core.reminders.targets()).gifts).toEqual([]);
  });

  it("hands the recipient to a capture that closes the loop", async () => {
    // What the completed-reminder CTA does: capture a gift for the named
    // recipient, already ticked, which then reads back on their page as given.
    const violet = await personWithGiftReminder(20, "Violet");
    const [target] = (await core.reminders.targets()).gifts;

    await core.gifts.capture({
      giftIdea: { title: "Scarf" },
      recipients: [
        {
          party: { type: target.recipientType, id: target.recipientId },
          given: true,
        },
      ],
    });

    const rows = await core.gifts.recipients.listForRecipient("person", violet);
    expect(rows.map((r) => r.ideaTitle)).toEqual(["Scarf"]);
    expect(rows[0]?.givenAt).not.toBeNull();
  });
});
