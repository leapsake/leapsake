import { seedHolidayCatalog } from "@leapsake/core";
import { parseBirthdayQuery } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ContactMethodsRepo,
  type MilestonesRepo,
  type PeopleRepo,
  type PetsRepo,
  type RelationshipsRepo,
  type GiftIdeasRepo,
  type SearchService,
  type SqliteDriver,
  type TagsRepo,
  createContactMethodsRepo,
  createGiftIdeasRepo,
  createMilestonesRepo,
  createPeopleRepo,
  createPetsRepo,
  createRelationshipsRepo,
  createHiddenHolidaysRepo,
  createObservancesRepo,
  createSearchService,
  createTagsRepo,
  holidayIdFor,
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
let giftIdeas: GiftIdeasRepo;
let search: SearchService;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  people = createPeopleRepo(driver);
  pets = createPetsRepo(driver);
  contactMethods = createContactMethodsRepo(driver);
  tags = createTagsRepo(driver);
  milestones = createMilestonesRepo(driver);
  giftIdeas = createGiftIdeasRepo(driver);
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
    await people.create({ firstName: "Janie", lastName: "Bailey" });
    expect(await search.query("")).toEqual([]);
    expect(await search.query("j")).toEqual([]);
  });

  it("matches names accent- and case-insensitively", async () => {
    await people.create({ firstName: "Nicolò", lastName: "Martini" });
    expect(await titles("nicolo")).toEqual(["Nicolò Martini"]);
    expect(await titles("NICOLO")).toEqual(["Nicolò Martini"]);
    expect(await titles("mart")).toEqual(["Nicolò Martini"]);
  });

  it("matches a whole name typed across its parts", async () => {
    await people.create({ firstName: "Harry", lastName: "Bailey" });
    expect(await titles("harry bailey")).toEqual(["Harry Bailey"]);
    // Every intermediate state of typing that name keeps the row on screen —
    // including the moment the separating space is typed and nothing follows it.
    expect(await titles("harry")).toEqual(["Harry Bailey"]);
    expect(await titles("harry ")).toEqual(["Harry Bailey"]);
    expect(await titles("harry bai")).toEqual(["Harry Bailey"]);
  });

  it("ignores surrounding whitespace in the term", async () => {
    await people.create({ firstName: "Harry", lastName: "Bailey" });
    expect(await titles("  harry bailey  ")).toEqual(["Harry Bailey"]);
  });

  it("does not match a whole-name term against a person sharing only one part", async () => {
    await people.create({ firstName: "Harry", lastName: "Bailey" });
    await people.create({ firstName: "Harry", lastName: "Martini" });
    await people.create({ firstName: "Pete", lastName: "Bailey" });
    expect(await titles("harry bailey")).toEqual(["Harry Bailey"]);
  });

  it("keeps finding someone by name once their email has stopped matching", async () => {
    const person = await people.create({
      firstName: "Harry",
      lastName: "Bailey",
    });
    await contactMethods.emails.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      address: "Harry-Bailey@example.com",
    });
    // "harry" matches both the name and the email; the two merge into one row.
    const partial = await search.query("harry");
    expect(partial).toHaveLength(1);
    expect(partial[0]?.reasons.map((r) => r.facet)).toEqual(["name", "email"]);
    // Typing the surname takes the email out of it — the name match must carry
    // the row on its own rather than letting the result vanish mid-word.
    const full = await search.query("harry bailey");
    expect(full).toHaveLength(1);
    expect(full[0]?.title).toBe("Harry Bailey");
    expect(full[0]?.reasons).toEqual([
      { facet: "name", matchedText: "Harry Bailey" },
    ]);
  });

  it("matches a whole name that spans the middle name, and shows it", async () => {
    await people.create({
      firstName: "Mary",
      middleName: "Hatch",
      lastName: "Bailey",
    });
    // Spanning the middle name only matches the with-middle form, so the title
    // surfaces it for the same reason a bare middle-name match does.
    expect(await titles("mary hatch")).toEqual(["Mary Hatch Bailey"]);
    expect(await titles("hatch bailey")).toEqual(["Mary Hatch Bailey"]);
    expect(await titles("mary hatch bailey")).toEqual(["Mary Hatch Bailey"]);
    // The plain form still matches, and still hides the middle name.
    expect(await titles("mary bailey")).toEqual(["Mary Bailey"]);
  });

  it("matches a pet whose name is more than one word", async () => {
    await pets.create({ name: "Jimmy the Raven" });
    expect(await titles("jimmy the ra")).toEqual(["Jimmy the Raven"]);
  });

  it("shows the middle name in the title only when the term matched it", async () => {
    await people.create({
      firstName: "Mary",
      middleName: "Hatch",
      lastName: "Bailey",
    });
    // Matched via the middle name → the title surfaces it so the hit is explained.
    expect(await titles("tch")).toEqual(["Mary Hatch Bailey"]);
    // Matched via first or last → the middle name stays hidden.
    expect(await titles("mar")).toEqual(["Mary Bailey"]);
    expect(await titles("bailey")).toEqual(["Mary Bailey"]);
  });

  it("resolves a contact-only hit to the plain title, never the middle name", async () => {
    const person = await people.create({
      firstName: "Mary",
      middleName: "Hatch",
      lastName: "Bailey",
    });
    await contactMethods.emails.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      address: "mary@example.com",
    });
    // The match is on the email, not the name, so the middle name is irrelevant.
    const hits = await search.query("example");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("Mary Bailey");
  });

  it("matches pets by name like people", async () => {
    await pets.create({ name: "Jimmy" });
    const hits = await search.query("jimmy");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ entityType: "pet", title: "Jimmy" });
  });

  it("returns one row per entity even when several fields match", async () => {
    await people.create({ firstName: "William", lastName: "Bailey" });
    const hits = await search.query("il");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("William Bailey");
  });

  it("orders by match quality: exact, then starts-with, then substring", async () => {
    // Substring (term inside a field, not at its start).
    await people.create({ lastName: "Davis" });
    await people.create({ firstName: "Violet", lastName: "Bick" }); // starts-with
    await people.create({ firstName: "Vi" }); // exact
    expect(await titles("vi")).toEqual(["Vi", "Violet Bick", "Davis"]);
  });

  it("breaks ties alphabetically within a match-quality bucket", async () => {
    await people.create({ firstName: "Harry", lastName: "Bailey" });
    await people.create({ firstName: "George", lastName: "Bailey" });
    expect(await titles("bailey")).toEqual(["George Bailey", "Harry Bailey"]);
  });

  it("excludes soft-deleted people and pets", async () => {
    const person = await people.create({
      firstName: "Clarence",
      lastName: "Odbody",
    });
    const pet = await pets.create({ name: "Clarence" });
    await people.softDelete(person.id);
    await pets.softDelete(pet.id);
    expect(await search.query("clarence")).toEqual([]);
  });

  it("matches by phone fragment, ignoring formatting on both sides", async () => {
    const person = await people.create({
      firstName: "Violet",
      lastName: "Bick",
    });
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
      expect(hits[0]).toMatchObject({
        entityType: "person",
        title: "Violet Bick",
      });
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
      firstName: "George",
      lastName: "Bailey",
    });
    await contactMethods.postals.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      line1: "320 Sycamore Street",
      locality: "Bedford Falls",
    });
    for (const term of ["320 Sycamore", "bedford falls", "sycamore st"]) {
      const hits = await search.query(term);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        entityType: "person",
        title: "George Bailey",
      });
      // The reason shows the full formatted address, not the typed fragment.
      expect(hits[0]?.reasons).toContainEqual({
        facet: "address",
        matchedText: "320 Sycamore Street, Bedford Falls",
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
    const person = await people.create({
      firstName: "Jane",
      lastName: "Wainwright",
    });
    await contactMethods.emails.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Home",
      address: "jane@example.com",
    });
    const hits = await search.query("example");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      entityType: "person",
      title: "Jane Wainwright",
    });
    expect(hits[0]?.reasons).toEqual([
      { facet: "email", matchedText: "jane@example.com" },
    ]);
  });

  it("answers 'who is @foo?' from a social handle", async () => {
    const person = await people.create({
      firstName: "Jane",
      lastName: "Wainwright",
    });
    await contactMethods.socials.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Personal",
      platform: "instagram",
      handle: "SparkleJane",
    });

    // The stored handle keeps its casing; the query need not.
    const hits = await search.query("sparkle");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      entityType: "person",
      title: "Jane Wainwright",
    });
    expect(hits[0]?.reasons).toEqual([
      { facet: "social", matchedText: "Instagram · SparkleJane" },
    ]);

    // The "@" people write is optional, as "#" is for tags.
    expect(await search.query("@sparklejane")).toHaveLength(1);
  });

  it("names an unknown platform as stored in a handle's reason", async () => {
    const person = await people.create({
      firstName: "Zuzu",
      lastName: "Bailey",
    });
    await contactMethods.socials.create({
      ownerType: "person",
      ownerId: person.id,
      label: "Personal",
      platform: "mastodon",
      handle: "zuzu@hachyderm.io",
    });
    const hits = await search.query("hachyderm");
    expect(hits[0]?.reasons).toEqual([
      { facet: "social", matchedText: "mastodon · zuzu@hachyderm.io" },
    ]);
  });

  it("groups a name + email match into one row with merged reasons", async () => {
    const person = await people.create({
      firstName: "Jane",
      lastName: "Wainwright",
    });
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
    const person = await people.create({
      firstName: "Jane",
      lastName: "Wainwright",
    });
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
    await people.create({ firstName: "Jane", lastName: "Martini" });
    const harry = await people.create({
      firstName: "Harry",
      lastName: "Gower",
    });
    await contactMethods.emails.create({
      ownerType: "person",
      ownerId: harry.id,
      label: "Home",
      address: "jane@x.com",
    });
    expect(await titles("jane")).toEqual(["Jane Martini", "Harry Gower"]);
  });

  it("surfaces a matching tag as its own navigable result", async () => {
    const person = await people.create({
      firstName: "Ernie",
      lastName: "Bishop",
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
      firstName: "Ernie",
      lastName: "Bishop",
    });
    await tags.setEntityTags("person", person.id, ["Friend"]);
    // The tag leads; its bearer (whose name doesn't match) follows.
    expect(await titles("friend")).toEqual(["Friend", "Ernie Bishop"]);
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
    const pet = await pets.create({ name: "Jimmy" });
    await tags.setEntityTags("pet", pet.id, ["ServiceAnimal"]);
    const hits = await search.query("service");
    expect(hits).toHaveLength(2); // tag result + the pet bearer
    const bearer = hits.find((h) => h.entityType === "pet");
    expect(bearer).toMatchObject({ entityType: "pet", title: "Jimmy" });
    expect(bearer?.reasons).toContainEqual({
      facet: "tag",
      matchedText: "ServiceAnimal",
    });
  });

  it("matches a tag when the query carries the optional '#' sigil", async () => {
    const person = await people.create({
      firstName: "Ernie",
      lastName: "Bishop",
    });
    await tags.setEntityTags("person", person.id, ["Friend"]);
    // The stored name is bare ("Friend"); a typed "#" is stripped before matching.
    expect(await titles("#frien")).toEqual(["Friend", "Ernie Bishop"]);
  });

  it("groups a name + tag match into one bearer row, with the tag result separate", async () => {
    const person = await people.create({
      firstName: "Violet",
      lastName: "Bick",
    });
    await tags.setEntityTags("person", person.id, ["Violet"]);
    const hits = await search.query("violet");
    expect(hits).toHaveLength(2);
    // The tag result leads; the bearer is one row with both reasons merged.
    expect(hits[0]).toMatchObject({ entityType: "tag", title: "Violet" });
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
        bearerType: "person",
        bearerId: person.id,
        ...date,
      });
      return person;
    }

    it("matches the accepted date formats, with the formatted date as the reason", async () => {
      await personWithBirthday("Mary", "Bailey", {
        year: 1990,
        month: 3,
        day: 4,
      });
      // Every form that names March 4, 1990 (or a consistent partial) surfaces Mary.
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
          title: "Mary Bailey",
        });
        expect(hits[0]?.reasons).toContainEqual({
          facet: "birthday",
          matchedText: "March 4, 1990",
        });
      }
    });

    it("renders a year-less recurring birthday's reason without a year", async () => {
      await personWithBirthday("Henry", "Potter", { month: 12, day: 9 });
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
        bearerType: "person",
        bearerId: person.id,
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
      const pet = await pets.create({ name: "Jimmy" });
      await milestones.create({
        kind: "birthday",
        bearerType: "pet",
        bearerId: pet.id,
        month: 8,
        day: 20,
      });
      const hits = await search.query("aug 20");
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ entityType: "pet", title: "Jimmy" });
      expect(hits[0]?.reasons).toContainEqual({
        facet: "birthday",
        matchedText: "August 20",
      });
    });
  });
});

