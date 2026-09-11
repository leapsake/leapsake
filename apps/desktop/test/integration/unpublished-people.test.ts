import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import type { Person } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * An unpublished person or pet exists only as a fact about a published one: a
 * coworker's wife, recorded as a name on his relationship and nothing more.
 *
 * Two rules give the idea its whole shape, and both are here:
 *
 * - **Promotion.** The moment such an entity acquires a fact of its own, it stops
 *   being only a name and joins the catalog. Nothing in the UI says "promote" —
 *   the user fills something in, and the person is simply there afterwards.
 * - **Cascade.** They exist because somebody else does, so when that somebody (or
 *   the relationship itself) goes, they go too, rather than being left as a row
 *   nothing links to.
 */

let driver: SqliteDriver;
let cleanup: () => void;
let core: CoreApi;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  core = createCore(driver);
});

afterEach(() => {
  cleanup();
});

/** A published person to hang the unpublished ones off. */
function coworker(firstName = "Ernie") {
  return core.people.create({ firstName, lastName: "Bishop" }, []);
}

/**
 * The way an unpublished person is made: a name typed into the relationship form
 * that matches nobody.
 *
 * Read back through `people.get` rather than trusting the returned row, so every
 * test below starts from what is actually stored — and so the helper hands back a
 * `Person` rather than the `Person | Pet` the call is typed to return.
 */
async function attachWife(subjectId: string, name: string): Promise<Person> {
  const { other } = await core.relationships.createWithNewOther({
    subjectType: "person",
    subjectId,
    otherType: "person",
    otherName: name,
    otherRole: "wife",
  });
  const stored = await core.people.get(other.id);
  if (stored === undefined) throw new Error("the new person was not stored");
  return stored;
}

describe("createWithNewOther", () => {
  it("creates the person unpublished, with the relationship, in one go", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    expect(ruth.standing).toBe("unpublished");
    expect(ruth.firstName).toBe("Ruth");
    expect(ruth.lastName).toBeNull();

    const neighbors = await core.relationships.listForEntity(
      "person",
      ernie.id,
    );
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]).toMatchObject({
      otherId: ruth.id,
      otherStanding: "unpublished",
    });
  });

  it("splits a two-word name and keeps a one-word name whole", async () => {
    const ernie = await coworker();
    const davis = await attachWife(ernie.id, "Ruth Dakin");
    expect(davis).toMatchObject({ firstName: "Ruth", lastName: "Dakin" });

    const cher = await attachWife(ernie.id, "Zuzu");
    expect(cher).toMatchObject({ firstName: "Zuzu", lastName: null });
  });

  it("keeps her out of the catalog and out of the pickers", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    expect((await core.people.list()).map((p) => p.id)).toEqual([ernie.id]);
    expect((await core.views.entityList()).map((e) => e.id)).toEqual([
      ernie.id,
    ]);
    expect((await core.views.candidates()).map((c) => c.id)).toEqual([
      ernie.id,
    ]);

    // But she is readable by id, which is how her own page renders.
    expect(await core.people.get(ruth.id)).toMatchObject({ firstName: "Ruth" });
  });

  it("creates an unpublished pet the same way", async () => {
    const ernie = await coworker();
    const { other } = await core.relationships.createWithNewOther({
      subjectType: "person",
      subjectId: ernie.id,
      otherType: "pet",
      otherName: "Jimmy the Third",
      otherRole: "pet",
    });

    // A pet's name is a single field, so it is taken whole.
    expect(other).toMatchObject({ name: "Jimmy the Third" });
    expect(await core.pets.list()).toEqual([]);
  });
});

