import type {
  CreateMilestoneInput,
  EntityType,
  Relationship,
} from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MilestonesRepo,
  type PeopleRepo,
  type RelationshipsRepo,
  type SqliteDriver,
  createMilestonesRepo,
  createPeopleRepo,
  createRelationshipsRepo,
  listTimelineForEntity,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let milestones: MilestonesRepo;
let relationships: RelationshipsRepo;
let people: PeopleRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  milestones = createMilestonesRepo(driver);
  relationships = createRelationshipsRepo(driver);
  people = createPeopleRepo(driver);
});

afterEach(() => {
  cleanup();
});

/** Resolve a person/pet to a display label, mirroring the IPC layer's resolver. */
async function resolveLabel(
  type: EntityType,
  id: string,
): Promise<string | undefined> {
  if (type !== "person") return undefined;
  const person = await people.get(id);
  return person ? `${person.firstName} ${person.lastName}` : undefined;
}

/** A milestone input with a full date, defaulting to a person birthday. */
function milestone(
  over: Partial<CreateMilestoneInput> & Pick<CreateMilestoneInput, "bearerId">,
): CreateMilestoneInput {
  return {
    kind: "birthday",
    bearerType: "person",
    year: 1990,
    month: 1,
    day: 1,
    ...over,
  };
}

/** Marry two people, returning the stored relationship row. */
function marry(aId: string, bId: string): Promise<Relationship> {
  return relationships.create({
    aType: "person",
    aId,
    aRole: "spouse",
    bType: "person",
    bId,
    bRole: "spouse",
  });
}

describe("listTimelineForEntity", () => {
  it("returns an entity's own milestones tagged origin 'own'", async () => {
    const jane = await people.create({ firstName: "Jane", lastName: "Doe" });
    const created = await milestones.create(milestone({ bearerId: jane.id }));

    const timeline = await listTimelineForEntity(
      milestones,
      relationships,
      resolveLabel,
      "person",
      jane.id,
    );

    expect(timeline).toHaveLength(1);
    expect(timeline[0].origin).toBe("own");
    expect(timeline[0].milestone.id).toBe(created.id);
    expect(timeline[0].relationshipId).toBeNull();
    expect(timeline[0].otherLabel).toBeNull();
  });

  it("resolves a relationship's milestones onto both partners' timelines", async () => {
    const jane = await people.create({ firstName: "Jane", lastName: "Doe" });
    const john = await people.create({ firstName: "John", lastName: "Doe" });
    const rel = await marry(jane.id, john.id);
    const wedding = await milestones.create(
      milestone({
        kind: "wedding",
        bearerType: "relationship",
        bearerId: rel.id,
        year: 2020,
        month: 6,
        day: 1,
      }),
    );

    for (const [bearer, partnerLabel] of [
      [jane.id, "John Doe"],
      [john.id, "Jane Doe"],
    ] as const) {
      const timeline = await listTimelineForEntity(
        milestones,
        relationships,
        resolveLabel,
        "person",
        bearer,
      );
      expect(timeline).toHaveLength(1);
      expect(timeline[0].origin).toBe("relationship");
      expect(timeline[0].milestone.id).toBe(wedding.id);
      expect(timeline[0].relationshipId).toBe(rel.id);
      expect(timeline[0].otherLabel).toBe(partnerLabel);
    }
  });

  it("merges own and relationship milestones sorted by date, NULLs first", async () => {
    const jane = await people.create({ firstName: "Jane", lastName: "Doe" });
    const john = await people.create({ firstName: "John", lastName: "Doe" });
    const rel = await marry(jane.id, john.id);

    const birthday = await milestones.create(
      milestone({ bearerId: jane.id, year: 1990, month: 3, day: 9 }),
    );
    const wedding = await milestones.create(
      milestone({
        kind: "wedding",
        bearerType: "relationship",
        bearerId: rel.id,
        year: 2020,
        month: 6,
        day: 1,
      }),
    );
    // A year-less recurring date sorts ahead of any dated one (NULLs first).
    const recurring = await milestones.create(
      milestone({
        kind: "other",
        note: "Annual",
        bearerId: jane.id,
        year: null,
        month: 2,
        day: 2,
      }),
    );

    const timeline = await listTimelineForEntity(
      milestones,
      relationships,
      resolveLabel,
      "person",
      jane.id,
    );

    expect(timeline.map((e) => e.milestone.id)).toEqual([
      recurring.id, // year null → first
      birthday.id, // 1990
      wedding.id, // 2020
    ]);
    expect(timeline.map((e) => e.origin)).toEqual([
      "own",
      "own",
      "relationship",
    ]);
  });

  it("ignores relationships that have no milestones", async () => {
    const jane = await people.create({ firstName: "Jane", lastName: "Doe" });
    const john = await people.create({ firstName: "John", lastName: "Doe" });
    await marry(jane.id, john.id);

    const timeline = await listTimelineForEntity(
      milestones,
      relationships,
      resolveLabel,
      "person",
      jane.id,
    );
    expect(timeline).toHaveLength(0);
  });
});
