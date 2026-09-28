import Database from "better-sqlite3-multiple-ciphers";
import { type CoreApi, createCore, runMigrations } from "@leapsake/core";
import { beforeEach, describe, expect, it } from "vitest";
import { sqliteDriver } from "../test/node-sqlite-driver";
import { relationshipWrites } from "./relationship-writes";

let core: CoreApi;
let georgeId: string;

beforeEach(async () => {
  const driver = sqliteDriver(new Database(":memory:"));
  await runMigrations(driver);
  core = createCore(driver);
  georgeId = (
    await core.people.create(
      {
        firstName: "George",
        middleName: null,
        lastName: "Bailey",
        gender: null,
      },
      [],
    )
  ).id;
});

const georgesRelationships = async () =>
  (await core.relationships.listForEntity("person", georgeId)).map((n) => ({
    otherLabel: n.otherLabel,
    otherRole: n.otherRole,
  }));

describe("relationshipWrites", () => {
  it("saves after Edit as a revision of the relationship Edit wrote", async () => {
    const writes = relationshipWrites(core, "person", georgeId);
    const violet = await writes.commitOther(
      {
        kind: "new",
        type: "person",
        name: "Violet Bick",
        label: "Violet Bick",
      },
      "friend",
      null,
    );

    await writes.save({
      other: "existing",
      otherType: "person",
      otherId: violet.id,
      relationshipId: violet.relationshipId,
      otherRole: "cousin",
      otherRoleNote: null,
    });

    expect(await georgesRelationships()).toEqual([
      { otherLabel: "Violet Bick", otherRole: "cousin" },
    ]);
  });

  it("adds a relationship to somebody new on Save alone", async () => {
    await relationshipWrites(core, "person", georgeId).save({
      other: "new",
      otherType: "person",
      otherName: "Violet Bick",
      otherRole: "friend",
      otherRoleNote: null,
    });

    expect(await georgesRelationships()).toEqual([
      { otherLabel: "Violet Bick", otherRole: "friend" },
    ]);
  });
});
