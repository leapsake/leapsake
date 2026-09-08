import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { parseVCards } from "@leapsake/vcard";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Export — `core.export.archive` over the **real** repos.
 *
 * `@leapsake/export` unit-tests the builder against in-memory ports, which
 * proves the format but says nothing about the wiring: whether the ports read
 * the tables a person's facts actually live in, and whether the exclusions the
 * builder relies on (soft-deleted rows, unpublished people) are really
 * structural in the data layer or merely asserted by a fake that agrees with
 * the assertion. That is what this covers, and it is the half that would fail
 * silently — an export missing everybody's phone numbers still produces a
 * perfectly valid archive.
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

const VERSION = "0.1.0-test";

async function exportedVcf(): Promise<string> {
  const { bytes } = await core.export.archive({ appVersion: VERSION });
  return new TextDecoder().decode(unzipSync(bytes)["contacts.vcf"]);
}

describe("core.export.archive", () => {
  it("carries a person's whole card: name, tags, methods and birthday", async () => {
    const jane = await core.people.create(
      {
        firstName: "Jane",
        middleName: "Marie",
        lastName: "Doe",
        gender: "female",
      },
      ["Family", "Work"],
    );
    await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: jane.id,
      label: "Home",
      address: "jane@example.com",
    });
    await core.contactMethods.phones.create({
      ownerType: "person",
      ownerId: jane.id,
      label: "Mobile",
      number: "+1 555 0100",
      extension: "204",
      country: "US",
    });
    await core.contactMethods.postals.create({
      ownerType: "person",
      ownerId: jane.id,
      label: "Home",
      line1: "1 Main St",
      line2: "Apt 4",
      locality: "Springfield",
      region: "IL",
      postalCode: "62704",
      country: "US",
    });
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: jane.id,
      year: 1985,
      month: 4,
      day: 12,
    });

    const vcf = await exportedVcf();

    // The literal properties, because this is the assertion that catches a port
    // reading the wrong table: a card that merely parses could still be empty.
    expect(vcf).toContain(`UID:urn:uuid:${jane.id}`);
    expect(vcf).toContain("CATEGORIES:Family,Work");
    expect(vcf).toContain("X-LEAPSAKE-EXT=204");
    expect(vcf).toContain("X-LEAPSAKE-COUNTRY=US");
    expect(vcf).toContain("X-ABADR:US");
    expect(vcf).toContain(`PRODID:-//Leapsake//Leapsake ${VERSION}//EN`);

    const [card] = parseVCards(vcf);
    expect(card.name).toEqual({
      firstName: "Jane",
      middleName: "Marie",
      lastName: "Doe",
    });
    expect(card.gender).toBe("female");
    expect(card.emails).toEqual([
      { label: "Home", address: "jane@example.com" },
    ]);
    expect(card.phones[0]).toMatchObject({
      label: "Mobile",
      number: "+1 555 0100",
    });
    expect(card.postals[0]).toMatchObject({
      line1: "1 Main St",
      line2: "Apt 4",
      locality: "Springfield",
      country: "US",
    });
    expect(card.birthday).toEqual({ year: 1985, month: 4, day: 12 });
  });

  /**
   * The one artifact that leaves the device must not carry a row the user told
   * the app to forget — and the exclusion has to be transitive, or a live card
   * ends up naming a person the file does not contain. Both fall out of the data
   * layer's structural `deleted_at IS NULL`, which is exactly what this pins.
   */
  it("leaves out a deleted person, and the deleted facts of a live one", async () => {
    const live = await core.people.create(
      { firstName: "Live", lastName: "One" },
      [],
    );
    const gone = await core.people.create(
      { firstName: "Gone", lastName: "Away" },
      [],
    );
    await core.people.softDelete(gone.id);

    const keep = await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: live.id,
      label: "Home",
      address: "keep@example.com",
    });
    const drop = await core.contactMethods.emails.create({
      ownerType: "person",
      ownerId: live.id,
      label: "Work",
      address: "drop@example.com",
    });
    await core.contactMethods.emails.softDelete(drop.id);
    void keep;

    const vcf = await exportedVcf();

    expect(parseVCards(vcf)).toHaveLength(1);
    expect(vcf).not.toContain("Gone");
    expect(vcf).not.toContain(gone.id);
    expect(vcf).toContain("keep@example.com");
    expect(vcf).not.toContain("drop@example.com");
  });

  /**
   * An unpublished person exists only as a fact about somebody else, so they
   * belong on *that* person's card as a `RELATED` — which is `plans/export.md`
   * increment 2. Until it lands they are absent rather than given a card of
   * their own, and this is what says so out loud: when increment 2 arrives, this
   * test is the one that has to change.
   */
  it("gives an unpublished person no card of their own (increment 2 changes this)", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", lastName: "Doe" },
      [],
    );
    // `createWithNewOther` is the only way an unpublished entity comes into
    // being — a name typed into the relationship form that matches nobody.
    // Creating one directly and then relating it would not do: an explicit
    // relationship to an existing person *publishes* them.
    const { other } = await core.relationships.createWithNewOther({
      subjectType: "person",
      subjectId: jane.id,
      otherType: "person",
      otherName: "Unpublished Spouse",
      otherRole: "spouse",
    });

    const vcf = await exportedVcf();
    expect(parseVCards(vcf)).toHaveLength(1);
    expect(vcf).not.toContain("Unpublished");
    expect(vcf).not.toContain(other.id);
  });

  it("produces a readable archive for an empty store", async () => {
    const { bytes, counts, filename } = await core.export.archive({
      appVersion: VERSION,
    });
    expect(counts.people).toBe(0);
    expect(filename).toMatch(/^leapsake-export-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
      "README.txt",
      "contacts.vcf",
      "data.json",
    ]);
  });
});
