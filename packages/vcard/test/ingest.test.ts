import { describe, expect, it } from "vitest";
import type { ParsedContact } from "../src/index.js";
import { type ImportPorts, ingestContacts } from "../src/index.js";

/** A minimal valid contact; override any field per test. */
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

/**
 * An in-memory {@link ImportPorts} recording what the engine wrote — the point of
 * the separate package: exercise ingest with no sqlite driver. `failOn` makes a
 * person's create throw to test per-contact isolation.
 */
function makePorts(failOn?: string) {
  const people: { id: string; first: string }[] = [];
  const pets: { id: string; name: string }[] = [];
  const emails: { personId: string; address: string }[] = [];
  const birthdays: { personId: string }[] = [];
  const dates: { personId: string; kind: string }[] = [];
  const relateds: { personId: string; name: string; role: string }[] = [];
  const tagged: { type: string; id: string; names: string[] }[] = [];
  const selfs: string[] = [];
  let n = 0;

  const ports: ImportPorts = {
    createPerson: async (name) => {
      if (name.firstName === failOn) throw new Error("boom");
      const id = `person-${++n}`;
      people.push({ id, first: name.firstName });
      return { id };
    },
    createPet: async (name) => {
      if (name.firstName === failOn) throw new Error("boom");
      const id = `pet-${++n}`;
      pets.push({ id, name: name.firstName });
      return { id };
    },
    addTags: async (entityType, entityId, names) => {
      tagged.push({ type: entityType, id: entityId, names });
    },
    addEmail: async (personId, email) => {
      emails.push({ personId, address: email.address });
    },
    addPhone: async () => {},
    addPostal: async () => {},
    addSocial: async () => {},
    addBirthday: async (personId) => {
      birthdays.push({ personId });
    },
    addDate: async (personId, date) => {
      dates.push({ personId, kind: date.kind });
    },
    addRelated: async (personId, relation) => {
      relateds.push({ personId, name: relation.name, role: relation.role });
    },
    setSelf: async (personId) => {
      selfs.push(personId);
    },
    // The fake runs the body directly; a thrown error propagates as a real
    // transaction would abort, so nothing partial is recorded for that contact.
    transaction: async (body) => body(),
  };

  return {
    ports,
    people,
    pets,
    emails,
    birthdays,
    dates,
    relateds,
    tagged,
    selfs,
  };
}

describe("ingestContacts", () => {
  it("creates chosen contacts and skips the rest", async () => {
    const { ports, people } = makePorts();
    const result = await ingestContacts(ports, [
      { action: "create", contact: contact({ displayName: "A" }) },
      { action: "skip", contact: contact({ displayName: "B" }) },
      { action: "create", contact: contact({ displayName: "C" }) },
    ]);
    expect(result).toEqual({ created: 2, skipped: 1, errors: [] });
    expect(people).toHaveLength(2);
  });

  it("fans contact methods and a birthday onto the right person", async () => {
    const { ports, emails, birthdays } = makePorts();
    const result = await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          emails: [{ label: "Home", address: "jane@x.com" }],
          birthday: { year: null, month: 3, day: 9 },
        }),
      },
    ]);
    expect(result.created).toBe(1);
    expect(emails).toEqual([{ personId: "person-1", address: "jane@x.com" }]);
    expect(birthdays).toEqual([{ personId: "person-1" }]);
  });

  it("writes a card's other dates alongside its birthday", async () => {
    const { ports, birthdays, dates } = makePorts();
    const result = await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          birthday: { year: null, month: 3, day: 9 },
          dates: [
            {
              kind: "anniversary",
              label: "Anniversary",
              date: { year: 2015, month: 6, day: 20 },
              note: null,
              id: null,
              relationshipId: null,
            },
          ],
        }),
      },
    ]);
    expect(result.created).toBe(1);
    expect(birthdays).toEqual([{ personId: "person-1" }]);
    expect(dates).toEqual([{ personId: "person-1", kind: "anniversary" }]);
  });

  // A mononym or an organisation-only card ("Acme Corp", "Cher") is what the
  // parser produces when it refuses to invent a surname. These used to be
  // turned away here — the only thing stopping them was the Person schema
  // demanding both names — and now they import as they came.
  it("imports a card with only a first name", async () => {
    const { ports, people } = makePorts();
    const result = await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          name: { firstName: "Acme", middleName: null, lastName: "" },
        }),
      },
    ]);
    expect(result).toEqual({ created: 1, skipped: 0, errors: [] });
    expect(people).toHaveLength(1);
  });

  it("refuses a card with no name at all", async () => {
    const { ports, people } = makePorts();
    const result = await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          name: { firstName: "", middleName: null, lastName: "" },
        }),
      },
    ]);
    expect(result.created).toBe(0);
    expect(people).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/needs a name/i);
  });

  it("fans a card's named relations onto the person it created", async () => {
    const { ports, relateds } = makePorts();
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          related: [
            {
              name: "Jen Davis",
              role: "spouse",
              roleNote: null,
              otherUid: null,
              relationshipId: null,
            },
            {
              name: "Ben",
              role: "child",
              roleNote: null,
              otherUid: null,
              relationshipId: null,
            },
          ],
        }),
      },
    ]);
    expect(relateds).toEqual([
      { personId: "person-1", name: "Jen Davis", role: "spouse" },
      { personId: "person-1", name: "Ben", role: "child" },
    ]);
  });

  it("isolates a failing contact so the others still import", async () => {
    const { ports, people } = makePorts("Bad");
    const result = await ingestContacts(ports, [
      { action: "create", contact: contact({ displayName: "ok-1" }) },
      {
        action: "create",
        contact: contact({
          name: { firstName: "Bad", middleName: null, lastName: "Row" },
        }),
      },
      { action: "create", contact: contact({ displayName: "ok-2" }) },
    ]);
    expect(result.created).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(1);
    expect(result.errors[0].message).toBe("boom");
    expect(people.map((p) => p.first)).toEqual(["Jane", "Jane"]);
  });
});

