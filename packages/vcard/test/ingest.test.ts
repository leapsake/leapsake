import { describe, expect, it } from "vitest";
import type { ParsedContact } from "../src/index.js";
import type { ImportDecision, ImportPorts } from "../src/index.js";
import { ingestContacts } from "../src/index.js";

/** A minimal valid contact; override any field per test. */
function contact(over: Partial<ParsedContact> = {}): ParsedContact {
  return {
    uid: null,
    kind: "individual",
    isSelf: false,
    createdAt: null,
    updatedAt: null,
    name: { firstName: "Jane", middleName: null, lastName: "Wainwright" },
    displayName: "Jane Wainwright",
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
  const birthdays: { bearerType: string; personId: string }[] = [];
  const dates: {
    bearerType: string;
    bearerId: string;
    kind: string;
    note: string | null;
  }[] = [];
  const relateds: {
    ownerType: string;
    personId: string;
    name: string;
    role: string;
  }[] = [];
  const links: {
    id: string;
    ownerType: string;
    ownerId: string;
    otherType: string;
    otherId: string;
    role: string;
    name: string;
  }[] = [];
  const tagged: { type: string; id: string; names: string[] }[] = [];
  const selfs: string[] = [];
  const sources: { sourceId: string; entityId: string | null }[] = [];
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
    addBirthday: async (bearerType, bearerId) => {
      birthdays.push({ bearerType, personId: bearerId });
    },
    addDate: async (bearerType, bearerId, date) => {
      dates.push({ bearerType, bearerId, kind: date.kind, note: date.note });
    },
    addRelated: async (ownerType, ownerId, relation) => {
      relateds.push({
        ownerType,
        personId: ownerId,
        name: relation.name,
        role: relation.role,
      });
    },
    linkExisting: async (ownerType, ownerId, otherType, otherId, relation) => {
      const id = `rel-${++n}`;
      links.push({
        id,
        ownerType,
        ownerId,
        otherType,
        otherId,
        role: relation.role,
        name: relation.name,
      });
      return { id };
    },
    setSelf: async (personId) => {
      selfs.push(personId);
    },
    // Refuses a second link for one id, as the real table's primary key does.
    linkSource: async (sourceId, entity) => {
      if (sources.some((s) => s.sourceId === sourceId)) {
        throw new Error(`already linked: ${sourceId}`);
      }
      sources.push({ sourceId, entityId: entity?.id ?? null });
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
    links,
    sources,
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
    expect(birthdays).toEqual([{ bearerType: "person", personId: "person-1" }]);
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
    expect(birthdays).toEqual([{ bearerType: "person", personId: "person-1" }]);
    expect(dates).toEqual([
      {
        bearerType: "person",
        bearerId: "person-1",
        kind: "anniversary",
        note: null,
      },
    ]);
  });

  // A mononym or an organisation-only card ("Acme Corp", "Zuzu") is what the
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
              name: "Ruth Dakin",
              role: "spouse",
              roleNote: null,
              otherUid: null,
              relationshipId: null,
            },
            {
              name: "Pete",
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
      {
        ownerType: "person",
        personId: "person-1",
        name: "Ruth Dakin",
        role: "spouse",
      },
      {
        ownerType: "person",
        personId: "person-1",
        name: "Pete",
        role: "child",
      },
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
          name: { firstName: "Jimmy", middleName: null, lastName: "" },
          displayName: "Jimmy",
        }),
      },
    ]);
    expect(result.created).toBe(1);
    expect(pets).toEqual([{ id: "pet-1", name: "Jimmy" }]);
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
          name: { firstName: "Jimmy", middleName: null, lastName: "" },
          emails: [{ label: "Home", address: "jimmy@example.com" }],
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
          name: { firstName: "Jimmy", middleName: null, lastName: "" },
          birthday: { year: 2019, month: 4, day: 12 },
          related: [
            {
              name: "William Bailey",
              role: "owner",
              roleNote: null,
              otherUid: null,
              relationshipId: null,
            },
          ],
        }),
      },
    ]);
    expect(birthdays).toEqual([{ bearerType: "pet", personId: "pet-1" }]);
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
          name: { firstName: "Jimmy", middleName: null, lastName: "" },
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
          name: { firstName: "Jimmy", middleName: null, lastName: "" },
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

/** A card referencing another by `UID`, as our own exporter writes a published
 *  relationship: same edge id on both halves, inverse roles. */
function refRelated(
  over: Partial<ParsedContact["related"][number]> = {},
): ParsedContact["related"][number] {
  return {
    name: "Pete Wainwright",
    role: "child",
    roleNote: null,
    otherUid: "pete",
    relationshipId: "edge-1",
    ...over,
  };
}

