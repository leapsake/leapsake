import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { roleDefs } from "@leapsake/schema";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let cleanup: () => void;
let core: CoreApi;

beforeEach(async () => {
  let driver: SqliteDriver;
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  core = createCore(driver);
});

afterEach(() => {
  cleanup();
});

describe("views.entityList / views.candidates", () => {
  it("merges people and pets and sorts by display label", async () => {
    await core.people.create({ firstName: "Zoe", lastName: "Ng" }, []);
    await core.people.create({ firstName: "Amy", lastName: "Lo" }, []);
    await core.pets.create({ name: "Rex" }, []);

    const rows = await core.views.entityList();
    expect(rows.map((r) => r.label)).toEqual(["Amy Lo", "Rex", "Zoe Ng"]);
    expect(rows.map((r) => r.type)).toEqual(["person", "pet", "person"]);
  });

  it("offers every entity as a candidate but excludes the subject", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const rex = await core.pets.create({ name: "Rex" }, []);

    const all = await core.views.candidates();
    expect(all.map((c) => c.id).toSorted()).toEqual(
      [jane.id, rex.id].toSorted(),
    );

    const excludingJane = await core.views.candidates({
      type: "person",
      id: jane.id,
    });
    expect(excludingJane.map((c) => c.id)).toEqual([rex.id]);
  });
});

describe("views.person / views.pet", () => {
  it("bundles a person with tags, gender, neighbors, timeline, and contacts", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe", gender: "female" },
      ["Friend"],
    );
    const john = await core.people.create(
      { firstName: "John", lastName: "Doe" },
      [],
    );
    await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "parent",
      bType: "person",
      bId: john.id,
      bRole: "child",
    });
    await core.milestones.create({
      kind: "birthday",
      subjectType: "person",
      subjectId: jane.id,
      year: 1990,
      month: 3,
      day: 9,
    });
    await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: jane.id,
      label: "home",
      address: "jane@example.com",
    });

    const view = await core.views.person(jane.id);
    expect(view).not.toBeNull();
    expect(view?.person.id).toBe(jane.id);
    expect(view?.tags.map((t) => t.name)).toEqual(["Friend"]);
    expect(view?.gender).toEqual({ value: "female", origin: "explicit" });
    expect(view?.relationships.map((n) => n.otherId)).toEqual([john.id]);
    expect(view?.timeline).toHaveLength(1);
    expect(view?.contactMethods).toHaveLength(1);
  });

  it("returns null for a missing person", async () => {
    expect(await core.views.person(crypto.randomUUID())).toBeNull();
  });

  it("bundles a pet without a contact-methods section", async () => {
    const rex = await core.pets.create({ name: "Rex" }, ["Household"]);
    const view = await core.views.pet(rex.id);
    expect(view?.pet.id).toBe(rex.id);
    expect(view?.tags.map((t) => t.name)).toEqual(["Household"]);
    expect(view && "contactMethods" in view).toBe(false);
  });
});

describe("views.relationship / views.relationshipPartners", () => {
  it("labels the edge from both ends and resolves each partner's role label", async () => {
    const john = await core.people.create(
      { firstName: "John", lastName: "Doe" },
      [],
    );
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const rel = await core.relationships.create({
      aType: "person",
      aId: john.id,
      aRole: "husband",
      bType: "person",
      bId: jane.id,
      bRole: "wife",
    });

    const view = await core.views.relationship(rel.id);
    expect(view?.title).toBe("John Doe & Jane Doe");
    expect(view?.partners).toEqual([
      {
        type: "person",
        id: john.id,
        label: "John Doe",
        roleLabel: roleDefs.husband.label,
      },
      {
        type: "person",
        id: jane.id,
        label: "Jane Doe",
        roleLabel: roleDefs.wife.label,
      },
    ]);

    const partners = await core.views.relationshipPartners(rel.id);
    expect(partners?.partners.map((p) => p.role)).toEqual(["husband", "wife"]);
    expect(partners?.title).toBe("John Doe & Jane Doe");
  });
});

describe("views.relationshipForSubject / views.derivedRelationship", () => {
  it("finds an explicit neighbor by id, oriented to the subject", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const john = await core.people.create(
      { firstName: "John", lastName: "Doe" },
      [],
    );
    const rel = await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "parent",
      bType: "person",
      bId: john.id,
      bRole: "child",
    });

    const view = await core.views.relationshipForSubject(
      "person",
      john.id,
      rel.id,
    );
    expect(view?.subject.label).toBe("John Doe");
    expect(view?.neighbor.otherId).toBe(jane.id);
    expect(view?.neighbor.otherRole).toBe("parent");
  });

  it("finds the derived grandparent edge by its other end and base role", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const john = await core.people.create(
      { firstName: "John", lastName: "Doe" },
      [],
    );
    const tim = await core.people.create(
      { firstName: "Tim", lastName: "Doe" },
      [],
    );
    await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "parent",
      bType: "person",
      bId: john.id,
      bRole: "child",
    });
    await core.relationships.create({
      aType: "person",
      aId: john.id,
      aRole: "parent",
      bType: "person",
      bId: tim.id,
      bRole: "child",
    });

    const view = await core.views.derivedRelationship(
      "person",
      tim.id,
      "person",
      jane.id,
      "grandparent",
    );
    expect(view?.neighbor.origin).toBe("derived");
    expect(view?.neighbor.otherId).toBe(jane.id);
    expect(view?.role).toBe("grandparent");
  });
});

