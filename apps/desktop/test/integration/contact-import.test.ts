import type { ParsedContact, ParsedRelated } from "@leapsake/vcard";
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
    uid: null,
    kind: "individual",
    isSelf: false,
    createdAt: null,
    updatedAt: null,
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
    tags: [],
    dropped: [],
    ...over,
  };
}

/** One `RELATED` a card names, with the fields only our own writer fills. */
function related(over: Partial<ParsedRelated> = {}): ParsedRelated {
  return {
    name: "Jen Davis",
    role: "spouse",
    roleNote: null,
    otherUid: null,
    relationshipId: null,
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

// Mobile's address-book sync, over the real table: what it relies on is that a
// link is written with the person, and is still there after the person is gone.
describe("core.import.commit — contacts read from the phone", () => {
  it("keeps a contact's link after its person is deleted", async () => {
    await core.import.commit([
      { action: "create", contact: contact(), sourceId: "abc" },
    ]);
    const [person] = await core.people.list();
    await core.people.softDelete(person.id);
    expect(await core.deviceContacts.linkedIds()).toEqual(["abc"]);
  });

  it("rolls back a second import of the same contact", async () => {
    await core.import.commit([
      { action: "create", contact: contact(), sourceId: "abc" },
    ]);
    const again = await core.import.commit([
      { action: "create", contact: contact(), sourceId: "abc" },
    ]);
    expect(again.created).toBe(0);
    expect(again.errors).toHaveLength(1);
    expect(await core.people.list()).toHaveLength(1);
  });

  it("starts switched off, and stays on once switched on", async () => {
    expect(await core.deviceContacts.getSyncEnabled()).toBe(false);
    await core.deviceContacts.setSyncEnabled(true);
    expect(await createCore(driver).deviceContacts.getSyncEnabled()).toBe(true);
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

  /**
   * The `UID` half — an identity rather than a resemblance, and the thing that
   * stops a user re-importing their own export from getting a second copy of
   * everyone. Our exporter writes each entity's own id as the card's `UID`, so
   * these are exactly the cards `writeVCards` produces.
   */
  it("reports a card whose UID names a stored person as already stored", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );

    const [row] = await core.import.preview([contact({ uid: jane.id })]);

    expect(row.alreadyStored).toEqual({
      type: "person",
      id: jane.id,
      name: "Jane Doe",
    });
  });

  it("reports a pet card too, which the duplicate detector cannot", async () => {
    const rex = await core.pets.create({ name: "Rex" }, []);

    const [row] = await core.import.preview([
      contact({
        uid: rex.id,
        kind: "pet",
        name: { firstName: "Rex", middleName: null, lastName: "" },
      }),
    ]);

    expect(row.alreadyStored).toEqual({ type: "pet", id: rex.id, name: "Rex" });
  });

  it("reports nothing for a foreign card, or one naming an id we do not hold", async () => {
    const rows = await core.import.preview([
      contact(),
      contact({ uid: "9f1c4b3e-1c4b-4f2a-9d3e-6a7b8c9d0e1f" }),
    ]);

    expect(rows[0].alreadyStored).toBeNull();
    expect(rows[1].alreadyStored).toBeNull();
  });

  it("reports nothing for someone the user deleted", async () => {
    // Re-importing a backup after deleting somebody should bring them back as
    // new, not clash with their tombstone — which is what `get` filtering
    // soft-deleted rows buys, stated here so it is not "fixed" later.
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    await core.people.softDelete(jane.id);

    const [row] = await core.import.preview([contact({ uid: jane.id })]);
    expect(row.alreadyStored).toBeNull();
  });
});

/**
 * The card-identity half of `plans/export.md` → 5a: what a card of **our own**
 * carries beyond a name, and what the importer does with it. Every one of these
 * was silently discarded until the parser learned to read it.
 */
describe("core.import.commit — pets, tags and the self claim", () => {
  it("lands a KIND:x-pet card as a pet, not a person", async () => {
    await core.import.commit([
      {
        action: "create",
        contact: contact({
          kind: "pet",
          name: { firstName: "Rex", middleName: null, lastName: "" },
          displayName: "Rex",
        }),
      },
    ]);

    const pets = await core.pets.list();
    expect(pets.map((p) => p.name)).toEqual(["Rex"]);
    expect(await core.people.list()).toHaveLength(0);
  });

  it("names a pet from the surname slot when that is all the card filled", async () => {
    // `N:Rex;;;;` with no given name — not what our writer produces, but what
    // `deriveName` yields for a hand-made card, and `petSchema` would otherwise
    // refuse it mid-batch for having an empty name.
    const result = await core.import.commit([
      {
        action: "create",
        contact: contact({
          kind: "pet",
          name: { firstName: "", middleName: null, lastName: "Rex" },
          displayName: "Rex",
        }),
      },
    ]);

    expect(result).toMatchObject({ created: 1, errors: [] });
    expect((await core.pets.list()).map((p) => p.name)).toEqual(["Rex"]);
  });

  it("applies a card's CATEGORIES as tags, on a person and on a pet alike", async () => {
    await core.import.commit([
      { action: "create", contact: contact({ tags: ["Family", "Work"] }) },
      {
        action: "create",
        contact: contact({
          kind: "pet",
          name: { firstName: "Rex", middleName: null, lastName: "" },
          tags: ["Pets"],
        }),
      },
    ]);

    const [person] = await core.people.list();
    const [pet] = await core.pets.list();
    expect(
      (await core.tags.listForPerson(person.id)).map((t) => t.name),
    ).toEqual(["Family", "Work"]);
    expect((await core.tags.listForPet(pet.id)).map((t) => t.name)).toEqual([
      "Pets",
    ]);
  });

  /**
   * A known and deliberate limit, pinned so the writer's careful per-tag comma
   * escaping is not later mistaken for a promise the store can keep.
   *
   * `parseTagNames` treats **every** non-alphanumeric character as a separator,
   * which is the single chokepoint keeping spaces out of stored tag names. So a
   * foreign card's `CATEGORIES:Close friends` becomes two tags. This costs our
   * own round trip nothing — a stored name went through the same function and
   * can never contain a space to begin with — but a foreign card is where it
   * shows, and that is worth knowing rather than discovering.
   */
  it("splits a foreign card's multi-word category, as tag names always are", async () => {
    await core.import.commit([
      { action: "create", contact: contact({ tags: ["Close friends"] }) },
    ]);

    const [person] = await core.people.list();
    expect(
      (await core.tags.listForPerson(person.id)).map((t) => t.name),
    ).toEqual(["Close", "friends"]);
  });

  it("keeps a social profile's opaque platform user id", async () => {
    // Unrecoverable from the handle, which is why the writer emits it — and
    // why the port dropping it would have made the backup lossy in a way no
    // round-trip test in `@leapsake/vcard` could see.
    await core.import.commit([
      {
        action: "create",
        contact: contact({
          socials: [
            {
              label: "Personal",
              platform: "x",
              handle: "janedoe",
              url: "https://x.com/janedoe",
              platformUserId: "1442901",
            },
          ],
        }),
      },
    ]);

    const [person] = await core.people.list();
    const methods = await core.contactMethods.listForOwner("person", person.id);
    const social = methods.find((m) => m.kind === "social");
    expect(social?.kind === "social" && social.method.platformUserId).toBe(
      "1442901",
    );
  });

  it("points the self pointer at a contact the user agreed is them", async () => {
    await core.import.commit([
      { action: "create", contact: contact({ isSelf: true }) },
    ]);

    const [person] = await core.people.list();
    expect((await core.self.get())?.personId).toBe(person.id);
  });

  it("leaves the self pointer alone when no contact claims it", async () => {
    await core.import.commit([{ action: "create", contact: contact() }]);
    expect(await core.self.get()).toBeUndefined();
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
          related: [related({ name: "Jen Davis", role: "spouse" })],
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
          related: [related({ name: "Ada", role: "other", roleNote: "muse" })],
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
            related({ name: "Jen Davis", role: "spouse" }),
            related({ name: "Ben", role: "child" }),
          ],
        }),
      },
    ]);
    const [jane] = await core.people.list();

    await core.people.softDelete(jane.id);

    expect(await core.people.list()).toEqual([]);
  });
});

