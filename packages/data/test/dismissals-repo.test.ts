import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DismissalsRepo,
  createDismissalsRepo,
} from "../src/dismissals-repo.js";
import { type SqliteDriver } from "../src/driver.js";
import { runMigrations } from "../src/migrations.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

let db: DatabaseSync;
let driver: SqliteDriver;
let repo: DismissalsRepo;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  repo = createDismissalsRepo(driver);
});

afterEach(() => {
  db.close();
});

const subject = { type: "person" as const, id: crypto.randomUUID() };
const other = { type: "person" as const, id: crypto.randomUUID() };

describe("dismissalsRepo", () => {
  it("creates a dismissal with a uuid, timestamps, and the given role", async () => {
    const d = await repo.create(subject, other, "pibling");
    expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(d.subjectId).toBe(subject.id);
    expect(d.otherId).toBe(other.id);
    expect(d.role).toBe("pibling");
    expect(d.createdAt).toBeGreaterThan(0);
    expect(d.deletedAt).toBeNull();
  });

  it("accepts a null role (dismiss any derived edge to the pair)", async () => {
    const d = await repo.create(subject, other, null);
    expect(d.role).toBeNull();
  });

  it("lists active dismissals scoped to the subject", async () => {
    await repo.create(subject, other, "pibling");
    expect(await repo.listForEntity(subject.type, subject.id)).toHaveLength(1);
    // The other end is not the subject, so it sees none.
    expect(await repo.listForEntity(other.type, other.id)).toHaveLength(0);
  });

  it("hides a soft-deleted dismissal", async () => {
    const d = await repo.create(subject, other, "pibling");
    await repo.softDelete(d.id);
    expect(await repo.listForEntity(subject.type, subject.id)).toHaveLength(0);
  });

  it("removeAllForEntity clears dismissals touching an entity on either end", async () => {
    const third = { type: "person" as const, id: crypto.randomUUID() };
    await repo.create(subject, other, "pibling"); // subject is subject end
    await repo.create(third, subject, "pibling"); // subject is other end
    const unrelated = await repo.create(third, other, null);

    await repo.removeAllForEntity(subject.type, subject.id);

    expect(await repo.listForEntity(subject.type, subject.id)).toHaveLength(0);
    expect(await repo.listForEntity(third.type, third.id)).toHaveLength(1);
    expect((await repo.listForEntity(third.type, third.id))[0]?.id).toBe(
      unrelated.id,
    );
  });
});