describe("views.milestoneNew / views.milestoneSubject", () => {
  it("includes candidates and neighbors from a Person but not other subjects", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const john = await core.people.create(
      { firstName: "John", lastName: "Doe" },
      [],
    );
    const rel = await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "spouse",
      bType: "person",
      bId: john.id,
      bRole: "spouse",
    });

    const fromPerson = await core.views.milestoneNew("person", jane.id);
    expect(fromPerson?.subject.type).toBe("person");
    expect(fromPerson?.candidates?.map((c) => c.id)).toEqual([john.id]);
    expect(fromPerson?.neighbors?.map((n) => n.otherId)).toEqual([john.id]);

    const fromRel = await core.views.milestoneNew("relationship", rel.id);
    expect(fromRel?.subject.label).toBe("Jane Doe & John Doe");
    expect(fromRel?.candidates).toBeUndefined();
    expect(fromRel?.neighbors).toBeUndefined();
  });
});

describe("relationships.createFromSubject", () => {
  it("writes the subject as the a-end with the neutral inverse of the other role", async () => {
    const tim = await core.people.create(
      { firstName: "Tim", lastName: "Doe" },
      [],
    );
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );

    const rel = await core.relationships.createFromSubject({
      subjectType: "person",
      subjectId: tim.id,
      otherType: "person",
      otherId: jane.id,
      otherRole: "parent",
    });

    expect(rel.aId).toBe(tim.id);
    expect(rel.aRole).toBe("child"); // inverse of parent
    expect(rel.bId).toBe(jane.id);
    expect(rel.bRole).toBe("parent");
  });

  it("materialises a derived edge so it suppresses the derived duplicate", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    const john = await core.people.create(
      { firstName: "John", lastName: "Doe" },
      [],
    );
    const tim = await core.people.create(
      { firstName: "Tim", lastName: "Doe" },
      [],
    );
    await core.relationships.create({
      aType: "person",
      aId: jane.id,
      aRole: "parent",
      bType: "person",
      bId: john.id,
      bRole: "child",
    });
    await core.relationships.create({
      aType: "person",
      aId: john.id,
      aRole: "parent",
      bType: "person",
      bId: tim.id,
      bRole: "child",
    });

    // Tim derives Jane as a grandparent before materialising.
    const before = await core.kinship.neighborsFor("person", tim.id);
    expect(before.find((n) => n.otherId === jane.id)?.origin).toBe("derived");

    await core.relationships.createFromSubject({
      subjectType: "person",
      subjectId: tim.id,
      otherType: "person",
      otherId: jane.id,
      otherRole: "grandparent",
    });

    const after = await core.kinship.neighborsFor("person", tim.id);
    const toJane = after.filter((n) => n.otherId === jane.id);
    expect(toJane).toHaveLength(1);
    expect(toJane[0].origin).toBe("explicit");
  });
});

describe("relationships.editFromSubject", () => {
  it("re-derives the subject's role while keeping its existing gendering", async () => {
    const john = await core.people.create(
      { firstName: "John", lastName: "Doe" },
      [],
    );
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    // John is the a-end (husband); Jane the b-end (wife).
    const rel = await core.relationships.create({
      aType: "person",
      aId: john.id,
      aRole: "husband",
      bType: "person",
      bId: jane.id,
      bRole: "wife",
    });

    // Editing from John's page (subject is the a-end) must not flatten his
    // unedited "husband" back to "spouse".
    await core.relationships.editFromSubject({
      subjectType: "person",
      subjectId: john.id,
      relId: rel.id,
      otherRole: "wife",
      otherRoleNote: null,
    });
    let stored = await core.relationships.get(rel.id);
    expect(stored?.aRole).toBe("husband");
    expect(stored?.bRole).toBe("wife");

    // Editing from Jane's page (subject is the b-end) keeps her "wife" too.
    await core.relationships.editFromSubject({
      subjectType: "person",
      subjectId: jane.id,
      relId: rel.id,
      otherRole: "husband",
      otherRoleNote: null,
    });
    stored = await core.relationships.get(rel.id);
    expect(stored?.aRole).toBe("husband");
    expect(stored?.bRole).toBe("wife");
  });

  it("returns undefined for a missing relationship", async () => {
    const john = await core.people.create(
      { firstName: "John", lastName: "Doe" },
      [],
    );
    expect(
      await core.relationships.editFromSubject({
        subjectType: "person",
        subjectId: john.id,
        relId: crypto.randomUUID(),
        otherRole: "wife",
        otherRoleNote: null,
      }),
    ).toBeUndefined();
  });
});
