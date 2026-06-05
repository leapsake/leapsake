import { DatabaseSync } from "node:sqlite";
import type {
  CreateMilestoneInput,
  EntityType,
  Relationship,
} from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SqliteDriver } from "../src/driver.js";
import { listTimelineForEntity } from "../src/milestone-timeline.js";
import {
  type MilestonesRepo,
  createMilestonesRepo,
} from "../src/milestones-repo.js";
import { type PeopleRepo, createPeopleRepo } from "../src/people-repo.js";
import {
  type RelationshipsRepo,
  createRelationshipsRepo,
} from "../src/relationships-repo.js";
import { runMigrations } from "../src/migrations.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

let db: DatabaseSync;
let driver: SqliteDriver;
let milestones: MilestonesRepo;
let relationships: RelationshipsRepo;
let people: PeopleRepo;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  milestones = createMilestonesRepo(driver);
  relationships = createRelationshipsRepo(driver);
  people = createPeopleRepo(driver);
});

afterEach(() => {
  db.close();
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
  over: Partial<CreateMilestoneInput> & Pick<CreateMilestoneInput, "subjectId">,
): CreateMilestoneInput {
  return {
    kind: "birthday",
    subjectType: "person",
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
    const created = await milestones.create(milestone({ subjectId: jane.id }));

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
        subjectType: "relationship",
        subjectId: rel.id,
        year: 2020,
        month: 6,
        day: 1,
      }),
    );

    for (const [subject, partnerLabel] of [
      [jane.id, "John Doe"],
      [john.id, "Jane Doe"],
    ] as const) {
      const timeline = await listTimelineForEntity(
        milestones,
        relationships,
        resolveLabel,
        "person",
        subject,
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
      milestone({ subjectId: jane.id, year: 1990, month: 3, day: 9 }),
    );
    const wedding = await milestones.create(
      milestone({
        kind: "wedding",
        subjectType: "relationship",
        subjectId: rel.id,
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
        subjectId: jane.id,
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