/**
 * The graph half of `plans/export.md` → 5, increment 5b: a `RELATED` that points
 * at another card rather than naming somebody. Every one of these used to reach
 * the store as a pair of unpublished stubs, or not at all.
 */
describe("core.import.commit — edges between two cards", () => {
  const JANE = "aaaaaaaa-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
  const BEN = "bbbbbbbb-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
  const EDGE = "dddddddd-1c4b-4f2a-9d3e-6a7b8c9d0e1f";

  /** The two halves our own exporter writes for one published relationship. */
  const pair = () => [
    {
      action: "create" as const,
      contact: contact({
        uid: JANE,
        related: [
          related({
            name: "Ben Doe",
            role: "son",
            otherUid: BEN,
            relationshipId: EDGE,
          }),
        ],
      }),
    },
    {
      action: "create" as const,
      contact: contact({
        uid: BEN,
        name: { firstName: "Ben", middleName: null, lastName: "Doe" },
        displayName: "Ben Doe",
        related: [
          related({
            name: "Jane Doe",
            role: "mother",
            otherUid: JANE,
            relationshipId: EDGE,
          }),
        ],
      }),
    },
  ];

  it("joins the two published people, with no stub and no duplicate edge", async () => {
    const result = await core.import.commit(pair());
    expect(result).toMatchObject({ created: 2, errors: [] });

    // Two people, both in the catalog — not one person and one stub.
    const listed = await core.people.list();
    expect(listed.map((p) => p.firstName).sort()).toEqual(["Ben", "Jane"]);

    // One edge, seen from both ends — the shared `X-LEAPSAKE-REL-ID` is what
    // stops the reciprocal half becoming a second relationship.
    const jane = listed.find((p) => p.firstName === "Jane")!;
    const ben = listed.find((p) => p.firstName === "Ben")!;
    const fromJane = await core.relationships.listForEntity("person", jane.id);
    const fromBen = await core.relationships.listForEntity("person", ben.id);
    expect(fromJane).toHaveLength(1);
    expect(fromBen).toHaveLength(1);
    expect(fromJane[0].relationshipId).toBe(fromBen[0].relationshipId);
  });

  it("keeps the exact role, rather than the standard one it was written as", async () => {
    // `son` and `mother` go out as `TYPE=child`/`TYPE=parent`, which is all a
    // standards consumer can act on. Reading `X-LEAPSAKE-ROLE` is what brings
    // the gendered role home.
    await core.import.commit(pair());

    const listed = await core.people.list();
    const jane = listed.find((p) => p.firstName === "Jane")!;
    const [edge] = await core.relationships.listForEntity("person", jane.id);
    expect(edge).toMatchObject({
      otherLabel: "Ben Doe",
      otherStanding: "published",
      otherRole: "son",
    });
  });

  it("falls back to a stub when the user skipped the other card", async () => {
    const [janeDecision, benDecision] = pair();
    await core.import.commit([
      janeDecision,
      { ...benDecision, action: "skip" },
    ]);

    const listed = await core.people.list();
    expect(listed.map((p) => p.firstName)).toEqual(["Jane"]);

    // The fact survives, with the name recovered from the card that was skipped.
    const [edge] = await core.relationships.listForEntity(
      "person",
      listed[0].id,
    );
    expect(edge).toMatchObject({
      otherLabel: "Ben Doe",
      otherStanding: "unpublished",
      otherRole: "son",
    });
  });

  /**
   * The regression that arrived with 5a and is fixed here: pets reach
   * `addRelated` too, and it hardcoded `aType: "person"` — so `holderAllows`
   * refused the row and the **whole pet card** failed to import.
   */
  it("writes a pet's own relations against the pet, not against a person", async () => {
    const REX = "cccccccc-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
    const result = await core.import.commit([
      {
        action: "create",
        contact: contact({
          uid: REX,
          kind: "pet",
          name: { firstName: "Rex", middleName: null, lastName: "" },
          displayName: "Rex",
          related: [
            related({ name: "Jane Doe", role: "owner", otherUid: JANE }),
            related({ name: "Sam Vet", role: "other", roleNote: "vet" }),
          ],
        }),
      },
      { action: "create", contact: contact({ uid: JANE }) },
    ]);
    expect(result).toMatchObject({ created: 2, errors: [] });

    const [rex] = await core.pets.list();
    const edges = await core.relationships.listForEntity("pet", rex.id);
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.otherRole).sort()).toEqual(["other", "owner"]);
    // The owner is the real published person, not a second stub of her.
    const owner = edges.find((e) => e.otherRole === "owner")!;
    expect(owner).toMatchObject({
      otherLabel: "Jane Doe",
      otherStanding: "published",
    });
  });
});

