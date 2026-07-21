import {
  createCore,
  createHolidaysApi,
  seedHolidayCatalog,
} from "@leapsake/core";
import {
  createHiddenHolidaysRepo,
  createHolidaysRepo,
  createObservancesRepo,
  createPeopleRepo,
  createPetsRepo,
  createReminderRulesRepo,
  holidayIdFor,
  runMigrations,
} from "@leapsake/data";
import type { SqliteDriver } from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The observer picker's write path — the increment the whole feature's on-ramp
 * depends on. The behaviour worth pinning is the asymmetry in §2.2: a row is
 * written only where the answer *diverges* from the implicit one, so ticking a
 * box and unticking it must leave no trace rather than storing a redundant
 * "no".
 */
describe("observer picker", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;
  const CHRISTMAS = holidayIdFor("christmas");

  const api = () =>
    createHolidaysApi({
      holidays: createHolidaysRepo(driver),
      observances: createObservancesRepo(driver),
      hiddenHolidays: createHiddenHolidaysRepo(driver),
      people: createPeopleRepo(driver),
      pets: createPetsRepo(driver),
      reminderRules: createReminderRulesRepo(driver),
      driver,
    });

  async function addPerson(firstName: string, lastName: string) {
    return createPeopleRepo(driver).create({ firstName, lastName });
  }

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
    await seedHolidayCatalog({ driver });
  });

  afterEach(() => cleanup());

  it("lists every person and pet as a candidate, not only observers", async () => {
    // The picker is bulk assignment: if it listed only existing observers there
    // would be no way to create the first one.
    await addPerson("Alice", "Chen");
    await addPerson("Bob", "Smith");
    await createPetsRepo(driver).create({ name: "Rex" });

    const candidates = await api().listObservers(CHRISTMAS);
    expect(candidates.map((c) => c.label)).toEqual([
      "Alice Chen",
      "Bob Smith",
      "Rex",
    ]);
    for (const candidate of candidates) {
      expect(candidate.explicit).toBeNull();
      expect(candidate.observes).toBe(false);
    }
  });

  it("stores only the divergent answers", async () => {
    const alice = await addPerson("Alice", "Chen");
    const bob = await addPerson("Bob", "Smith");

    await api().setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
      { bearerType: "person", bearerId: bob.id, observes: false },
    ]);

    // Alice diverges from the implicit "no" and gets a row; Bob agrees with it
    // and gets none.
    const rows = await createObservancesRepo(driver).listForHoliday(CHRISTMAS);
    expect(rows).toHaveLength(1);
    expect(rows[0].bearerId).toBe(alice.id);
    expect(rows[0].observes).toBe(true);
  });

  it("reflects saved answers back into the picker", async () => {
    const alice = await addPerson("Alice", "Chen");
    await api().setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);

    const [candidate] = await api().listObservers(CHRISTMAS);
    expect(candidate.explicit).toBe(true);
    expect(candidate.observes).toBe(true);
  });

  it("clears a row when an answer is taken back", async () => {
    const alice = await addPerson("Alice", "Chen");
    const holidays = api();
    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);
    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: false },
    ]);

    expect(
      await createObservancesRepo(driver).listForHoliday(CHRISTMAS),
    ).toEqual([]);
    const [candidate] = await holidays.listObservers(CHRISTMAS);
    expect(candidate.explicit).toBeNull();
  });

  it("is idempotent — saving the same answers twice writes nothing new", async () => {
    const alice = await addPerson("Alice", "Chen");
    const holidays = api();
    const decisions = [
      { bearerType: "person" as const, bearerId: alice.id, observes: true },
    ];

    await holidays.setObservers(CHRISTMAS, decisions);
    const [first] =
      await createObservancesRepo(driver).listForHoliday(CHRISTMAS);
    await holidays.setObservers(CHRISTMAS, decisions);
    const rows = await createObservancesRepo(driver).listForHoliday(CHRISTMAS);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
  });

  it("adds one observer without disturbing the others", async () => {
    // The autocomplete sends a single decision per pick rather than the whole
    // address book, so a save must be additive. If it were ever read as "these
    // are all the answers", adding the second observer would silently clear the
    // first.
    const alice = await addPerson("Alice", "Chen");
    const bob = await addPerson("Bob", "Smith");
    const holidays = api();

    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);
    const [aliceRow] =
      await createObservancesRepo(driver).listForHoliday(CHRISTMAS);

    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: bob.id, observes: true },
    ]);

    const rows = await createObservancesRepo(driver).listForHoliday(CHRISTMAS);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.bearerId === alice.id)?.id).toBe(aliceRow.id);
    expect(rows.every((r) => r.observes)).toBe(true);
  });

  it("removes one observer without disturbing the others", async () => {
    const alice = await addPerson("Alice", "Chen");
    const bob = await addPerson("Bob", "Smith");
    const holidays = api();

    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
      { bearerType: "person", bearerId: bob.id, observes: true },
    ]);
    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: bob.id, observes: false },
    ]);

    const rows = await createObservancesRepo(driver).listForHoliday(CHRISTMAS);
    expect(rows).toHaveLength(1);
    expect(rows[0].bearerId).toBe(alice.id);
  });

  it("updates the browse screen's observer count", async () => {
    const alice = await addPerson("Alice", "Chen");
    await api().setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);
    const row = (await api().list()).find((h) => h.slug === "christmas");
    expect(row?.observerCount).toBe(1);
  });

  it("keeps observances through a hide and unhide", async () => {
    const alice = await addPerson("Alice", "Chen");
    const holidays = api();
    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);

    await holidays.setHidden(CHRISTMAS, true);
    expect((await holidays.get(CHRISTMAS))?.hidden).toBe(true);
    expect((await holidays.get(CHRISTMAS))?.observerCount).toBe(1);

    await holidays.setHidden(CHRISTMAS, false);
    expect((await holidays.get(CHRISTMAS))?.hidden).toBe(false);
    expect((await holidays.get(CHRISTMAS))?.observerCount).toBe(1);
  });
});