/**
 * Holidays surface as their own navigable result, on the `tag` precedent: the
 * thing you searched for has a screen, so it appears as itself rather than only
 * through the people behind it.
 */
describe("searchService — holidays", () => {
  beforeEach(async () => {
    await seedHolidayCatalog({ driver });
  });

  it("finds a holiday by name", async () => {
    const hits = await search.query("christmas");
    const holiday = hits.find((h) => h.entityType === "holiday");
    expect(holiday?.title).toBe("Christmas");
    expect(holiday?.entityId).toBe(holidayIdFor("christmas"));
  });

  it("matches a substring of the name", async () => {
    expect(
      (await search.query("thanksgiv")).some((h) => h.title === "Thanksgiving"),
    ).toBe(true);
  });

  it("is case- and accent-insensitive, like every other facet", async () => {
    expect(
      (await search.query("EASTER")).some((h) => h.title === "Easter"),
    ).toBe(true);
  });

  it("floats above an equally-matching person", async () => {
    // Someone named "Zuzu Christmas" must not outrank the holiday itself when
    // the query is the holiday's name.
    await people.create({ firstName: "Zuzu", lastName: "Christmas" });
    const hits = await search.query("christmas");
    expect(hits[0].entityType).toBe("holiday");
    // …and the person is still there, just below.
    expect(hits.some((h) => h.title === "Zuzu Christmas")).toBe(true);
  });

  it("carries no 'matched on' reason, since it matched its own name", async () => {
    const [hit] = (await search.query("christmas")).filter(
      (h) => h.entityType === "holiday",
    );
    expect(hit.reasons.every((r) => r.facet === "name")).toBe(true);
  });

  it("does not surface the people who observe it", async () => {
    // Deliberate: Christmas can have dozens of observers, and listing them all
    // would bury every other result while duplicating the holiday's own screen.
    const violet = await people.create({
      firstName: "Violet",
      lastName: "Bick",
    });
    await createObservancesRepo(driver).setObservance(
      holidayIdFor("christmas"),
      "person",
      violet.id,
      true,
    );

    expect(
      (await search.query("christmas")).some((h) => h.title === "Violet Bick"),
    ).toBe(false);
  });

  it("still finds a hidden holiday, so it can be unhidden", async () => {
    // Hiding suppresses a holiday's reminders, not its existence — and search is
    // the fastest route back to the screen that can restore it.
    const mothersDay = holidayIdFor("us-mothers-day");
    await createHiddenHolidaysRepo(driver).setHidden(mothersDay, true);
    expect(
      (await search.query("mother")).some((h) => h.entityType === "holiday"),
    ).toBe(true);
  });

  it("ignores a holiday nothing matches", async () => {
    expect(
      (await search.query("zzzzz")).some((h) => h.entityType === "holiday"),
    ).toBe(false);
  });
});

