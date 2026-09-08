import { describe, expect, it } from "vitest";
import type { ContactMethod, Milestone, Person, Tag } from "@leapsake/schema";
import { parseVCards } from "@leapsake/vcard";
import { unzipSync } from "fflate";
import {
  DATA_NAME,
  README_NAME,
  VCF_NAME,
  buildArchive,
  exportDataSchema,
  type ExportPorts,
} from "../src/index.js";

/** A fixed instant, so the filename and the README are assertable. */
const NOW = new Date("2026-09-07T13:45:00.000Z");
const OPTS = { appVersion: "0.1.0-beta.4", now: NOW };

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/**
 * An in-memory {@link ExportPorts} — the point of the injected ports: exercise
 * the whole builder with no sqlite driver.
 *
 * It mirrors what the real repos filter rather than re-implementing it: rows
 * the data layer would never return (soft-deleted, unpublished) are simply
 * absent from what `listPeople` answers, exactly as `createEntityRepo`'s
 * `deleted_at IS NULL` and `people.list()`'s `PUBLISHED_SQL` make them.
 */
function ports(
  people: Person[],
  per: Record<
    string,
    { methods?: ContactMethod[]; milestones?: Milestone[]; tags?: Tag[] }
  > = {},
): ExportPorts {
  const live = people.filter(
    (p) => p.deletedAt === null && p.standing === "published",
  );
  return {
    listPeople: async () => live,
    contactMethodsFor: async (id) => per[id]?.methods ?? [],
    milestonesFor: async (id) => per[id]?.milestones ?? [],
    tagsFor: async (id) => per[id]?.tags ?? [],
  };
}