// Every core write that records a fact *about* an entity publishes it. The point
// of the sweep below is that no one of these paths is special — recording
// anything at all is what does it.
describe("promotion", () => {
  it("publishes her when she gets a birthday", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    await core.milestones.create({
      bearerType: "person",
      bearerId: ruth.id,
      kind: "birthday",
      year: 1985,
      month: 4,
      day: 2,
    });

    expect((await core.people.get(ruth.id))?.standing).toBe("published");
    expect((await core.people.list()).map((p) => p.id)).toContain(ruth.id);
  });

  it("publishes her when she gets a contact method", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: ruth.id,
      label: "home",
      address: "ruth@example.com",
    });

    expect((await core.people.get(ruth.id))?.standing).toBe("published");
  });

  it("publishes her when she gets a gender", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    await core.people.update(ruth.id, { gender: "female" }, []);

    expect((await core.people.get(ruth.id))?.standing).toBe("published");
  });

  it("publishes her when she gets a tag", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    await core.people.update(ruth.id, {}, ["neighbours"]);

    expect((await core.people.get(ruth.id))?.standing).toBe("published");
  });

  it("publishes her when she gets a second relationship", async () => {
    const ernie = await coworker();
    const mark = await coworker("Mark");
    const ruth = await attachWife(ernie.id, "Ruth");

    await core.relationships.createFromSubject({
      subjectType: "person",
      subjectId: ruth.id,
      otherType: "person",
      otherId: mark.id,
      otherRole: "friend",
    });

    // This is how the "exactly one relationship" rule is kept: by promoting, not
    // by refusing the second edge.
    expect((await core.people.get(ruth.id))?.standing).toBe("published");
  });

  it("publishes her when she is given a gift", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    await core.gifts.capture({
      giftIdea: { title: "A kite" },
      recipients: [{ party: { type: "person", id: ruth.id } }],
    });

    expect((await core.people.get(ruth.id))?.standing).toBe("published");
  });

  // The exceptions, and the reason the rule reads as "more than a name" rather
  // than "any write at all".
  it("does not publish her when only her name is corrected", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    await core.people.update(
      ruth.id,
      { firstName: "Ruth", lastName: "Dakin", middleName: "R" },
      [],
    );

    const after = await core.people.get(ruth.id);
    expect(after?.standing).toBe("unpublished");
    expect(after?.lastName).toBe("Dakin");
    expect(await core.people.list()).toHaveLength(1);
  });

  it("does not publish her for a gender merely inferred from her role", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    // "wife" implies female, and reading that stores nothing.
    expect(await core.kinship.genderFor("person", ruth.id)).toEqual({
      value: "female",
      origin: "derived",
    });
    expect((await core.people.get(ruth.id))?.standing).toBe("unpublished");
  });

  it("leaves an explicit standing in a patch alone", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    // A caller saying what it wants is not second-guessed, or an explicit
    // demotion could never be written.
    await core.people.update(ruth.id, { standing: "unpublished" }, []);
    expect((await core.people.get(ruth.id))?.standing).toBe("unpublished");
  });
});

describe("cascade", () => {
  it("takes her with the person she belongs to", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");

    await core.people.softDelete(ernie.id);

    expect(await core.people.get(ruth.id)).toBeUndefined();
    expect(await core.people.list()).toEqual([]);
  });

  it("takes her when the relationship itself is removed", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");
    const [edge] = await core.relationships.listForEntity("person", ernie.id);

    await core.relationships.softDelete(edge.relationshipId);

    expect(await core.people.get(ruth.id)).toBeUndefined();
    // Ernie is untouched — only the end that existed *because* of the edge goes.
    expect(await core.people.get(ernie.id)).toBeDefined();
  });

  it("leaves a published person standing when the edge goes", async () => {
    const ernie = await coworker();
    const mark = await coworker("Mark");
    await core.relationships.createFromSubject({
      subjectType: "person",
      subjectId: ernie.id,
      otherType: "person",
      otherId: mark.id,
      otherRole: "friend",
    });
    const [edge] = await core.relationships.listForEntity("person", ernie.id);

    await core.relationships.softDelete(edge.relationshipId);

    expect(await core.people.get(mark.id)).toBeDefined();
  });

  // Once she is a person in her own right she stops being anyone's dependent, and
  // deleting the person she came in through no longer touches her.
  it("spares her once she has been published", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");
    await core.people.update(ruth.id, { gender: "female" }, []);

    await core.people.softDelete(ernie.id);

    expect(await core.people.get(ruth.id)).toBeDefined();
    expect((await core.people.list()).map((p) => p.id)).toEqual([ruth.id]);
  });

  it("sweeps her facts, not just her row", async () => {
    const ernie = await coworker();
    const ruth = await attachWife(ernie.id, "Ruth");
    // Reach in past the promotion rule to give her a fact while still
    // unpublished — the state a half-finished write could leave behind.
    await core.milestones.create({
      bearerType: "person",
      bearerId: ruth.id,
      kind: "birthday",
      year: 1985,
      month: 4,
      day: 2,
    });
    await core.people.update(ruth.id, { standing: "unpublished" }, []);

    await core.people.softDelete(ernie.id);

    expect(await core.milestones.listForBearer("person", ruth.id)).toEqual([]);
  });
});