/**
 * The milestone half of the same story, over the real repos — the assertions the
 * pure tier's fake ports cannot make, because what went wrong before was *which
 * row the database ended up holding* rather than which port was called.
 */
describe("core.import.commit — milestones", () => {
  const JANE = "aaaaaaaa-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
  const BEN = "bbbbbbbb-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
  const EDGE = "dddddddd-1c4b-4f2a-9d3e-6a7b8c9d0e1f";
  const WEDDING = "eeeeeeee-1c4b-4f2a-9d3e-6a7b8c9d0e1f";

  /** A wedding borne by `EDGE`, exactly as both partners' cards carry it. */
  const wedding = () => ({
    kind: "wedding" as const,
    label: "Wedding",
    date: { year: 2011, month: 6, day: 18 },
    note: "at the lighthouse",
    id: WEDDING,
    relationshipId: EDGE,
  });

  const spouses = () => [
    {
      action: "create" as const,
      contact: contact({
        uid: JANE,
        related: [
          related({ name: "Ben Doe", otherUid: BEN, relationshipId: EDGE }),
        ],
        dates: [wedding()],
      }),
    },
    {
      action: "create" as const,
      contact: contact({
        uid: BEN,
        name: { firstName: "Ben", middleName: null, lastName: "Doe" },
        displayName: "Ben Doe",
        related: [
          related({ name: "Jane Doe", otherUid: JANE, relationshipId: EDGE }),
        ],
        dates: [wedding()],
      }),
    },
  ];

  it("lands one wedding, borne by the marriage rather than by either partner", async () => {
    const result = await core.import.commit(spouses());
    expect(result).toMatchObject({ created: 2, errors: [] });

    const listed = await core.people.list();
    const jane = listed.find((p) => p.firstName === "Jane")!;
    const [edge] = await core.relationships.listForEntity("person", jane.id);

    // On the edge, once — not once per card, and not on either person.
    const onEdge = await core.milestones.listForBearer(
      "relationship",
      edge.relationshipId,
    );
    expect(onEdge).toHaveLength(1);
    expect(onEdge[0]).toMatchObject({
      kind: "wedding",
      year: 2011,
      month: 6,
      day: 18,
      note: "at the lighthouse",
    });
    // The file's own milestone id is a matching key, not a row id — writing it
    // back verbatim is a restore (`plans/export.md` → 6).
    expect(onEdge[0].id).not.toBe(WEDDING);

    const ben = listed.find((p) => p.firstName === "Ben")!;
    expect(await core.milestones.listForBearer("person", jane.id)).toEqual([]);
    expect(await core.milestones.listForBearer("person", ben.id)).toEqual([]);
  });

  it("keeps the wedding on the person when the other card was skipped", async () => {
    const [jane, ben] = spouses();
    const result = await core.import.commit([
      jane,
      { ...ben, action: "skip" as const },
    ]);
    expect(result).toMatchObject({ created: 1, errors: [] });

    const [person] = await core.people.list();
    const own = await core.milestones.listForBearer("person", person.id);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      kind: "wedding",
      note: "at the lighthouse",
    });
  });

  /**
   * 🐞 The bug increment 5c closes, and the read that proves it. Core hardcoded
   * `bearerType: "person"`, so a pet's birthday committed against a `bearer_id`
   * no person has — and it did **not** throw, because
   * `kindAllowsBearer("birthday", "person")` is true. The row was simply never
   * findable again. Our own exporter writes exactly this card.
   */
  it("files a pet's birthday under the pet, where it can be found again", async () => {
    await core.import.commit([
      {
        action: "create",
        contact: contact({
          kind: "pet",
          name: { firstName: "Rex", middleName: null, lastName: "" },
          displayName: "Rex",
          birthday: { year: 2019, month: 4, day: 2 },
        }),
      },
    ]);

    const [rex] = await core.pets.list();
    const onPet = await core.milestones.listForBearer("pet", rex.id);
    expect(onPet).toHaveLength(1);
    expect(onPet[0]).toMatchObject({ kind: "birthday", year: 2019 });
    // The shape of the old bug: the row used to be here instead, aimed at an id
    // no person has.
    expect(await core.milestones.listForBearer("person", rex.id)).toEqual([]);
  });

  it("carries an other-kind milestone's note, which is its whole label", async () => {
    await core.import.commit([
      {
        action: "create",
        contact: contact({
          dates: [
            {
              kind: "other",
              label: "Beach house closing",
              date: { year: 2024, month: 9, day: 1 },
              note: "Beach house closing",
              id: null,
              relationshipId: null,
            },
          ],
        }),
      },
    ]);

    const [person] = await core.people.list();
    const own = await core.milestones.listForBearer("person", person.id);
    expect(own[0]).toMatchObject({
      kind: "other",
      note: "Beach house closing",
    });
  });
});
