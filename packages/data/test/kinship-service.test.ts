import { DatabaseSync } from "node:sqlite";
import type { CreatePersonInput } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDismissalsRepo } from "../src/dismissals-repo.js";
import { type SqliteDriver } from "../src/driver.js";
import {
  type KinshipService,
  createKinshipService,
} from "../src/kinship-service.js";
import { runMigrations } from "../src/migrations.js";
import { type PeopleRepo, createPeopleRepo } from "../src/people-repo.js";
import {
  type RelationshipsRepo,
  createRelationshipsRepo,
} from "../src/relationships-repo.js";
import { createPetsRepo } from "../src/pets-repo.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

let db: DatabaseSync;
let driver: SqliteDriver;
let people: PeopleRepo;
let relationships: RelationshipsRepo;
let dismissals: ReturnType<typeof createDismissalsRepo>;
let kinship: KinshipService;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  people = createPeopleRepo(driver);
  const pets = createPetsRepo(driver);
  relationships = createRelationshipsRepo(driver);
  dismissals = createDismissalsRepo(driver);
  kinship = createKinshipService(driver, {
    people,
    pets,
    relationships,
    dismissals,
  });
});

afterEach(() => {
  db.close();
});

function person(firstName: string, over: Partial<CreatePersonInput> = {}) {
  return people.create({ firstName, lastName: "Smith", ...over });
}

/** Store "B is A's <role>": A's own end is the neutral inverse, B's end is `role`. */
function relate(
  aId: string,
  bId: string,
  bRole: "father" | "brother" | "mother",
) {
  const aRole = bRole === "father" || bRole === "mother" ? "child" : "sibling";
  return relationships.create({
    aType: "person",
    aId,
    aRole,
    bType: "person",
    bId,
    bRole,
  });
}

describe("kinshipService — the worked example", () => {
  it("derives uncle, derived gender, and a gendered son label", async () => {
    const josh = await person("Josh", { gender: "male" });
    const john = await person("John");
    const george = await person("George");
    await relate(josh.id, john.id, "father"); // John is Josh's father
    await relate(john.id, george.id, "brother"); // George is John's brother

    // Josh's page: John explicit Father, George derived Uncle via John.
    const joshNeighbors = await kinship.neighborsFor("person", josh.id);
    const johnEdge = joshNeighbors.find((n) => n.otherId === john.id);
    expect(johnEdge?.origin).toBe("explicit");
    expect(johnEdge?.otherRoleLabel).toBe("Father");

    const georgeEdge = joshNeighbors.find((n) => n.otherId === george.id);
    expect(georgeEdge?.origin).toBe("derived");
    expect(georgeEdge?.otherRoleLabel).toBe("Uncle");
    expect(georgeEdge?.derivedVia?.id).toBe(john.id);

    // John is implicitly male (from his explicit "father" role).
    expect(await kinship.genderFor("person", john.id)).toEqual({
      value: "male",
      origin: "derived",
    });

    // John's page: Josh shows as Son (neutral "child" gendered by Josh's male).
    const johnNeighbors = await kinship.neighborsFor("person", john.id);
    const joshEdge = johnNeighbors.find((n) => n.otherId === josh.id);
    expect(joshEdge?.origin).toBe("explicit");
    expect(joshEdge?.otherRoleLabel).toBe("Son");
  });
});

describe("kinshipService — overrides, dismissals, conflicts", () => {
  it("an explicit edge for a pair hides the derived one", async () => {
    const josh = await person("Josh", { gender: "male" });
    const john = await person("John");
    const george = await person("George");
    await relate(josh.id, john.id, "father");
    await relate(john.id, george.id, "brother");

    // Add George explicitly as Josh's uncle.
    await relationships.create({
      aType: "person",
      aId: josh.id,
      aRole: "nibling",
      bType: "person",
      bId: george.id,
      bRole: "uncle",
    });

    const joshNeighbors = await kinship.neighborsFor("person", josh.id);
    const georgeEdges = joshNeighbors.filter((n) => n.otherId === george.id);
    expect(georgeEdges).toHaveLength(1);
    expect(georgeEdges[0]?.origin).toBe("explicit");
  });

  it("a dismissal hides a derived edge", async () => {
    const josh = await person("Josh", { gender: "male" });
    const john = await person("John");
    const george = await person("George");
    await relate(josh.id, john.id, "father");
    await relate(john.id, george.id, "brother");

    await dismissals.create(
      { type: "person", id: josh.id },
      { type: "person", id: george.id },
      "pibling",
    );

    const joshNeighbors = await kinship.neighborsFor("person", josh.id);
    expect(joshNeighbors.some((n) => n.otherId === george.id)).toBe(false);
  });

  it("conflicting implied genders resolve to null", async () => {
    const x = await person("X");
    const a = await person("A");
    const b = await person("B");
    await relate(a.id, x.id, "father"); // X is A's father ⇒ male
    await relate(b.id, x.id, "mother"); // X is B's mother ⇒ female

    expect(await kinship.genderFor("person", x.id)).toEqual({
      value: null,
      origin: "derived",
    });
  });
});

describe("kinshipService — robustness", () => {
  it("terminates on a cycle (A parent of B, B parent of A)", async () => {
    const a = await person("A");
    const b = await person("B");
    await relationships.create({
      aType: "person",
      aId: a.id,
      aRole: "parent",
      bType: "person",
      bId: b.id,
      bRole: "child",
    });
    await relationships.create({
      aType: "person",
      aId: b.id,
      aRole: "parent",
      bType: "person",
      bId: a.id,
      bRole: "child",
    });

    const neighbors = await kinship.neighborsFor("person", a.id);
    // Only the explicit edges to B; no derived edge, and no hang.
    expect(neighbors.every((n) => n.otherId === b.id)).toBe(true);
    expect(neighbors.every((n) => n.origin === "explicit")).toBe(true);
  });

  it("deleting the source relationship removes its derived consequences", async () => {
    const josh = await person("Josh", { gender: "male" });
    const john = await person("John");
    const george = await person("George");
    const source = await relate(josh.id, john.id, "father");
    await relate(john.id, george.id, "brother");

    await relationships.softDelete(source.id);

    // George-as-uncle is gone, and John's derived male evaporates.
    const joshNeighbors = await kinship.neighborsFor("person", josh.id);
    expect(joshNeighbors.some((n) => n.otherId === george.id)).toBe(false);
    expect(joshNeighbors.some((n) => n.otherId === john.id)).toBe(false);
    expect((await kinship.genderFor("person", john.id)).value).toBeNull();
  });
});