let n = 0;
const uuid = (): string =>
  `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function person(over: Partial<Person> = {}): Person {
  return {
    id: uuid(),
    firstName: "Jane",
    middleName: null,
    lastName: "Doe",
    gender: null,
    standing: "published",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
    ...over,
  };
}

function unzip(bytes: Uint8Array): Record<string, string> {
  const entries = unzipSync(bytes);
  return Object.fromEntries(
    Object.entries(entries).map(([name, data]) => [name, decode(data)]),
  );
}

describe("buildArchive", () => {
  it("produces exactly the three named members", async () => {
    const { bytes } = await buildArchive(ports([person()]), OPTS);
    expect(Object.keys(unzip(bytes)).sort()).toEqual(
      [DATA_NAME, README_NAME, VCF_NAME].sort(),
    );
  });

  it("names the file for the day it was taken, in UTC", async () => {
    const { filename } = await buildArchive(ports([]), OPTS);
    expect(filename).toBe("leapsake-export-2026-09-07.zip");
  });

  it("round-trips the people through the .vcf", async () => {
    const jane = person({ firstName: "Jane", lastName: "Doe" });
    const bob = person({ firstName: "Bob", lastName: "Roberts" });
    const { bytes } = await buildArchive(
      ports([jane, bob], {
        [jane.id]: {
          methods: [email(jane.id, "jane@example.com")],
          milestones: [birthday(jane.id, { year: 1985, month: 4, day: 12 })],
          tags: [tag("Family")],
        },
      }),
      OPTS,
    );

    const cards = parseVCards(unzip(bytes)[VCF_NAME]);
    expect(cards).toHaveLength(2);
    expect(cards[0].name).toEqual({
      firstName: "Jane",
      middleName: null,
      lastName: "Doe",
    });
    expect(cards[0].emails).toEqual([
      { label: "Home", address: "jane@example.com" },
    ]);
    expect(cards[0].birthday).toEqual({ year: 1985, month: 4, day: 12 });
    expect(cards[1].displayName).toBe("Bob Roberts");
  });

  it("stamps the person id as a UID and the tags as CATEGORIES", async () => {
    const jane = person();
    const { bytes } = await buildArchive(
      ports([jane], { [jane.id]: { tags: [tag("Family"), tag("Work")] } }),
      OPTS,
    );
    const vcf = unzip(bytes)[VCF_NAME];
    expect(vcf).toContain(`UID:urn:uuid:${jane.id}`);
    expect(vcf).toContain("CATEGORIES:Family,Work");
  });

  it("writes a versioned data.json that validates against its schema", async () => {
    const { bytes } = await buildArchive(ports([]), OPTS);
    const parsed: unknown = JSON.parse(unzip(bytes)[DATA_NAME]);
    expect(exportDataSchema.parse(parsed)).toEqual({ version: 1 });
  });

  it("writes a README naming both files and the version that wrote it", async () => {
    const { bytes } = await buildArchive(ports([person()]), OPTS);
    const readme = unzip(bytes)[README_NAME];
    expect(readme).toContain("Leapsake 0.1.0-beta.4");
    expect(readme).toContain("2026-09-07");
    expect(readme).toContain("Contains 1 person.");
    expect(readme).toContain(VCF_NAME);
    expect(readme).toContain(DATA_NAME);
  });

  it("reports the counts a caller shows and an E2E asserts", async () => {
    const jane = person();
    const { counts } = await buildArchive(
      ports([jane, person()], {
        [jane.id]: {
          methods: [email(jane.id, "a@example.com"), email(jane.id, "b@e.com")],
        },
      }),
      OPTS,
    );
    expect(counts.people).toBe(2);
    expect(counts.contactMethods).toBe(2);
    expect(counts.bytes).toBeGreaterThan(0);
  });

  it("is reproducible byte-for-byte for a fixed instant", async () => {
    const jane = person();
    const a = await buildArchive(ports([jane]), OPTS);
    const b = await buildArchive(ports([jane]), OPTS);
    // Byte equality, not just content equality: the zip's embedded timestamp
    // comes from the injected instant rather than the clock, so two exports of
    // an unchanged store are the same file.
    expect(a.bytes).toEqual(b.bytes);
  });

  /**
   * The export is the **one artifact that leaves the device**, so a row the user
   * told the app to forget must not be in it — there is no taking that back, and
   * vCard cannot say "deleted", so a third-party import would resurrect them as
   * live contacts. The same read that excludes them excludes an unpublished
   * person, who belongs on the card of whoever they are a fact about
   * (increment 2) rather than on one of their own.
   */
  it("carries neither a deleted person nor an unpublished one", async () => {
    const live = person({ firstName: "Live", lastName: "One" });
    const gone = person({ firstName: "Gone", deletedAt: 1_700_000_001_000 });
    const hidden = person({ firstName: "Hidden", standing: "unpublished" });

    const { bytes, counts } = await buildArchive(
      ports([live, gone, hidden]),
      OPTS,
    );
    const vcf = unzip(bytes)[VCF_NAME];

    expect(counts.people).toBe(1);
    expect(parseVCards(vcf)).toHaveLength(1);
    for (const absent of [gone, hidden]) {
      expect(vcf).not.toContain(absent.firstName ?? "");
      expect(vcf).not.toContain(absent.id);
    }
  });

  it("handles an empty store without producing a broken archive", async () => {
    const { bytes, counts } = await buildArchive(ports([]), OPTS);
    expect(counts).toEqual({
      people: 0,
      contactMethods: 0,
      bytes: bytes.length,
    });
    expect(unzip(bytes)[VCF_NAME]).toBe("");
    expect(parseVCards(unzip(bytes)[VCF_NAME])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

const spine = (ownerId: string) => ({
  id: uuid(),
  ownerType: "person" as const,
  ownerId,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  deletedAt: null,
});

function email(ownerId: string, address: string): ContactMethod {
  return {
    kind: "email",
    method: {
      ...spine(ownerId),
      label: "Home",
      address,
      normalized: address.toLowerCase(),
    },
  };
}

function birthday(
  bearerId: string,
  date: { year: number | null; month: number; day: number },
): Milestone {
  return {
    id: uuid(),
    kind: "birthday",
    bearerType: "person",
    bearerId,
    ...date,
    note: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
  };
}

function tag(name: string): Tag {
  return {
    id: uuid(),
    name,
    normalized: name.toLowerCase(),
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
  };
}