/**
 * The mirror read behind the Holidays section on a Person or Pet. It answers
 * the same question `listObservers` does from the other side, and the tests that
 * matter most are the ones pinning that the two agree — two resolution paths
 * over the same rule are exactly where a divergence would hide once the implicit
 * observance resolver stops returning nothing.
 */
describe("holidays a bearer observes", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;
  const CHRISTMAS = holidayIdFor("christmas");
  const EASTER = holidayIdFor("western-easter");

  const api = () =>
    createHolidaysApi({
      holidays: createHolidaysRepo(driver),
      observances: createObservancesRepo(driver),
      hiddenHolidays: createHiddenHolidaysRepo(driver),
      people: createPeopleRepo(driver),
      pets: createPetsRepo(driver),
      reminderRules: createReminderRulesRepo(driver),
      driver,
    });

  async function addPerson(firstName: string, lastName: string) {
    return createPeopleRepo(driver).create({ firstName, lastName });
  }

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
    await seedHolidayCatalog({ driver });
  });

  afterEach(() => cleanup());

  it("returns the whole catalog, marking what the bearer observes", async () => {
    // The whole catalog, because one read serves both the observed list and the
    // pool of what could be added — deriving both from one snapshot is what
    // stops them disagreeing.
    const alice = await addPerson("Alice", "Chen");
    const holidays = api();
    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);

    const rows = await holidays.listForBearer("person", alice.id);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.filter((r) => r.observes).map((r) => r.slug)).toEqual([
      "christmas",
    ]);
  });

  it("does not count an explicit override as an observance", async () => {
    // "Alice doesn't do Christmas" is an override, not an absence — it must not
    // read back as something she observes.
    const alice = await addPerson("Alice", "Chen");
    const observances = createObservancesRepo(driver);
    await observances.setObservance(CHRISTMAS, "person", alice.id, false);

    const rows = await api().listForBearer("person", alice.id);
    const christmas = rows.find((r) => r.id === CHRISTMAS);
    expect(christmas?.explicit).toBe(false);
    expect(christmas?.observes).toBe(false);
  });

  it("reports the stored answer as explicit", async () => {
    // Guards the field the implicit resolver will start returning `null` for:
    // the UI has to tell "the user said so" from "inherited from an inference".
    const alice = await addPerson("Alice", "Chen");
    const holidays = api();
    await holidays.setObservers(EASTER, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);

    const rows = await holidays.listForBearer("person", alice.id);
    expect(rows.find((r) => r.id === EASTER)?.explicit).toBe(true);
    expect(rows.find((r) => r.id === CHRISTMAS)?.explicit).toBeNull();
  });

  it("still lists a hidden holiday the bearer observes", async () => {
    // Suggestion-filtering is the UI's job; this read stays honest. Dropping a
    // hidden holiday here would strand an observance the user can see no way to
    // remove.
    const alice = await addPerson("Alice", "Chen");
    const holidays = api();
    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);
    await holidays.setHidden(CHRISTMAS, true);

    const christmas = (await holidays.listForBearer("person", alice.id)).find(
      (r) => r.id === CHRISTMAS,
    );
    expect(christmas?.hidden).toBe(true);
    expect(christmas?.observes).toBe(true);
  });

  it("agrees with listObservers about who observes what", async () => {
    const alice = await addPerson("Alice", "Chen");
    const bob = await addPerson("Bob", "Smith");
    const holidays = api();
    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);
    await holidays.setObservers(EASTER, [
      { bearerType: "person", bearerId: bob.id, observes: true },
    ]);

    for (const person of [alice, bob]) {
      for (const row of await holidays.listForBearer("person", person.id)) {
        const fromHolidaySide = (await holidays.listObservers(row.id)).find(
          (c) => c.bearerType === "person" && c.bearerId === person.id,
        );
        expect(fromHolidaySide?.observes).toBe(row.observes);
        expect(fromHolidaySide?.explicit).toBe(row.explicit);
      }
    }
  });

  it("works for a pet as well as a person", async () => {
    const rex = await createPetsRepo(driver).create({ name: "Rex" });
    const holidays = api();
    await holidays.setObservers(CHRISTMAS, [
      { bearerType: "pet", bearerId: rex.id, observes: true },
    ]);

    const rows = await holidays.listForBearer("pet", rex.id);
    expect(rows.filter((r) => r.observes).map((r) => r.slug)).toEqual([
      "christmas",
    ]);
  });
});