/**
 * Gift ideas surface as their own navigable result, on the tag/holiday
 * precedent — "what was that Tom Sawyer link?" is a search for the *thing*
 *. Unlike a tag or a holiday, an idea aggregates
 * nothing, so it doesn't float above equally-matching people; unlike a holiday,
 * it *is* reachable through its tags, since gift ideas are taggable.
 */
describe("searchService — gift ideas", () => {
  it("finds a gift idea by title", async () => {
    const idea = await giftIdeas.create({
      title: "The Adventures of Tom Sawyer",
    });
    const hits = await search.query("tom sawyer");
    const hit = hits.find((h) => h.entityType === "gift_idea");
    expect(hit?.title).toBe("The Adventures of Tom Sawyer");
    expect(hit?.entityId).toBe(idea.id);
  });

  it("is case- and accent-insensitive, like every other facet", async () => {
    await giftIdeas.create({ title: "Crème brûlée torch" });
    expect(
      (await search.query("CREME BRULEE")).some(
        (h) => h.title === "Crème brûlée torch",
      ),
    ).toBe(true);
  });

  it("carries no 'matched on' reason, since it matched its own title", async () => {
    await giftIdeas.create({ title: "Scarf" });
    const [hit] = (await search.query("scarf")).filter(
      (h) => h.entityType === "gift_idea",
    );
    expect(hit.reasons.every((r) => r.facet === "name")).toBe(true);
  });

  it("surfaces through a tag it carries, with the tag as the reason", async () => {
    const idea = await giftIdeas.create({ title: "Wool socks" });
    await tags.setEntityTags("gift_idea", idea.id, ["stocking"]);

    const hits = await search.query("stock");
    const hit = hits.find((h) => h.entityType === "gift_idea");
    expect(hit?.title).toBe("Wool socks");
    expect(hit?.reasons).toEqual([{ facet: "tag", matchedText: "stocking" }]);
    // The tag itself leads, as it does for people and pets.
    expect(hits[0].entityType).toBe("tag");
  });

  it("does not float above an equally-matching person, unlike a holiday", async () => {
    // Both are starts-with name matches, so only the tiebreak decides. An idea
    // has its own screen but leads nothing below it, so it takes its
    // alphabetical place instead of jumping the line the way a tag/holiday does
    // (were it floating, the idea would come first here).
    await giftIdeas.create({ title: "Camera strap" });
    await people.create({ firstName: "Bert", lastName: "Camera" });
    const hits = await search.query("camer");
    expect(hits.map((h) => h.entityType)).toEqual(["person", "gift_idea"]);
  });

  it("matches the idea's link, with the URL as the reason", async () => {
    await giftIdeas.create({
      title: "The Adventures of Tom Sawyer",
      url: "https://www.thelocalbookshop.example/tom-sawyer",
    });
    const hits = await search.query("thelocalbookshop");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      entityType: "gift_idea",
      title: "The Adventures of Tom Sawyer",
    });
    expect(hits[0]?.reasons).toEqual([
      {
        facet: "link",
        matchedText: "https://www.thelocalbookshop.example/tom-sawyer",
      },
    ]);
  });

  it("matches a whole pasted URL against the stored one", async () => {
    await giftIdeas.create({
      title: "Scarf",
      url: "https://www.example.com/scarf",
    });
    // The fold strips the scheme and "www." from *both* sides, so a link pasted
    // in either spelling still lines up with the stored one.
    expect(
      (await search.query("https://www.example.com/scarf")).map(
        (h) => h.entityType,
      ),
    ).toEqual(["gift_idea"]);
    expect(
      (await search.query("example.com/scarf")).map((h) => h.entityType),
    ).toEqual(["gift_idea"]);
  });

  it("does not let a bare scheme or 'www' match every link", async () => {
    await giftIdeas.create({
      title: "Scarf",
      url: "https://www.example.com/scarf",
    });
    expect(await search.query("https")).toEqual([]);
    expect(await search.query("www")).toEqual([]);
  });

  it("merges a title and link match into one row", async () => {
    await giftIdeas.create({
      title: "Dune",
      url: "https://books.example/dune",
    });
    const hits = await search.query("dune");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.reasons).toEqual([
      { facet: "name", matchedText: "Dune" },
      { facet: "link", matchedText: "https://books.example/dune" },
    ]);
  });

  it("ranks a link match below every title match", async () => {
    // A link hit is a *reason*, never a name, so it sorts with contact-style
    // matches — under anything whose own title matched.
    await giftIdeas.create({ title: "Dune poster" });
    await giftIdeas.create({
      title: "Sandworm mug",
      url: "https://dune.example",
    });
    expect(await titles("dune")).toEqual(["Dune poster", "Sandworm mug"]);
  });

  it("drops a soft-deleted idea", async () => {
    const idea = await giftIdeas.create({ title: "Scarf" });
    await giftIdeas.softDelete(idea.id);
    expect(
      (await search.query("scarf")).some((h) => h.entityType === "gift_idea"),
    ).toBe(false);
  });
});