describe("ingestContacts — pets, tags and the self claim", () => {
  it("sends a pet card to createPet and never to createPerson", async () => {
    const { ports, people, pets } = makePorts();
    const result = await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          kind: "pet",
          name: { firstName: "Rex", middleName: null, lastName: "" },
          displayName: "Rex",
        }),
      },
    ]);
    expect(result.created).toBe(1);
    expect(pets).toEqual([{ id: "pet-1", name: "Rex" }]);
    expect(people).toEqual([]);
  });

  /**
   * A pet has no contact methods by construction — a contact method's owner is a
   * person or a household — so a `KIND:x-pet` card carrying them is malformed.
   * The fan-out is skipped rather than written against a pet id, which is the
   * failure that would otherwise reach the database.
   */
  it("skips the contact-method fan-out for a pet", async () => {
    const { ports, emails } = makePorts();
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          kind: "pet",
          name: { firstName: "Rex", middleName: null, lastName: "" },
          emails: [{ label: "Home", address: "rex@example.com" }],
        }),
      },
    ]);
    expect(emails).toEqual([]);
  });

  it("still gives a pet its milestones and relationships", async () => {
    const { ports, birthdays, relateds } = makePorts();
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          kind: "pet",
          name: { firstName: "Rex", middleName: null, lastName: "" },
          birthday: { year: 2019, month: 4, day: 12 },
          related: [
            {
              name: "Jane Doe",
              role: "owner",
              roleNote: null,
              otherUid: null,
              relationshipId: null,
            },
          ],
        }),
      },
    ]);
    expect(birthdays).toEqual([{ personId: "pet-1" }]);
    expect(relateds).toHaveLength(1);
  });

  it("applies tags once, under the entity's own type", async () => {
    const { ports, tagged } = makePorts();
    await ingestContacts(ports, [
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
    expect(tagged).toEqual([
      { type: "person", id: "person-1", names: ["Family", "Work"] },
      { type: "pet", id: "pet-2", names: ["Pets"] },
    ]);
  });

  it("does not call addTags for a card with no tags", async () => {
    const { ports, tagged } = makePorts();
    await ingestContacts(ports, [{ action: "create", contact: contact() }]);
    expect(tagged).toEqual([]);
  });

  /**
   * `isSelf` arriving true is the *user's* decision, not the card's claim: the
   * review starts every self-claiming card opted out and only sets this if the
   * user ticks it. The engine's job is just to honour what comes back.
   */
  it("sets self only for a contact whose isSelf survived the review", async () => {
    const { ports, selfs } = makePorts();
    await ingestContacts(ports, [
      { action: "create", contact: contact({ isSelf: true }) },
      { action: "create", contact: contact({ isSelf: false }) },
      // Skipped, so it is never created — and so can never become self.
      { action: "skip", contact: contact({ isSelf: true }) },
    ]);
    expect(selfs).toEqual(["person-1"]);
  });

  it("never points self at a pet", async () => {
    const { ports, selfs } = makePorts();
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          kind: "pet",
          isSelf: true,
          name: { firstName: "Rex", middleName: null, lastName: "" },
        }),
      },
    ]);
    expect(selfs).toEqual([]);
  });

  it("does not set self for a contact that failed to import", async () => {
    const { ports, selfs } = makePorts("Bad");
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          isSelf: true,
          name: { firstName: "Bad", middleName: null, lastName: "Row" },
        }),
      },
    ]);
    expect(selfs).toEqual([]);
  });
});