describe("ingestContacts — edges between two cards", () => {
  /**
   * The assertion 5b exists for. `RELATED` is written on **both** partners'
   * cards, so a naive importer makes two relationships out of one fact; the
   * shared `X-LEAPSAKE-REL-ID` is what says they are halves of the same thing.
   */
  it("writes one relationship for an edge that appears on both cards", async () => {
    const { ports, links, relateds } = makePorts();
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({ uid: "jane", related: [refRelated()] }),
      },
      {
        action: "create",
        contact: contact({
          uid: "pete",
          name: { firstName: "Pete", middleName: null, lastName: "Wainwright" },
          related: [
            refRelated({
              name: "Jane Wainwright",
              role: "mother",
              otherUid: "jane",
            }),
          ],
        }),
      },
    ]);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      ownerType: "person",
      ownerId: "person-1",
      otherType: "person",
      otherId: "person-2",
      role: "child",
    });
    // And no stub was invented for somebody who has a card of their own.
    expect(relateds).toEqual([]);
  });

  it("resolves an edge that points forwards, at a card not yet created", async () => {
    // Jane's card is built first and names Pete, who does not exist yet. Holding
    // the edge until every card is built is what makes card order irrelevant.
    const { ports, links } = makePorts();
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({ uid: "jane", related: [refRelated()] }),
      },
      { action: "create", contact: contact({ uid: "pete" }) },
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      ownerId: "person-1",
      otherId: "person-2",
    });
  });

  it("keeps two genuinely different edges between the same pair", async () => {
    const { ports, links } = makePorts();
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          uid: "jane",
          related: [
            refRelated({ role: "child", relationshipId: "edge-1" }),
            refRelated({ role: "coworker", relationshipId: "edge-2" }),
          ],
        }),
      },
      { action: "create", contact: contact({ uid: "pete" }) },
    ]);
    expect(links.map((l) => l.role)).toEqual(["child", "coworker"]);
  });

  /**
   * The other end was in the file but the user skipped it. The *fact* is still
   * true — this person has a child called Pete Wainwright — so it lands the way a merely
   * named relation does, with the name the parser recovered from the other card.
   * Dropping it would lose a relationship the file plainly states.
   */
  it("falls back to a stub when the other card was not imported", async () => {
    const { ports, links, relateds } = makePorts();
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({ uid: "jane", related: [refRelated()] }),
      },
      { action: "skip", contact: contact({ uid: "pete" }) },
    ]);
    expect(links).toEqual([]);
    expect(relateds).toEqual([
      {
        ownerType: "person",
        personId: "person-1",
        name: "Pete Wainwright",
        role: "child",
      },
    ]);
  });

  it("does not point an edge at a card whose own write rolled back", async () => {
    // `byUid` is only written after a contact's transaction commits, so a failed
    // card is not something an edge can be attached to.
    const { ports, links, relateds } = makePorts("Pete");
    const result = await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({ uid: "jane", related: [refRelated()] }),
      },
      {
        action: "create",
        contact: contact({
          uid: "pete",
          name: { firstName: "Pete", middleName: null, lastName: "Wainwright" },
        }),
      },
    ]);
    expect(result.created).toBe(1);
    expect(links).toEqual([]);
    expect(relateds).toHaveLength(1);
  });

  it("carries a pet's own type onto the edge, both ways", async () => {
    const { ports, links, relateds } = makePorts();
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          uid: "jimmy",
          kind: "pet",
          name: { firstName: "Jimmy", middleName: null, lastName: "" },
          related: [
            refRelated({
              name: "William Bailey",
              role: "owner",
              otherUid: "billy",
            }),
            {
              name: "Dr. Campbell",
              role: "other",
              roleNote: "vet",
              otherUid: null,
              relationshipId: null,
            },
          ],
        }),
      },
      { action: "create", contact: contact({ uid: "billy" }) },
    ]);

    // The bug this guards: `addRelated` used to hardcode `"person"`, so a pet
    // with a named relation failed the whole contact on `holderAllows`.
    expect(relateds[0]).toMatchObject({
      ownerType: "pet",
      name: "Dr. Campbell",
    });
    expect(links[0]).toMatchObject({ ownerType: "pet", otherType: "person" });
  });

  it("records an edge failure against the card that carried it", async () => {
    const { ports } = makePorts();
    ports.linkExisting = async () => {
      throw new Error("edge boom");
    };
    const result = await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({ uid: "jane", related: [refRelated()] }),
      },
      { action: "create", contact: contact({ uid: "pete" }) },
    ]);
    // Both people landed; only the relationship between them did not.
    expect(result.created).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(0);
    expect(result.errors[0].message).toBe("edge boom");
  });
});

