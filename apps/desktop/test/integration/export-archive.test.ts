import {
  type CoreApi,
  type ExportData,
  type SqliteDriver,
  createCore,
  exportDataSchema,
  runMigrations,
  seedHolidayCatalog,
} from "@leapsake/core";
import { createHolidaysRepo, holidayIdFor } from "@leapsake/data";
import { parseVCards } from "@leapsake/vcard";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Export — `core.export.archive` over the **real** repos.
 *
 * `@leapsake/export` unit-tests the builder against in-memory ports, which
 * proves the format but says nothing about the wiring: whether the ports read
 * the tables a person's facts actually live in, and whether the exclusions the
 * builder relies on (soft-deleted rows, unpublished people) are really
 * structural in the data layer or merely asserted by a fake that agrees with
 * the assertion. That is what this covers, and it is the half that would fail
 * silently — an export missing everybody's phone numbers still produces a
 * perfectly valid archive.
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

const VERSION = "0.1.0-test";

async function exportedVcf(): Promise<string> {
  const { bytes } = await core.export.archive({ appVersion: VERSION });
  return new TextDecoder().decode(unzipSync(bytes)["contacts.vcf"]);
}

/** `data.json`, validated against the schema a restore path would read it with. */
async function exportedData(): Promise<ExportData> {
  const { bytes } = await core.export.archive({ appVersion: VERSION });
  const json = new TextDecoder().decode(unzipSync(bytes)["data.json"]);
  return exportDataSchema.parse(JSON.parse(json));
}

