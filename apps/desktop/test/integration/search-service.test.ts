import { parseBirthdayQuery } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ContactMethodsRepo,
  type MilestonesRepo,
  type PeopleRepo,
  type PetsRepo,
  type SearchService,
  type SqliteDriver,
  type TagsRepo,
  createContactMethodsRepo,
  createMilestonesRepo,
  createPeopleRepo,
  createPetsRepo,
  createSearchService,
  createTagsRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let people: PeopleRepo;
let pets: PetsRepo;
let contactMethods: ContactMethodsRepo;
let tags: TagsRepo;
let milestones: MilestonesRepo;
let search: SearchService;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  people = createPeopleRepo(driver);
  pets = createPetsRepo(driver);
  contactMethods = createContactMethodsRepo(driver);
  tags = createTagsRepo(driver);
  milestones = createMilestonesRepo(driver);
  search = createSearchService(driver);
});

afterEach(() => {
  cleanup();
});

/** Titles of the hits, in result order. */
async function titles(term: string): Promise<string[]> {
  const hits = await search.query(term);
  return hits.map((h) => h.title);
}

describe("searchService", () => {
  it("returns nothing for queries below the minimum length", async () => {
    await people.create({ firstName: "Jo", lastName: "Smith" });
    expect(await search.query("")).toEqual([]);
    expect(await search.query("j")).toEqual([]);
  });

  it("matches names accent- and case-insensitively", async () => {
    await people.create({ firstName: "José", lastName: "Armisen" });
    expect(await titles("jose")).toEqual(["José Armisen"]);
    expect(await titles("JOSE")).toEqual(["José Armisen"]);
    expect(await titles("armi")).toEqual(["José Armisen"]);
  });

  it("shows the middle name in the title only when the term matched it", async () => {
    await people.create({
      firstName: "Joseph",
      middleName: "Abraham",
      lastName: "Lampe",
    });
    // Matched via the middle name → the title surfaces it so the hit is explained.
    expect(await titles("br")).toEqual(["Joseph Abraham Lampe"]);
    // Matched via first or last → the middle name stays hidden.
    expect(await titles("jose")).toEqual(["Joseph Lampe"]);
    expect(await titles("lampe")).toEqual(["Joseph Lampe"]);
  });

  it("resolves a contact-only hit to the plain title, never the middle name", async () => {
    const person = await people.create({
      firstName: "Joseph",
      middleName: "Abraham",
      lastName: "Lampe",
    });
    await contactMethods.emails.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      address: "joe@example.com",
    });
    // The match is on the email, not the name, so the middle name is irrelevant.
    const hits = await search.query("example");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("Joseph Lampe");
  });

  it("matches pets by name like people", async () => {
    await pets.create({ name: "Rex" });
    const hits = await search.query("rex");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ entityType: "pet", title: "Rex" });
  });

  it("returns one row per entity even when several fields match", async () => {
    await people.create({ firstName: "Lee", lastName: "Lee" });
    const hits = await search.query("lee");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("Lee Lee");
  });

  it("orders by match quality: exact, then starts-with, then substring", async () => {
    // Substring (term inside a field, not at its start).
    await people.create({ firstName: "Anna", lastName: "Bajoen" });
    await people.create({ firstName: "Joelle", lastName: "Smith" }); // starts-with
    await people.create({ firstName: "Joe", lastName: "Smith" }); // exact
    expect(await titles("joe")).toEqual([
      "Joe Smith",
      "Joelle Smith",
      "Anna Bajoen",
    ]);
  });

  it("breaks ties alphabetically within a match-quality bucket", async () => {
    await people.create({ firstName: "Joe", lastName: "Baker" });
    await people.create({ firstName: "Joe", lastName: "Adams" });
    expect(await titles("joe")).toEqual(["Joe Adams", "Joe Baker"]);
  });

  it("excludes soft-deleted people and pets", async () => {
    const person = await people.create({
      firstName: "Ghost",
      lastName: "Gone",
    });
    const pet = await pets.create({ name: "Ghostly" });
    await people.softDelete(person.id);
    await pets.softDelete(pet.id);
    expect(await search.query("ghost")).toEqual([]);
  });

  it("matches by phone fragment, ignoring formatting on both sides", async () => {
    const person = await people.create({ firstName: "Pat", lastName: "Ng" });
    await contactMethods.phones.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Mobile",
      number: "+1 (555) 123-4567",
    });
    // Stored normalized is "+15551234567"; both query spellings normalize into it.
    for (const term of ["5551234567", "555-123-4567"]) {
      const hits = await search.query(term);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ entityType: "person", title: "Pat Ng" });
      expect(hits[0]?.reasons).toContainEqual({
        facet: "phone",
        matchedText: "+1 (555) 123-4567",
      });
    }
  });

  it("matches a phone across a country-code / leading-+ difference, either direction", async () => {
    // Stored WITHOUT a country code; typed WITH one (and vice versa). A
    // forward-only substring would miss these — matching is digits-only and
    // bidirectional, so the shared national number still connects.
    const a = await people.create({ firstName: "No", lastName: "Code" });
    await contactMethods.phones.create({
      ownerType: "person",
      ownerId: a.id,
      label: "Mobile",
      number: "(555) 123-4567", // normalized "5551234567"
    });
    const b = await people.create({ firstName: "Has", lastName: "Code" });
    await contactMethods.phones.create({
      ownerType: "person",
      ownerId: b.id,
      label: "Mobile",
      number: "+1 (555) 765-4321", // normalized "+15557654321"
    });
    // Typed with +1 against a stored national number.
    expect(await titles("+1 555 123 4567")).toEqual(["No Code"]);
    // Typed national against a stored +1 number.
    expect(await titles("5557654321")).toEqual(["Has Code"]);
  });

  it("matches by the last few digits of a phone number", async () => {
    const person = await people.create({ firstName: "Tail", lastName: "End" });
    await contactMethods.phones.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Mobile",
      number: "+1 (555) 123-4567",
    });
    expect(await titles("4567")).toEqual(["Tail End"]);
  });

  it("matches a postal address by street number or by city", async () => {
    const person = await people.create({
      firstName: "Maple",
      lastName: "Resident",
    });
    await contactMethods.postals.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      line1: "123 Maple Street",
      locality: "Springfield",
    });
    for (const term of ["123 Maple", "springfield", "maple st"]) {
      const hits = await search.query(term);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        entityType: "person",
        title: "Maple Resident",
      });
      // The reason shows the full formatted address, not the typed fragment.
      expect(hits[0]?.reasons).toContainEqual({
        facet: "address",
        matchedText: "123 Maple Street, Springfield",
      });
    }
  });

  it("matches a postal address ignoring commas and extra spacing", async () => {
    const person = await people.create({
      firstName: "Comma",
      lastName: "Less",
    });
    await contactMethods.postals.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      line1: "123 Any Street",
      locality: "Pittsburgh",
    });
    // Formatted as "123 Any Street, Pittsburgh"; matches with or without the
    // comma, and across collapsed extra whitespace.
    for (const term of [
      "123 any street pittsburgh",
      "123 any street, pittsburgh",
      "123  any   street  pittsburgh",
    ]) {
      const hits = await search.query(term);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        entityType: "person",
        title: "Comma Less",
      });
      expect(hits[0]?.reasons).toContainEqual({
        facet: "address",
        matchedText: "123 Any Street, Pittsburgh",
      });
    }
  });

  it("drops a postal hit whose owner is soft-deleted", async () => {
    const person = await people.create({ firstName: "Gone", lastName: "Away" });
    await contactMethods.postals.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      line1: "9 Vanished Lane",
      locality: "Nowhere",
    });
    await people.softDelete(person.id); // postal row stays active; owner does not
    expect(await search.query("vanished")).toEqual([]);
  });

  it("matches by an email/domain fragment, showing the raw address as the reason", async () => {
    const person = await people.create({ firstName: "Jane", lastName: "Doe" });
    await contactMethods.emails.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      address: "jane@example.com",
    });
    const hits = await search.query("example");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ entityType: "person", title: "Jane Doe" });
    expect(hits[0]?.reasons).toEqual([
      { facet: "email", matchedText: "jane@example.com" },
    ]);
  });

  it("groups a name + email match into one row with merged reasons", async () => {
    const person = await people.create({ firstName: "Jane", lastName: "Doe" });
    await contactMethods.emails.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      address: "jane@x.com",
    });
    const hits = await search.query("jane");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.reasons.map((r) => r.facet)).toEqual(["name", "email"]);
  });

  it("drops a contact hit whose owner is soft-deleted", async () => {
    const person = await people.create({ firstName: "Jane", lastName: "Doe" });
    await contactMethods.emails.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      address: "jane@example.com",
    });
    // Soft-delete the person only; the email row stays active but its owner is
    // no longer in the searchable set, so the hit must drop (§2.4).
    await people.softDelete(person.id);
    expect(await search.query("example")).toEqual([]);
  });

  it("sorts a name hit before a contact-only hit", async () => {
    await people.create({ firstName: "Jane", lastName: "Smith" });
    const bob = await people.create({ firstName: "Bob", lastName: "Jones" });
    await contactMethods.emails.create({
      ownerType: "person",
      ownerId: bob.id,
      label: "Home",
      address: "jane@x.com",
    });
    expect(await titles("jane")).toEqual(["Jane Smith", "Bob Jones"]);
  });

  it("surfaces a matching tag as its own navigable result", async () => {
    const person = await people.create({
      firstName: "Sam",
      lastName: "Carter",
    });
    await tags.setEntityTags("person", person.id, ["Friend"]);
    const [tag] = await tags.listForEntity("person", person.id);

    const tagHit = (await search.query("friend")).find(
      (h) => h.entityType === "tag",
    );
    // Navigates to the tag's own screen, and shows just its name (the "name"
    // facet is rendered as the title, so there's no "matched on …" line).
    expect(tagHit).toMatchObject({
      entityType: "tag",
      entityId: tag?.id,
      title: "Friend",
    });
    expect(tagHit?.reasons).toEqual([{ facet: "name", matchedText: "Friend" }]);
  });

  it("ranks a matching tag above the entities that carry it", async () => {
    const person = await people.create({
      firstName: "Sam",
      lastName: "Carter",
    });
    await tags.setEntityTags("person", person.id, ["Friend"]);
    // The tag leads; its bearer (whose name doesn't match) follows.
    expect(await titles("friend")).toEqual(["Friend", "Sam Carter"]);
  });

  it("still surfaces the bearer with a tag reason alongside the tag result", async () => {
    const person = await people.create({
      firstName: "Tagged",
      lastName: "Person",
    });
    await tags.setEntityTags("person", person.id, ["Friend", "Colleague"]);
    const hits = await search.query("frien");
    expect(hits).toHaveLength(2); // the tag result + its bearer
    const bearer = hits.find((h) => h.entityType === "person");
    expect(bearer).toMatchObject({ title: "Tagged Person" });
    expect(bearer?.reasons).toContainEqual({
      facet: "tag",
      matchedText: "Friend",
    });
  });

  it("resolves a tag bearer on a pet the same way", async () => {
    const pet = await pets.create({ name: "Rex" });
    await tags.setEntityTags("pet", pet.id, ["ServiceAnimal"]);
    const hits = await search.query("service");
    expect(hits).toHaveLength(2); // tag result + the pet bearer
    const bearer = hits.find((h) => h.entityType === "pet");
    expect(bearer).toMatchObject({ entityType: "pet", title: "Rex" });
    expect(bearer?.reasons).toContainEqual({
      facet: "tag",
      matchedText: "ServiceAnimal",
    });
  });

  it("matches a tag when the query carries the optional '#' sigil", async () => {
    const person = await people.create({
      firstName: "Sam",
      lastName: "Carter",
    });
    await tags.setEntityTags("person", person.id, ["Friend"]);
    // The stored name is bare ("Friend"); a typed "#" is stripped before matching.
    expect(await titles("#frien")).toEqual(["Friend", "Sam Carter"]);
  });

  it("groups a name + tag match into one bearer row, with the tag result separate", async () => {
    const person = await people.create({ firstName: "Mason", lastName: "Lee" });
    await tags.setEntityTags("person", person.id, ["Mason"]);
    const hits = await search.query("mason");
    expect(hits).toHaveLength(2);
    // The tag result leads; the bearer is one row with both reasons merged.
    expect(hits[0]).toMatchObject({ entityType: "tag", title: "Mason" });
    const bearer = hits.find((h) => h.entityType === "person");
    expect(bearer?.reasons.map((r) => r.facet)).toEqual(["name", "tag"]);
  });

  it("drops the bearer whose owner is soft-deleted but keeps the tag result", async () => {
    const person = await people.create({ firstName: "Gone", lastName: "Away" });
    await tags.setEntityTags("person", person.id, ["Vanishing"]);
    await people.softDelete(person.id); // tagging stays active; owner does not
    const hits = await search.query("vanishing");
    // The bearer drops (§2.4), but the tag itself is still active and navigable.
    expect(hits).toEqual([
      expect.objectContaining({ entityType: "tag", title: "Vanishing" }),
    ]);
  });

  it("drops everything once the tag is removed (and thereby orphan-deleted)", async () => {
    const person = await people.create({
      firstName: "Still",
      lastName: "Here",
    });
    await tags.setEntityTags("person", person.id, ["Temporary"]);
    await tags.setEntityTags("person", person.id, []); // untag → tag is GC'd
    expect(await search.query("temporary")).toEqual([]);
  });

  describe("birthday facet", () => {
    /** Create a person with a birthday milestone of the given partial date. */
    async function personWithBirthday(
      firstName: string,
      lastName: string,
      date: { year?: number; month?: number; day?: number },
    ) {
      const person = await people.create({ firstName, lastName });
      await milestones.create({
        kind: "birthday",
        subjectType: "person",
        subjectId: person.id,
        ...date,
      });
      return person;
    }

    it("matches the accepted date formats, with the formatted date as the reason", async () => {
      await personWithBirthday("Ada", "Lovelace", {
        year: 1990,
        month: 3,
        day: 4,
      });
      // Every form that names March 4, 1990 (or a consistent partial) surfaces Ada.
      for (const term of [
        "march",
        "mar 4",
        "march 4 1990",
        "mar 4, 1990",
        "march 1990",
        "1990",
      ]) {
        const hits = await search.query(term);
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({
          entityType: "person",
          title: "Ada Lovelace",
        });
        expect(hits[0]?.reasons).toContainEqual({
          facet: "birthday",
          matchedText: "March 4, 1990",
        });
      }
    });

    it("renders a year-less recurring birthday's reason without a year", async () => {
      await personWithBirthday("Grace", "Hopper", { month: 12, day: 9 });
      const hits = await search.query("dec 9");
      expect(hits).toHaveLength(1);
      expect(hits[0]?.reasons).toEqual([
        { facet: "birthday", matchedText: "December 9" },
      ]);
    });

    it("matches both orderings of a numeric date (3/4 → March 4 and April 3)", async () => {
      await personWithBirthday("March", "Fourth", { month: 3, day: 4 });
      await personWithBirthday("April", "Third", { month: 4, day: 3 });
      const hits = await search.query("3/4");
      expect(hits.map((h) => h.title).toSorted()).toEqual([
        "April Third",
        "March Fourth",
      ]);
    });

    it("does not match a year-only birthday against a month-name query", async () => {
      await personWithBirthday("Year", "Only", { year: 1990 });
      // The query specifies a month the milestone lacks → no match (no over-reach).
      expect(await search.query("march")).toEqual([]);
    });

    it("ignores a bare ambiguous number and an unrecognized date word", async () => {
      await personWithBirthday("Some", "One", { month: 4, day: 4 });
      expect(await search.query("44")).toEqual([]); // not a date
      expect(parseBirthdayQuery("4")).toEqual([]); // too ambiguous
      expect(parseBirthdayQuery("notamonth")).toEqual([]);
    });

    it("groups a simultaneous name and birthday hit into one row", async () => {
      const person = await people.create({
        firstName: "March",
        lastName: "Hare",
      });
      await milestones.create({
        kind: "birthday",
        subjectType: "person",
        subjectId: person.id,
        month: 3,
        day: 14,
      });
      // "march" matches the first name *and* the birthday month → one merged row.
      const hits = await search.query("march");
      expect(hits).toHaveLength(1);
      expect(hits[0]?.reasons.map((r) => r.facet)).toEqual([
        "name",
        "birthday",
      ]);
    });

    it("drops a birthday hit whose owner is soft-deleted", async () => {
      const person = await personWithBirthday("Gone", "Away", {
        month: 7,
        day: 1,
      });
      await people.softDelete(person.id); // milestone stays active; owner does not
      expect(await search.query("july 1")).toEqual([]);
    });

    it("resolves a pet's birthday to the pet entity", async () => {
      const pet = await pets.create({ name: "Rex" });
      await milestones.create({
        kind: "birthday",
        subjectType: "pet",
        subjectId: pet.id,
        month: 8,
        day: 20,
      });
      const hits = await search.query("aug 20");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ entityType: "pet", title: "Rex" });
      expect(hits[0]?.reasons).toContainEqual({
        facet: "birthday",
        matchedText: "August 20",
      });
    });
  });
});