/**
 * A milestone the *relationship* bears — the same "one fact, two cards" shape as
 * the edge itself, one level down. A wedding belongs to the marriage rather than
 * to either partner, so it is written on both cards with one
 * `X-LEAPSAKE-MILESTONE-ID`, and it cannot be written until the edge it hangs
 * off exists.
 */
describe("ingestContacts — milestones a relationship bears", () => {
  /** A wedding borne by `edge-1`, as both partners' cards carry it. */
  function wedding(
    over: Partial<ParsedContact["dates"][number]> = {},
  ): ParsedContact["dates"][number] {
    return {
      kind: "wedding",
      label: "Wedding",
      date: { year: 2011, month: 6, day: 18 },
      note: null,
      id: "milestone-1",
      relationshipId: "edge-1",
      ...over,
    };
  }

  /** Two cards that point at each other and both carry the same wedding. */
  function couple(): ImportDecision[] {
    return [
      {
        action: "create",
        contact: contact({
          uid: "jane",
          related: [refRelated({ role: "spouse" })],
          dates: [wedding()],
        }),
      },
      {
        action: "create",
        contact: contact({
          uid: "pete",
          name: { firstName: "Pete", middleName: null, lastName: "Wainwright" },
          related: [
            refRelated({
              name: "Jane Wainwright",
              role: "spouse",
              otherUid: "jane",
            }),
          ],
          dates: [wedding()],
        }),
      },
    ];
  }

  it("writes one wedding for a couple, on the edge the import created", async () => {
    const { ports, dates, links } = makePorts();
    const result = await ingestContacts(ports, couple());
    expect(result.errors).toEqual([]);
    // Not two. The shared `-ID` is what says this is one fact written twice.
    expect(dates).toEqual([
      {
        bearerType: "relationship",
        // The id the import minted, never `edge-1` — that one names a row in
        // the *file*, and nothing in this store has it.
        bearerId: links[0].id,
        kind: "wedding",
        note: null,
      },
    ]);
  });

  it("waits for the edge, whichever card carried the milestone first", async () => {
    // Jane's card is built before Pete exists, so the wedding cannot be written
    // inside her transaction — the marriage does not exist yet.
    const { ports, dates } = makePorts();
    const order: string[] = [];
    const inner = ports.addDate;
    ports.addDate = async (bearerType, bearerId, date) => {
      order.push(`date:${bearerType}`);
      await inner(bearerType, bearerId, date);
    };
    const innerLink = ports.linkExisting;
    ports.linkExisting = async (a, b, c, d, e) => {
      order.push("edge");
      return innerLink(a, b, c, d, e);
    };
    await ingestContacts(ports, couple());
    expect(order).toEqual(["edge", "date:relationship"]);
    expect(dates).toHaveLength(1);
  });

  /**
   * The user unticked one half of the couple. 5b keeps the relationship by
   * inventing an unpublished stub — but a wedding bound to *that* edge would say
   * the marriage survived the skip, when what survived is only the spouse's
   * name. So the date lands on the person who did import, where the user can
   * rebind it if the other half ever arrives.
   */
  it("puts the milestone on the person when the other card was skipped", async () => {
    const { ports, dates, links, relateds } = makePorts();
    const [jane, pete] = couple();
    await ingestContacts(ports, [jane, { ...pete, action: "skip" }]);
    expect(links).toEqual([]);
    expect(relateds).toHaveLength(1); // the stub spouse
    expect(dates).toEqual([
      {
        bearerType: "person",
        bearerId: "person-1",
        kind: "wedding",
        note: null,
      },
    ]);
  });

  /**
   * `kindAllowsBearer` permits only `first-date`, `wedding`, `anniversary`,
   * `met` and `other` on a relationship. A `-REL` on anything else is a
   * malformed card, and writing it anyway is a row `milestoneSchema` refuses —
   * so the entity takes it back rather than the contact failing.
   */
  it("keeps a -REL on a kind no relationship may hold with the person", async () => {
    const { ports, dates } = makePorts();
    const result = await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          dates: [wedding({ kind: "graduation", label: "Graduation" })],
        }),
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(dates).toEqual([
      {
        bearerType: "person",
        bearerId: "person-1",
        kind: "graduation",
        note: null,
      },
    ]);
  });

  /**
   * 🐞 The bug this increment closes. `addDate`/`addBirthday` were keyed by a
   * bare id and core assumed `"person"`, so a pet's birthday committed against a
   * `bearer_id` no person has — and unlike the `addRelated` bug, it did not
   * throw: `listForBearer("pet", …)` simply never found it again.
   */
  it("writes a pet's dates under the pet, not under a person", async () => {
    const { ports, birthdays, dates } = makePorts();
    await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          kind: "pet",
          name: { firstName: "Jimmy", middleName: null, lastName: "" },
          birthday: { year: 2019, month: 4, day: 2 },
          dates: [
            wedding({
              kind: "moved",
              label: "Moved",
              id: null,
              relationshipId: null,
            }),
          ],
        }),
      },
    ]);
    expect(birthdays).toEqual([{ bearerType: "pet", personId: "pet-1" }]);
    expect(dates).toEqual([
      { bearerType: "pet", bearerId: "pet-1", kind: "moved", note: null },
    ]);
  });

  /**
   * The other half of that fix: once the type travels, a kind the bearer may not
   * hold would *throw* and roll back the whole card — the failure shape 5b hit.
   * One milestone is skipped and reported instead, so the pet keeps its name.
   */
  /**
   * A card that rolls back **after** setting work aside. Both the edge and the
   * milestone are held locally until the transaction commits, for the same
   * reason `byUid` is: an entity id from an aborted transaction names no row, so
   * phase 2 must never be handed one.
   */
  it("leaves phase 2 nothing behind when the carrying card rolls back", async () => {
    const { ports, dates, links, relateds } = makePorts();
    // `setSelf` runs last, after the edge and the milestone have been set aside.
    ports.setSelf = async () => {
      throw new Error("self boom");
    };
    // Only Jane holds anything back, so anything phase 2 writes came from her.
    const result = await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          uid: "jane",
          isSelf: true,
          related: [refRelated({ role: "spouse" })],
          dates: [wedding()],
        }),
      },
      { action: "create", contact: contact({ uid: "pete" }) },
    ]);
    expect(result.created).toBe(1);
    expect(result.errors.map((e) => e.message)).toEqual(["self boom"]);
    // Pete landed; nothing at all was written for the edge or the wedding, both
    // of which named a Jane who does not exist.
    expect(links).toEqual([]);
    expect(relateds).toEqual([]);
    expect(dates).toEqual([]);
  });

  it("skips a kind the bearer cannot hold, and still imports the card", async () => {
    const { ports, pets, dates } = makePorts();
    const result = await ingestContacts(ports, [
      {
        action: "create",
        contact: contact({
          kind: "pet",
          name: { firstName: "Jimmy", middleName: null, lastName: "" },
          dates: [
            wedding({
              kind: "anniversary",
              label: "Anniversary",
              id: null,
              relationshipId: null,
            }),
          ],
        }),
      },
    ]);
    expect(result.created).toBe(1);
    expect(pets).toHaveLength(1);
    expect(dates).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      "Skipped a milestone a pet cannot hold: anniversary",
    );
  });
});