describe("core.export.archive", () => {
  it("carries a person's whole card: name, tags, methods and birthday", async () => {
    const mary = await core.people.create(
      {
        firstName: "Mary",
        middleName: "Hatch",
        lastName: "Bailey",
        gender: "female",
      },
      ["Family", "Work"],
    );
    await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: mary.id,
      label: "Home",
      address: "mary@example.com",
    });
    await core.contactMethods.phones.create({
      ownerType: "person",
      ownerId: mary.id,
      label: "Mobile",
      number: "+1 555 0100",
      extension: "204",
      country: "US",
    });
    await core.contactMethods.postals.create({
      ownerType: "person",
      ownerId: mary.id,
      label: "Home",
      line1: "1 Main St",
      line2: "Apt 4",
      locality: "Springfield",
      region: "IL",
      postalCode: "62704",
      country: "US",
    });
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: mary.id,
      year: 1985,
      month: 4,
      day: 12,
    });

    const vcf = await exportedVcf();

    // The literal properties, because this is the assertion that catches a port
    // reading the wrong table: a card that merely parses could still be empty.
    expect(vcf).toContain(`UID:urn:uuid:${mary.id}`);
    expect(vcf).toContain("CATEGORIES:Family,Work");
    expect(vcf).toContain("X-LEAPSAKE-EXT=204");
    expect(vcf).toContain("X-LEAPSAKE-COUNTRY=US");
    expect(vcf).toContain("X-ABADR:US");
    expect(vcf).toContain(`PRODID:-//Leapsake//Leapsake ${VERSION}//EN`);

    const [card] = parseVCards(vcf);
    expect(card.name).toEqual({
      firstName: "Mary",
      middleName: "Hatch",
      lastName: "Bailey",
    });
    expect(card.gender).toBe("female");
    expect(card.emails).toEqual([
      { label: "Home", address: "mary@example.com" },
    ]);
    expect(card.phones[0]).toMatchObject({
      label: "Mobile",
      number: "+1 555 0100",
    });
    expect(card.postals[0]).toMatchObject({
      line1: "1 Main St",
      line2: "Apt 4",
      locality: "Springfield",
      country: "US",
    });
    expect(card.birthday).toEqual({ year: 1985, month: 4, day: 12 });
  });

  /**
   * The one artifact that leaves the device must not carry a row the user told
   * the app to forget — and the exclusion has to be transitive, or a live card
   * ends up naming a person the file does not contain. Both fall out of the data
   * layer's structural `deleted_at IS NULL`, which is exactly what this pins.
   */
  it("leaves out a deleted person, and the deleted facts of a live one", async () => {
    const live = await core.people.create(
      { firstName: "Live", lastName: "One" },
      [],
    );
    const gone = await core.people.create(
      { firstName: "Gone", lastName: "Away" },
      [],
    );
    await core.people.softDelete(gone.id);

    const keep = await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: live.id,
      label: "Home",
      address: "keep@example.com",
    });
    const drop = await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: live.id,
      label: "Work",
      address: "drop@example.com",
    });
    await core.contactMethods.emails.softDelete(drop.id);
    void keep;

    const vcf = await exportedVcf();

    expect(parseVCards(vcf)).toHaveLength(1);
    expect(vcf).not.toContain("Gone");
    expect(vcf).not.toContain(gone.id);
    expect(vcf).toContain("keep@example.com");
    expect(vcf).not.toContain("drop@example.com");
  });

  /**
   * An unpublished person exists only as a fact about somebody else, so they are
   * *named* on that person's card and never given one of their own. Both halves
   * matter: dropping them would lose a real fact, and carding them would invent
   * an entity the app does not have.
   */
  it("names an unpublished person on their host's card, with no card of their own", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    // `createWithNewOther` is the only way an unpublished entity comes into
    // being — a name typed into the relationship form that matches nobody.
    // Creating one directly and then relating it would not do: an explicit
    // relationship to an existing person *publishes* them.
    const { other } = await core.relationships.createWithNewOther({
      subjectType: "person",
      subjectId: jane.id,
      otherType: "person",
      otherName: "Unpublished Spouse",
      otherRole: "spouse",
    });

    const vcf = await exportedVcf();
    expect(parseVCards(vcf)).toHaveLength(1);
    expect(unfold(vcf)).toContain(
      "RELATED;VALUE=text;TYPE=spouse;X-LEAPSAKE-ROLE=spouse",
    );
    expect(vcf).toContain("Unpublished Spouse");
    // Named, not carded.
    expect(vcf).not.toContain(`UID:urn:uuid:${other.id}`);
    expect(vcf).not.toContain("FN:Unpublished");
  });

  it("points two published people at each other by uid, over one edge id", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const pete = await core.people.create(
      { firstName: "Pete", lastName: "Wainwright" },
      [],
    );
    const rel = await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "parent",
      bType: "person",
      bId: pete.id,
      bRole: "child",
    });

    const vcf = unfold(await exportedVcf());

    expect(vcf).toContain(`urn:uuid:${pete.id}`);
    expect(vcf).toContain(`urn:uuid:${jane.id}`);
    expect(
      vcf.match(new RegExp(`X-LEAPSAKE-REL-ID=${rel.id}`, "g")),
    ).toHaveLength(2);
  });

  it("gives a pet a card of its own, with its owner and its birthday", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Wainwright" },
      [],
    );
    const jimmy = await core.pets.create({ name: "Jimmy", gender: "male" }, [
      "Pets",
    ]);
    await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "owner",
      bType: "pet",
      bId: jimmy.id,
      bRole: "pet",
    });
    await core.milestones.create({
      kind: "birthday",
      bearerType: "pet",
      bearerId: jimmy.id,
      year: 2019,
      month: 5,
      day: 2,
    });

    const { bytes, counts } = await core.export.archive({
      appVersion: VERSION,
    });
    const vcf = unfold(
      new TextDecoder().decode(unzipSync(bytes)["contacts.vcf"]),
    );

    expect(counts.pets).toBe(1);
    expect(vcf).toContain("KIND:x-pet");
    expect(vcf).toContain(`UID:urn:uuid:${jimmy.id}`);
    expect(vcf).toContain("FN:Jimmy");
    expect(vcf).toContain("BDAY:2019-05-02");
    expect(vcf).toContain("CATEGORIES:Pets");
    // The owner edge, from the pet's side.
    expect(vcf).toContain(`X-LEAPSAKE-ROLE=owner`);
  });

  /**
   * A wedding is borne by the *relationship*, not by either partner, so the
   * increment-1 port (`milestonesFor("person", id)`) could not have seen it at
   * all. It lands on both cards carrying one id.
   */
  it("carries a relationship-borne milestone onto both partners' cards", async () => {
    const ernie = await core.people.create({ firstName: "Ernie" }, []);
    const ruth = await core.people.create({ firstName: "Ruth" }, []);
    const rel = await core.relationships.create({
      aType: "person",
      aId: ernie.id,
      aRole: "spouse",
      bType: "person",
      bId: ruth.id,
      bRole: "spouse",
    });
    const wedding = await core.milestones.create({
      kind: "wedding",
      bearerType: "relationship",
      bearerId: rel.id,
      year: 2011,
      month: 6,
      day: 18,
    });

    const vcf = unfold(await exportedVcf());

    expect(vcf.match(/X-ABLABEL:Wedding/g)).toHaveLength(2);
    expect(
      vcf.match(new RegExp(`X-LEAPSAKE-MILESTONE-ID=${wedding.id}`, "g")),
    ).toHaveLength(2);
    expect(vcf).toContain(`X-LEAPSAKE-MILESTONE-REL=${rel.id}`);
  });

  it("marks the self person", async () => {
    const jane = await core.people.create({ firstName: "Jane" }, []);
    await core.people.create({ firstName: "Harry" }, []);
    await core.self.set(jane.id);

    const vcf = await exportedVcf();
    expect(vcf.match(/X-LEAPSAKE-SELF:TRUE/g)).toHaveLength(1);
  });

  /**
   * An unpublished entity is meant to be reachable only through the one edge it
   * hangs off, so it should have no milestones of its own to lose. If a flow ever
   * makes that possible, this fails and the export has a real gap to answer for.
   */
  it("gives an unpublished person nowhere to keep milestones of their own", async () => {
    const jane = await core.people.create({ firstName: "Jane" }, []);
    const { other } = await core.relationships.createWithNewOther({
      subjectType: "person",
      subjectId: jane.id,
      otherType: "person",
      otherName: "Unpublished Spouse",
      otherRole: "spouse",
    });
    expect(await core.milestones.listForBearer("person", other.id)).toEqual([]);
  });

  it("produces a readable archive for an empty store", async () => {
    const { bytes, counts, filename } = await core.export.archive({
      appVersion: VERSION,
    });
    expect(counts.people).toBe(0);
    expect(counts.pets).toBe(0);
    expect(filename).toMatch(/^leapsake-export-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
      "README.txt",
      "contacts.vcf",
      "data.json",
    ]);
  });
});

