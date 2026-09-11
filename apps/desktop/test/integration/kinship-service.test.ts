import type { CreatePersonInput } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type KinshipService,
  type PeopleRepo,
  type RelationshipsRepo,
  type SqliteDriver,
  createDismissalsRepo,
  createKinshipService,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipsRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let people: PeopleRepo;
let relationships: RelationshipsRepo;
let dismissals: ReturnType<typeof createDismissalsRepo>;
let kinship: KinshipService;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
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
  cleanup();
});

function person(firstName: string, over: Partial<CreatePersonInput> = {}) {
  return people.create({ firstName, lastName: "Martini", ...over });
}

/** Store "B is A's <role>": A's own end is the neutral inverse, B's end is `role`. */
function relate(
  aId: string,
  bId: string,
  bRole: "father" | "brother" | "mother" | "sister",
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
    const george = await person("George", { gender: "male" });
    const peter = await person("Peter");
    const william = await person("William");
    await relate(george.id, peter.id, "father"); // Peter is George's father
    await relate(peter.id, william.id, "brother"); // William is Peter's brother

    // George's page: Peter explicit Father, William derived Uncle via Peter.
    const joshNeighbors = await kinship.neighborsFor("person", george.id);
    const johnEdge = joshNeighbors.find((n) => n.otherId === peter.id);
    expect(johnEdge?.origin).toBe("explicit");
    expect(johnEdge?.otherRoleLabel).toBe("Father");

    const georgeEdge = joshNeighbors.find((n) => n.otherId === william.id);
    expect(georgeEdge?.origin).toBe("derived");
    expect(georgeEdge?.otherRoleLabel).toBe("Uncle");
    expect(georgeEdge?.derivedVia?.id).toBe(peter.id);

    // Peter is implicitly male (from his explicit "father" role).
    expect(await kinship.genderFor("person", peter.id)).toEqual({
      value: "male",
      origin: "derived",
    });

    // Peter's page: George shows as Son (neutral "child" gendered by George's male).
    const johnNeighbors = await kinship.neighborsFor("person", peter.id);
    const joshEdge = johnNeighbors.find((n) => n.otherId === george.id);
    expect(joshEdge?.origin).toBe("explicit");
    expect(joshEdge?.otherRoleLabel).toBe("Son");
  });
});

describe("kinshipService — overrides, dismissals, conflicts", () => {
  it("an explicit edge for a pair hides the derived one", async () => {
    const george = await person("George", { gender: "male" });
    const peter = await person("Peter");
    const william = await person("William");
    await relate(george.id, peter.id, "father");
    await relate(peter.id, william.id, "brother");

    // Add William explicitly as George's uncle.
    await relationships.create({
      aType: "person",
      aId: george.id,
      aRole: "nibling",
      bType: "person",
      bId: william.id,
      bRole: "uncle",
    });

    const joshNeighbors = await kinship.neighborsFor("person", george.id);
    const georgeEdges = joshNeighbors.filter((n) => n.otherId === william.id);
    expect(georgeEdges).toHaveLength(1);
    expect(georgeEdges[0]?.origin).toBe("explicit");
  });

  it("a dismissal hides a derived edge", async () => {
    const george = await person("George", { gender: "male" });
    const peter = await person("Peter");
    const william = await person("William");
    await relate(george.id, peter.id, "father");
    await relate(peter.id, william.id, "brother");

    await dismissals.create(
      { type: "person", id: george.id },
      { type: "person", id: william.id },
      "pibling",
    );

    const joshNeighbors = await kinship.neighborsFor("person", george.id);
    expect(joshNeighbors.some((n) => n.otherId === william.id)).toBe(false);
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
    const george = await person("George", { gender: "male" });
    const peter = await person("Peter");
    const william = await person("William");
    const source = await relate(george.id, peter.id, "father");
    await relate(peter.id, william.id, "brother");

    await relationships.softDelete(source.id);

    // William-as-uncle is gone, and Peter's derived male evaporates.
    const joshNeighbors = await kinship.neighborsFor("person", george.id);
    expect(joshNeighbors.some((n) => n.otherId === william.id)).toBe(false);
    expect(joshNeighbors.some((n) => n.otherId === peter.id)).toBe(false);
    expect((await kinship.genderFor("person", peter.id)).value).toBeNull();
  });
});

