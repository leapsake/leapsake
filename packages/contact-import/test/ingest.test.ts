import { describe, expect, it } from "vitest";
import type { ParsedContact } from "../src/index.js";
import { type ImportPorts, ingestContacts } from "../src/index.js";

/** A minimal valid contact; override any field per test. */
function contact(over: Partial<ParsedContact> = {}): ParsedContact {
  return {
    name: { firstName: "Jane", middleName: null, lastName: "Doe" },
    displayName: "Jane Doe",
    gender: null,
    emails: [],
    phones: [],
    postals: [],
    birthday: null,
    related: [],
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
  const emails: { personId: string; address: string }[] = [];
  const birthdays: { personId: string }[] = [];
  const relateds: { personId: string; name: string; role: string }[] = [];
  let n = 0;

  const ports: ImportPorts = {
    createPerson: async (name) => {
      if (name.firstName === failOn) throw new Error("boom");
      const id = `person-${++n}`;
      people.push({ id, first: name.firstName });
      return { id };
    },
    addEmail: async (personId, email) => {
      emails.push({ personId, address: email.address });
    },
    addPhone: async () => {},
    addPostal: async () => {},
    addBirthday: async (personId) => {
      birthdays.push({ personId });
    },
    addRelated: async (personId, relation) => {
      relateds.push({ personId, name: relation.name, role: relation.role });
    },
    // The fake runs the body directly; a thrown error propagates as a real
    // transaction would abort, so nothing partial is recorded for that contact.
    transaction: async (body) => body(),
  };

  return { ports, people, emails, birthdays, relateds };
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
            { name: "Jen Davis", role: "spouse", roleNote: null },
            { name: "Ben", role: "child", roleNote: null },
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