// Someone who exists only as a fact about somebody else is findable by name, but
// resolves to the person whose page they are on — the only place they can be
// read. Structurally this is the same move a phone number makes: a facet of an
// entity, surfaced as a reason on that entity's row.
describe("searchService — entities that exist only as a relationship", () => {
  let relationships: RelationshipsRepo;

  beforeEach(() => {
    relationships = createRelationshipsRepo(driver);
  });

  /** Attach an unpublished person to `subjectId`, as the form's save does. */
  async function attach(subjectId: string, firstName: string, lastName = null) {
    const person = await people.create({
      firstName,
      lastName,
      standing: "unpublished",
    });
    await relationships.create({
      aType: "person",
      aId: subjectId,
      aRole: "spouse",
      bType: "person",
      bId: person.id,
      bRole: "wife",
    });
    return person;
  }

  it("returns the anchor, not the attached person", async () => {
    const ernie = await people.create({
      firstName: "Ernie",
      lastName: "Bishop",
    });
    await attach(ernie.id, "Ruth");

    const hits = await search.query("ruth");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      entityType: "person",
      entityId: ernie.id,
      title: "Ernie Bishop",
    });
    expect(hits[0].reasons).toContainEqual({
      facet: "relationship",
      matchedText: "Ruth",
    });
  });

  it("ranks the anchor below a person whose own name matched", async () => {
    const ernie = await people.create({
      firstName: "Ernie",
      lastName: "Bishop",
    });
    await people.create({ firstName: "Ruth", lastName: "Dakin" });
    await attach(ernie.id, "Ruth");

    // A name match outranks a facet match, as it does for contact hits.
    expect(await titles("ruth")).toEqual(["Ruth Dakin", "Ernie Bishop"]);
  });

  it("merges into one row when the anchor matched some other way", async () => {
    const ruthven = await people.create({
      firstName: "Mary",
      lastName: "Ruthven",
    });
    await attach(ruthven.id, "Ruth");

    const hits = await search.query("ruth");
    expect(hits).toHaveLength(1);
    expect(hits[0].reasons.map((r) => r.facet).sort()).toEqual([
      "name",
      "relationship",
    ]);
  });

  it("finds an attached pet through its owner", async () => {
    const billy = await people.create({
      firstName: "William",
      lastName: "Bailey",
    });
    const jimmy = await pets.create({
      name: "Jimmy",
      standing: "unpublished",
    });
    await relationships.create({
      aType: "person",
      aId: billy.id,
      aRole: "owner",
      bType: "pet",
      bId: jimmy.id,
      bRole: "pet",
    });

    const hits = await search.query("jimmy");
    expect(hits.map((h) => h.entityId)).toEqual([billy.id]);
  });

  it("returns her in her own right once she is published", async () => {
    const ernie = await people.create({
      firstName: "Ernie",
      lastName: "Bishop",
    });
    const ruth = await attach(ernie.id, "Ruth");

    await people.update(ruth.id, { standing: "published" });

    const hits = await search.query("ruth");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ entityId: ruth.id, title: "Ruth" });
  });
});