/** Store "wife is subject's spouse" — the shape this feature is built around. */
function marry(subjectId: string, wifeId: string) {
  return relationships.create({
    aType: "person",
    aId: subjectId,
    aRole: "spouse",
    bType: "person",
    bId: wifeId,
    bRole: "wife",
  });
}

// An unpublished entity exists only as a fact about the one person it is attached
// to. It shows on that person's page as the explicit edge it is, and takes no part
// in inference — never a destination, never a route.
//
// The inference cases below use a *sibling*, not a spouse, because that is the
// shape that actually composes today: `compositionTable` derives
// `(parent, sibling) → pibling`, while it deliberately omits
// `(parent, spouse) → parent`. So an unpublished aunt is a leak you can observe
// now, whereas an unpublished stepmother is one the table has yet to permit.
describe("kinshipService — unpublished entities", () => {
  it("shows an unpublished spouse on her own person's page", async () => {
    const ernie = await person("Ernie", { gender: "male" });
    const ruth = await people.create({
      firstName: "Ruth",
      standing: "unpublished",
    });
    await marry(ernie.id, ruth.id);

    const neighbors = await kinship.neighborsFor("person", ernie.id);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]).toMatchObject({
      otherId: ruth.id,
      otherLabel: "Ruth",
      otherStanding: "unpublished",
      origin: "explicit",
    });
  });

  it("does not infer her onto anybody else", async () => {
    const ernie = await person("Ernie", { gender: "male" });
    const pete = await person("Pete", { gender: "male" });
    const ruth = await people.create({
      firstName: "Ruth",
      standing: "unpublished",
    });
    await relate(pete.id, ernie.id, "father"); // Ernie is Pete's father
    await relate(ernie.id, ruth.id, "sister"); // Ruth is Ernie's sister

    // Pete's page knows his father, and nothing about his father's sister.
    const bens = await kinship.neighborsFor("person", pete.id);
    expect(bens.map((n) => n.otherId)).toEqual([ernie.id]);

    // Ruth's own reading is the one edge back to Ernie.
    const jens = await kinship.neighborsFor("person", ruth.id);
    expect(jens.map((n) => n.otherId)).toEqual([ernie.id]);
  });

  // The same graph with Ruth published: the aunt withheld above now appears. This
  // is the control — without it, the test above would pass just as well if the
  // fixture were incapable of producing a derived edge at all.
  it("infers her onto the nephew once she is published", async () => {
    const ernie = await person("Ernie", { gender: "male" });
    const pete = await person("Pete", { gender: "male" });
    const ruth = await people.create({
      firstName: "Ruth",
      standing: "unpublished",
    });
    await relate(pete.id, ernie.id, "father");
    await relate(ernie.id, ruth.id, "sister");

    await people.update(ruth.id, { standing: "published" });

    const bens = await kinship.neighborsFor("person", pete.id);
    expect(bens.map((n) => n.otherId).sort()).toEqual(
      [ernie.id, ruth.id].sort(),
    );
    expect(bens.find((n) => n.otherId === ruth.id)).toMatchObject({
      origin: "derived",
      otherStanding: "published",
    });
  });

  // Her role still says something about the person she is attached to: that is
  // his own edge, and reading it puts her on nobody else's page.
  it("still lets her role imply her own person's gender", async () => {
    const ernie = await person("Ernie");
    const ruth = await people.create({
      firstName: "Ruth",
      standing: "unpublished",
    });
    await relationships.create({
      aType: "person",
      aId: ernie.id,
      aRole: "husband",
      bType: "person",
      bId: ruth.id,
      bRole: "wife",
    });

    expect(await kinship.genderFor("person", ernie.id)).toEqual({
      value: "male",
      origin: "derived",
    });
  });

  // A person with only one part of a name is exactly what this feature creates,
  // and a relationship row is where that name gets read.
  it("labels a one-name person without a leading space", async () => {
    const ernie = await person("Ernie");
    const davis = await people.create({
      firstName: null,
      lastName: "Dakin",
      standing: "unpublished",
    });
    await marry(ernie.id, davis.id);

    const neighbors = await kinship.neighborsFor("person", ernie.id);
    expect(neighbors[0].otherLabel).toBe("Dakin");
  });
});