/**
 * `data.json` over the real repos — the half of the archive the `.vcf` cannot
 * hold, and the tier that catches a port reading the wrong table. The unit tests
 * prove the *format* against a fake that agrees with them by construction; only
 * here does "the reminders port actually reads `reminders`" get tested, and an
 * export missing everybody's reminders is still a perfectly valid archive.
 */
describe("core.export.archive — data.json", () => {
  it("carries the tables that belong to no card", async () => {
    const violet = await core.people.create({ firstName: "Violet" }, []);
    const harry = await core.people.create({ firstName: "Harry" }, []);

    await core.reminders.create({
      title: "Call @[Violet](person:" + violet.id + ") #urgent",
    });
    await core.gifts.ideas.create(
      {
        title: "Wool socks",
        recipients: [{ party: { type: "person", id: violet.id } }],
      },
      ["Birthday"],
    );
    await core.duplicates.reject(violet.id, harry.id);
    await core.kinship.dismiss(
      "person",
      violet.id,
      "person",
      harry.id,
      "cousin",
    );
    await core.notificationSettings.setPolicy("device-1", {
      mode: "digest",
      deliveryMinute: 480,
      label: "George's laptop",
      platform: "darwin",
    });

    const data = await exportedData();

    expect(data.reminders?.[0]?.title).toContain("Call");
    // The text is the source of truth for both, so each landed in its own table
    // on the way in — and each has to come back out of it.
    expect(data.reminders?.[0]?.tags).toEqual(["urgent"]);
    expect(data.mentions?.[0]).toMatchObject({
      bearerType: "reminder",
      targetType: "person",
      targetId: violet.id,
    });
    expect(data.giftIdeas?.[0]).toMatchObject({
      title: "Wool socks",
      tags: ["Birthday"],
    });
    expect(data.giftRecipients?.[0]?.recipientId).toBe(violet.id);
    expect(data.notADuplicate?.[0]).toMatchObject({
      lowerId: violet.id < harry.id ? violet.id : harry.id,
      higherId: violet.id < harry.id ? harry.id : violet.id,
    });
    expect(data.relationshipDismissals?.[0]).toMatchObject({
      subjectId: violet.id,
      otherId: harry.id,
      role: "cousin",
    });
    expect(data.notificationSettings?.[0]).toMatchObject({
      id: "device-1",
      mode: "digest",
      deliveryMinute: 480,
      label: "George's laptop",
    });
    // A fact about one machine, not a preference: restoring it onto another
    // device would be a lie the app then acts on.
    expect(data.notificationSettings?.[0]).not.toHaveProperty("platform");
  });

  it("carries holiday choices by slug, and no catalog row", async () => {
    await seedHolidayCatalog({ driver });
    const violet = await core.people.create({ firstName: "Violet" }, []);
    const christmas = holidayIdFor("christmas");

    await core.holidays.setObservers(christmas, [
      { bearerType: "person", bearerId: violet.id, observes: true },
    ]);
    await core.holidays.setHidden(holidayIdFor("us-halloween"), true);
    await core.holidays.setObservanceSchedule(christmas, "person", violet.id, [
      { action: "get:gift", offsetDays: 21, enabled: true },
    ]);

    const data = await exportedData();

    // The catalog is read-only and the app reseeds it, so shipping it would
    // bloat every archive with data that regenerates itself. Nothing authors a
    // user holiday yet; the unit tier covers the other half of this filter.
    expect(await createHolidaysRepo(driver).list()).not.toHaveLength(0);
    expect(data.holidays).toEqual([]);

    expect(data.observances?.[0]).toMatchObject({
      holidayId: christmas,
      bearerId: violet.id,
      observes: true,
      holidaySlug: "christmas",
    });
    expect(data.hiddenHolidays?.[0]?.holidaySlug).toBe("us-halloween");
    expect(data.reminderRules?.[0]).toMatchObject({
      bearerType: "observance",
      action: "get:gift",
      offsetDays: 21,
    });
  });

  /**
   * The failure this increment was built around. `mentions`, `not_a_duplicate`
   * and `relationship_dismissals` have no entity repo, so their obvious
   * whole-table read is `listChangedSince(0)` — which carries tombstones on
   * purpose, because sync must propagate them. Reach for it here and rows the
   * user deleted end up in the one artifact that leaves the device, where there
   * is no taking them back.
   */
  it("carries no soft-deleted row from the three tables with no entity repo", async () => {
    const violet = await core.people.create({ firstName: "Violet" }, []);
    const harry = await core.people.create({ firstName: "Harry" }, []);
    const tilly = await core.people.create({ firstName: "Tilly" }, []);
    const bert = await core.people.create({ firstName: "Bert" }, []);

    // A mention, then edited out of the text: its row is tombstoned, not erased.
    const reminder = await core.reminders.create({
      title: `Call @[Violet](person:${violet.id})`,
    });
    expect(await exportedData()).toHaveProperty(
      "mentions.0.targetId",
      violet.id,
    );
    await core.reminders.update(reminder.id, { title: "Call somebody" });

    // A dismissal, then restored.
    await core.kinship.dismiss("person", violet.id, "person", harry.id, null);
    const dismissal = (await exportedData()).relationshipDismissals?.[0];
    if (dismissal === undefined) throw new Error("expected a dismissal");
    await core.kinship.undismiss(dismissal.id);

    // A "not a duplicate" judgment, then made redundant by a merge — which
    // re-points it onto the survivor, sees a self-pair, and tombstones it.
    await core.duplicates.reject(tilly.id, bert.id);
    expect((await exportedData()).notADuplicate).toHaveLength(1);
    await core.people.merge(tilly.id, bert.id);

    const data = await exportedData();
    expect(data.mentions).toEqual([]);
    expect(data.relationshipDismissals).toEqual([]);
    expect(data.notADuplicate).toEqual([]);
  });

  it("counts every data.json row for the line the app shows", async () => {
    await core.reminders.create({ title: "One" });
    await core.reminders.create({ title: "Two" });
    await core.gifts.ideas.create({ title: "Socks" });

    const { counts } = await core.export.archive({ appVersion: VERSION });
    expect(counts.otherRecords).toBe(3);
  });
});

/** Folded lines rejoined, so a golden assertion can span more than 75 octets. */
function unfold(vcf: string): string {
  return vcf.replace(/\r\n /g, "");
}
