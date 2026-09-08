import { describe, expect, it } from "vitest";
import type {
  ContactMethod,
  EntityType,
  Milestone,
  MilestoneKind,
  Person,
  Pet,
  RelationshipNeighbor,
  RelationshipRole,
  Tag,
} from "@leapsake/schema";
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

/** What the fake knows about one entity, keyed by its id. */
interface Per {
  methods?: ContactMethod[];
  milestones?: Milestone[];
  tags?: Tag[];
  neighbors?: RelationshipNeighbor[];
}

/**
 * An in-memory {@link ExportPorts} — the point of the injected ports: exercise
 * the whole builder with no sqlite driver.
 *
 * It mirrors what the real repos filter rather than re-implementing it: rows
 * the data layer would never return (soft-deleted, unpublished) are simply
 * absent from what `listPeople`/`listPets` answer, exactly as
 * `createEntityRepo`'s `deleted_at IS NULL` and `people.list()`'s
 * `PUBLISHED_SQL` make them. An unpublished person is still *reachable* — as
 * somebody else's neighbor — which is the only door the export has to them.
 *
 * `relationshipMilestones` is keyed by relationship id, and `relReads` counts
 * the reads, because an edge is visited from both of its ends and the builder is
 * supposed to ask only once.
 */
function ports(
  people: Person[],
  per: Record<string, Per> = {},
  extra: {
    pets?: Pet[];
    relationshipMilestones?: Record<string, Milestone[]>;
    selfId?: string;
  } = {},
): ExportPorts & { relReads: Map<string, number> } {
  const publishedOnly = <
    T extends { deletedAt: number | null; standing: string },
  >(
    rows: T[],
  ): T[] =>
    rows.filter((r) => r.deletedAt === null && r.standing === "published");

  const relReads = new Map<string, number>();

  return {
    relReads,
    listPeople: async () => publishedOnly(people),
    listPets: async () => publishedOnly(extra.pets ?? []),
    contactMethodsFor: async (id) => per[id]?.methods ?? [],
    milestonesFor: async (bearerType, bearerId) => {
      if (bearerType === "relationship") {
        relReads.set(bearerId, (relReads.get(bearerId) ?? 0) + 1);
        return extra.relationshipMilestones?.[bearerId] ?? [];
      }
      return per[bearerId]?.milestones ?? [];
    },
    tagsFor: async (_type, id) => per[id]?.tags ?? [],
    neighborsFor: async (_type, id) => per[id]?.neighbors ?? [],
    selfPersonId: async () => extra.selfId ?? null,
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

function pet(over: Partial<Pet> = {}): Pet {
  return {
    id: uuid(),
    name: "Rex",
    gender: null,
    standing: "published",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
    ...over,
  };
}

/** An oriented edge, as `orientedNeighbors` builds one. */
function neighbor(
  over: Partial<RelationshipNeighbor> = {},
): RelationshipNeighbor {
  const role: RelationshipRole = over.otherRole ?? "spouse";
  return {
    relationshipId: uuid(),
    otherType: "person" as EntityType,
    otherId: uuid(),
    otherLabel: "Jen Davis",
    otherStanding: "unpublished",
    otherRole: role,
    otherRoleLabel: role,
    otherRoleNote: null,
    origin: "explicit",
    ...over,
  };
}

function milestone(
  kind: MilestoneKind,
  bearer: { type: "person" | "pet" | "relationship"; id: string },
  date: { year: number | null; month: number; day: number },
  note: string | null = null,
): Milestone {
  return {
    id: uuid(),
    kind,
    bearerType: bearer.type,
    bearerId: bearer.id,
    ...date,
    note,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
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
    expect(counts.pets).toBe(0);
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
   * live contacts.
   */
  it("carries no deleted person, by name or by id", async () => {
    const live = person({ firstName: "Live", lastName: "One" });
    const gone = person({ firstName: "Gone", deletedAt: 1_700_000_001_000 });

    const { bytes, counts } = await buildArchive(ports([live, gone]), OPTS);
    const vcf = unzip(bytes)[VCF_NAME];

    expect(counts.people).toBe(1);
    expect(parseVCards(vcf)).toHaveLength(1);
    expect(vcf).not.toContain("Gone");
    expect(vcf).not.toContain(gone.id);
  });

  it("handles an empty store without producing a broken archive", async () => {
    const { bytes, counts } = await buildArchive(ports([]), OPTS);
    expect(counts).toEqual({
      people: 0,
      pets: 0,
      contactMethods: 0,
      bytes: bytes.length,
    });
    expect(unzip(bytes)[VCF_NAME]).toBe("");
    expect(parseVCards(unzip(bytes)[VCF_NAME])).toEqual([]);
  });
});

describe("buildArchive — the graph", () => {
  /**
   * The half of the standing rule the export has to get right. An unpublished
   * person exists only as a fact about the one person they hang off, so the file
   * says exactly that: they are named on that person's card and have no card of
   * their own. Giving them one would invent an entity the app does not have.
   */
  it("names an unpublished person on their host's card, and nowhere else", async () => {
    const jane = person({ firstName: "Jane", lastName: "Doe" });
    const hidden = person({ firstName: "Hidden", standing: "unpublished" });
    const { bytes, counts } = await buildArchive(
      ports([jane, hidden], {
        [jane.id]: {
          neighbors: [
            neighbor({
              otherId: hidden.id,
              otherLabel: "Hidden Doe",
              otherStanding: "unpublished",
              otherRole: "spouse",
            }),
          ],
        },
      }),
      OPTS,
    );
    const vcf = unzip(bytes)[VCF_NAME];

    expect(counts.people).toBe(1);
    expect(parseVCards(vcf)).toHaveLength(1);
    expect(vcf).toContain("RELATED;VALUE=text;TYPE=spouse");
    expect(vcf).toContain("Hidden Doe");
    // Named, not carded: no `UID` and no `FN` of their own.
    expect(vcf).not.toContain(`UID:urn:uuid:${hidden.id}`);
    expect(vcf).not.toContain("FN:Hidden");
  });

  it("points a published relationship at the other card by uid", async () => {
    const jane = person({ firstName: "Jane" });
    const ben = person({ firstName: "Ben" });
    const rel = uuid();
    const { bytes } = await buildArchive(
      ports([jane, ben], {
        [jane.id]: {
          neighbors: [
            neighbor({
              relationshipId: rel,
              otherId: ben.id,
              otherLabel: "Ben Doe",
              otherStanding: "published",
              otherRole: "child",
            }),
          ],
        },
        [ben.id]: {
          neighbors: [
            neighbor({
              relationshipId: rel,
              otherId: jane.id,
              otherLabel: "Jane Doe",
              otherStanding: "published",
              otherRole: "parent",
            }),
          ],
        },
      }),
      OPTS,
    );
    const vcf = unzip(bytes)[VCF_NAME].replace(/\r\n /g, "");

    expect(vcf).toContain(`urn:uuid:${ben.id}`);
    expect(vcf).toContain(`urn:uuid:${jane.id}`);
    // One edge, two cards, one id — which is what tells an importer the two
    // halves are one relationship rather than two.
    expect(vcf.match(new RegExp(`X-LEAPSAKE-REL-ID=${rel}`, "g"))).toHaveLength(
      2,
    );
  });

  /**
   * A derived edge is computed live by the kinship engine and has no stored row.
   * Writing one would put an inference in the file as a fact the user recorded,
   * and a re-import would then store it — at which point it stops being live.
   */
  it("never writes a derived edge", async () => {
    const jane = person();
    const { bytes } = await buildArchive(
      ports([jane], {
        [jane.id]: {
          neighbors: [
            neighbor({ otherLabel: "Real Spouse", origin: "explicit" }),
            neighbor({ otherLabel: "Inferred Pibling", origin: "derived" }),
          ],
        },
      }),
      OPTS,
    );
    const vcf = unzip(bytes)[VCF_NAME];
    expect(vcf).toContain("Real Spouse");
    expect(vcf).not.toContain("Inferred Pibling");
  });

  it("gives a pet its own KIND:x-pet card, with its milestones and tags", async () => {
    const rex = pet({ name: "Rex", gender: "male" });
    const { bytes, counts } = await buildArchive(
      ports(
        [],
        {
          [rex.id]: {
            milestones: [
              milestone(
                "birthday",
                { type: "pet", id: rex.id },
                {
                  year: 2019,
                  month: 5,
                  day: 2,
                },
              ),
            ],
            tags: [tag("Pets")],
          },
        },
        { pets: [rex] },
      ),
      OPTS,
    );
    const vcf = unzip(bytes)[VCF_NAME];

    expect(counts.pets).toBe(1);
    expect(vcf).toContain("KIND:x-pet");
    expect(vcf).toContain("FN:Rex");
    expect(vcf).toContain("GENDER:M");
    expect(vcf).toContain("BDAY:2019-05-02");
    expect(vcf).toContain("CATEGORIES:Pets");
  });

  it("carries every milestone kind, not only the birthday", async () => {
    const jane = person();
    const { bytes } = await buildArchive(
      ports([jane], {
        [jane.id]: {
          milestones: [
            milestone(
              "birthday",
              { type: "person", id: jane.id },
              {
                year: 1985,
                month: 4,
                day: 12,
              },
            ),
            milestone(
              "graduation",
              { type: "person", id: jane.id },
              {
                year: 2007,
                month: 6,
                day: 1,
              },
            ),
            milestone(
              "other",
              { type: "person", id: jane.id },
              { year: null, month: 8, day: 30 },
              "Beach house closing",
            ),
          ],
        },
      }),
      OPTS,
    );
    const vcf = unzip(bytes)[VCF_NAME].replace(/\r\n /g, "");

    expect(vcf).toContain("BDAY:1985-04-12");
    expect(vcf).toContain("X-ABLABEL:Graduation");
    // An `other`-kind milestone is labelled by its note, which is what `note`
    // means on that kind and what a human wants to read in Contacts.
    expect(vcf).toContain("X-ABLABEL:Beach house closing");
    expect(vcf).toContain("X-LEAPSAKE-MILESTONE-KIND=other");
    // The birthday is lifted into BDAY, not written twice.
    expect(vcf).not.toContain("X-ABLABEL:Birthday");
  });

  /**
   * A wedding is borne by the marriage, so it belongs to neither partner alone.
   * It goes on both cards with one id — and the edge is read **once**, however
   * many of its ends the file carries.
   */
  it("writes a relationship's milestone on both cards, reading it once", async () => {
    const sam = person({ firstName: "Sam" });
    const jen = person({ firstName: "Jen" });
    const rel = uuid();
    const wedding = milestone(
      "wedding",
      { type: "relationship", id: rel },
      { year: 2011, month: 6, day: 18 },
    );
    const fake = ports(
      [sam, jen],
      {
        [sam.id]: {
          neighbors: [
            neighbor({
              relationshipId: rel,
              otherId: jen.id,
              otherStanding: "published",
            }),
          ],
        },
        [jen.id]: {
          neighbors: [
            neighbor({
              relationshipId: rel,
              otherId: sam.id,
              otherStanding: "published",
            }),
          ],
        },
      },
      { relationshipMilestones: { [rel]: [wedding] } },
    );

    const { bytes } = await buildArchive(fake, OPTS);
    const vcf = unzip(bytes)[VCF_NAME].replace(/\r\n /g, "");

    expect(vcf.match(/X-ABLABEL:Wedding/g)).toHaveLength(2);
    expect(
      vcf.match(new RegExp(`X-LEAPSAKE-MILESTONE-ID=${wedding.id}`, "g")),
    ).toHaveLength(2);
    expect(vcf).toContain(`X-LEAPSAKE-MILESTONE-REL=${rel}`);
    expect(fake.relReads.get(rel)).toBe(1);
  });

  it("marks the self person, and only them", async () => {
    const jane = person({ firstName: "Jane" });
    const bob = person({ firstName: "Bob" });
    const { bytes } = await buildArchive(
      ports([jane, bob], {}, { selfId: jane.id }),
      OPTS,
    );
    const vcf = unzip(bytes)[VCF_NAME];
    expect(vcf.match(/X-LEAPSAKE-SELF:TRUE/g)).toHaveLength(1);
    // On Jane's card: the property follows her name, before the next BEGIN.
    expect(vcf.split("BEGIN:VCARD")[1]).toContain("X-LEAPSAKE-SELF:TRUE");
  });

  it("stamps created-at and updated-at from the row, not the clock", async () => {
    const jane = person({
      createdAt: Date.UTC(2024, 2, 9, 1, 35, 0),
      updatedAt: Date.UTC(2026, 8, 7, 12, 0, 0),
    });
    const { bytes } = await buildArchive(ports([jane]), OPTS);
    const vcf = unzip(bytes)[VCF_NAME];
    expect(vcf).toContain("X-LEAPSAKE-CREATED:2024-03-09T01:35:00Z");
    expect(vcf).toContain("REV:2026-09-07T12:00:00Z");
  });

  it("counts pets in the README alongside people", async () => {
    const { bytes } = await buildArchive(
      ports([person()], {}, { pets: [pet()] }),
      OPTS,
    );
    expect(unzip(bytes)[README_NAME]).toContain("Contains 1 person and 1 pet.");
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