describe("ingestContacts — contacts read from an address book", () => {
  const nameless = () =>
    contact({
      name: { firstName: "", middleName: null, lastName: "" },
      displayName: "Joe's Pizza",
    });

  it("links each sourced contact to the entity it became", async () => {
    const { ports, people, sources } = makePorts();
    await ingestContacts(ports, [
      { action: "create", contact: contact(), sourceId: "abc" },
      {
        action: "create",
        contact: contact({
          name: { firstName: "Ernie", middleName: null, lastName: "Bishop" },
        }),
      },
    ]);
    expect(sources).toEqual([{ sourceId: "abc", entityId: people[0].id }]);
  });

  it("remembers a nameless contact as seen, skipped rather than refused", async () => {
    const { ports, people, sources } = makePorts();
    const result = await ingestContacts(ports, [
      { action: "create", contact: nameless(), sourceId: "biz" },
    ]);
    expect(people).toEqual([]);
    expect(result).toMatchObject({ created: 0, skipped: 1, errors: [] });
    expect(sources).toEqual([{ sourceId: "biz", entityId: null }]);
  });

  it("still refuses a nameless contact that has no source to remember it by", async () => {
    const { ports, sources } = makePorts();
    const result = await ingestContacts(ports, [
      { action: "create", contact: nameless() },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(sources).toEqual([]);
  });

  it("does not remember a contact whose write failed", async () => {
    const { ports, sources } = makePorts("Jane");
    const result = await ingestContacts(ports, [
      { action: "create", contact: contact(), sourceId: "abc" },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(sources).toEqual([]);
  });

  it("fails a contact that was already linked, rather than landing it twice", async () => {
    const { ports, sources } = makePorts();
    await ports.linkSource("abc", null);
    const result = await ingestContacts(ports, [
      { action: "create", contact: contact(), sourceId: "abc" },
    ]);
    expect(result.created).toBe(0);
    expect(result.errors[0].message).toBe("already linked: abc");
    expect(sources).toHaveLength(1);
  });
});
