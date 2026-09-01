import type { ParsedContact } from "@leapsake/contact-import";
import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Contact import — the write + preview halves that `core.import.*` composes over
 * the real repos. Proves a committed contact lands a person, its contact methods
 * and a birthday milestone; that one bad contact is isolated while the rest
 * commit; and that `preview` flags a contact matching an existing person.
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

function contact(over: Partial<ParsedContact> = {}): ParsedContact {
  return {
    name: { firstName: "Jane", middleName: null, lastName: "Doe" },
    displayName: "Jane Doe",
    gender: null,
    emails: [],
    phones: [],
    postals: [],
    socials: [],
    birthday: null,
    related: [],
    dates: [],
    dropped: [],
    ...over,
  };
}

describe("core.import.commit", () => {
  it("lands a person with contact methods and a birthday milestone", async () => {
    const result = await core.import.commit([
      {
        action: "create",
        contact: contact({
          name: { firstName: "Jane", middleName: "M", lastName: "Doe" },
          gender: "female",
          emails: [{ label: "Home", address: "jane@home.example" }],
          phones: [
            {
              label: "Mobile",
              number: "+1 555 100",
              extension: null,
              country: null,
              smsCapable: true,
            },
          ],
          postals: [
            {
              label: "Home",
              line1: "1 Main St",
              line2: null,
              locality: "Springfield",
              region: "IL",
              postalCode: "62704",
              country: "US",
            },
          ],
          birthday: { year: 1992, month: 3, day: 9 },
        }),
      },
    ]);
    expect(result).toEqual({ created: 1, skipped: 0, errors: [] });

    const people = await core.people.list();
    expect(people).toHaveLength(1);
    const person = people[0];
    expect(person.firstName).toBe("Jane");
    expect(person.middleName).toBe("M");
    expect(person.gender).toBe("female");

    const methods = await core.contactMethods.listForOwner("person", person.id);
    expect(methods.map((m) => m.kind).sort()).toEqual([
      "email",
      "phone",
      "postal",
    ]);

    const milestones = await core.milestones.listForBearer("person", person.id);
    expect(milestones).toHaveLength(1);
    expect(milestones[0].kind).toBe("birthday");
    expect(milestones[0]).toMatchObject({ year: 1992, month: 3, day: 9 });
  });

  it("skips a skip decision and isolates a bad contact", async () => {
    const result = await core.import.commit([
      { action: "create", contact: contact({ displayName: "ok" }) },
      { action: "skip", contact: contact({ displayName: "skipped" }) },
      {
        action: "create",
        // No name at all — the only card the engine still refuses, now that a
        // person may be filed under any one part of a name.
        contact: contact({
          name: { firstName: "", middleName: null, lastName: "" },
        }),
      },
    ]);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(2);
    expect(await core.people.list()).toHaveLength(1);
  });

  // The card the importer used to turn away. Worth an end-to-end check rather
  // than an engine-level one, because the failure it guards against was in the
  // *wiring*: a blank part arrives as `""`, and handing that straight to
  // `people.create` fails the schema's `min(1)` on exactly these cards.
  it("imports a mononym card, storing the absent surname as null", async () => {
    const result = await core.import.commit([
      {
        action: "create",
        contact: contact({
          name: { firstName: "Cher", middleName: null, lastName: "" },
        }),
      },
    ]);
    expect(result).toMatchObject({ created: 1, errors: [] });

    const [person] = await core.people.list();
    expect(person.firstName).toBe("Cher");
    expect(person.lastName).toBeNull();
  });

  it("reconciles a birthday reminder for an imported birthday", async () => {
    // A birthday within the lead window should materialize a system reminder.
    const today = new Date();
    const soon = new Date(today.getTime() + 3 * 86_400_000);
    await core.import.commit([
      {
        action: "create",
        contact: contact({
          birthday: {
            year: null,
            month: soon.getMonth() + 1,
            day: soon.getDate(),
          },
        }),
      },
    ]);
    const reminders = await core.reminders.list();
    expect(reminders.some((r) => r.source === "system")).toBe(true);
  });
});

describe("core.import.preview", () => {
  it("flags a parsed contact that matches an existing person", async () => {
    await core.people.create({ firstName: "Jane", lastName: "Doe" }, []);

    const rows = await core.import.preview([
      contact({
        name: { firstName: "Jane", middleName: null, lastName: "Doe" },
      }),
      contact({
        name: { firstName: "Nobody", middleName: null, lastName: "New" },
      }),
    ]);

    expect(rows[0].index).toBe(0);
    expect(rows[0].matches).toHaveLength(1);
    expect(rows[0].matches[0].name).toBe("Jane Doe");
    expect(rows[0].matches[0].reasons).toContain('Same name "Jane Doe"');
    expect(rows[1].matches).toHaveLength(0);
  });
});

// A card that names a spouse is claiming a *name*, not a person — so that is
// what it imports as: someone attached to the contact, out of the catalog until
// they turn out to be more than a name.
describe("core.import.commit — named relations", () => {
  it("attaches a named relation as an unpublished person", async () => {
    await core.import.commit([
      {
        action: "create",
        contact: contact({
          name: { firstName: "Sam", middleName: null, lastName: "Carter" },
          related: [{ name: "Jen Davis", role: "spouse", roleNote: null }],
        }),
      },
    ]);

    // Only Sam is in the catalog.
    const listed = await core.people.list();
    expect(listed.map((p) => p.firstName)).toEqual(["Sam"]);

    // Jen is on his page, as the one edge that is her whole existence.
    const neighbors = await core.relationships.listForEntity(
      "person",
      listed[0].id,
    );
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]).toMatchObject({
      otherLabel: "Jen Davis",
      otherStanding: "unpublished",
      otherRole: "spouse",
    });
  });

  it("carries an unmapped role through as its note", async () => {
    await core.import.commit([
      {
        action: "create",
        contact: contact({
          related: [{ name: "Ada", role: "other", roleNote: "muse" }],
        }),
      },
    ]);

    const [jane] = await core.people.list();
    const [edge] = await core.relationships.listForEntity("person", jane.id);
    expect(edge).toMatchObject({ otherRole: "other", otherRoleNote: "muse" });
  });

  it("takes the relations with the contact when it is deleted", async () => {
    await core.import.commit([
      {
        action: "create",
        contact: contact({
          related: [
            { name: "Jen Davis", role: "spouse", roleNote: null },
            { name: "Ben", role: "child", roleNote: null },
          ],
        }),
      },
    ]);
    const [jane] = await core.people.list();

    await core.people.softDelete(jane.id);

    expect(await core.people.list()).toEqual([]);
  });
});