/**
 * Observances are user data hanging off a person, so they have to ride the same
 * cascade and merge paths every other per-person fact does. Missing either is
 * silent data loss that only shows up much later, as a reminder for someone the
 * user deleted or a lost answer after a merge.
 */
describe("observances through person lifecycle", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;
  const CHRISTMAS = holidayIdFor("christmas");
  const EASTER = holidayIdFor("western-easter");

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
    await seedHolidayCatalog({ driver });
  });

  afterEach(() => cleanup());

  it("clears a deleted person's observances", async () => {
    const core = createCore(driver);
    const alice = await core.people.create(
      { firstName: "Alice", lastName: "Chen" },
      [],
    );
    await core.holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: alice.id, observes: true },
    ]);

    await core.people.softDelete(alice.id);

    expect(
      await createObservancesRepo(driver).listForBearer("person", alice.id),
    ).toEqual([]);
  });

  it("carries observances onto the survivor of a merge", async () => {
    const core = createCore(driver);
    const survivor = await core.people.create(
      { firstName: "Alice", lastName: "Chen" },
      [],
    );
    const loser = await core.people.create(
      { firstName: "Alice", lastName: "Chen" },
      [],
    );

    // The loser observes Easter; the survivor doesn't know about it yet.
    await core.holidays.setObservers(EASTER, [
      { bearerType: "person", bearerId: loser.id, observes: true },
    ]);

    await core.people.merge(survivor.id, loser.id);

    const observances = createObservancesRepo(driver);
    expect(await observances.listForBearer("person", loser.id)).toEqual([]);
    const carried = await observances.listForBearer("person", survivor.id);
    expect(carried).toHaveLength(1);
    expect(carried[0].holidayId).toBe(EASTER);
    expect(carried[0].observes).toBe(true);
  });

  it("keeps the survivor's own answer when both people answered", async () => {
    // Survivorship v1 keeps the survivor's fields wholesale rather than merging
    // field by field, and an observance is no different.
    const core = createCore(driver);
    const survivor = await core.people.create(
      { firstName: "Alice", lastName: "Chen" },
      [],
    );
    const loser = await core.people.create(
      { firstName: "Alice", lastName: "Chen" },
      [],
    );

    await core.holidays.setObservers(CHRISTMAS, [
      { bearerType: "person", bearerId: survivor.id, observes: true },
      { bearerType: "person", bearerId: loser.id, observes: true },
    ]);
    await core.people.merge(survivor.id, loser.id);

    const carried = await createObservancesRepo(driver).listForBearer(
      "person",
      survivor.id,
    );
    expect(carried).toHaveLength(1);
    expect(carried[0].observes).toBe(true);
  });
});
