import type { EntityType, Milestone } from "@leapsake/schema";
import { type ExportContact, writeVCards } from "@leapsake/vcard";
import { zipSync } from "fflate";
import { toExportContact, toPetContact } from "./contact.js";
import { buildExportData } from "./data.js";
import type { ExportPorts } from "./ports.js";

// The export archive: one `.zip`, built in memory; see the README's _The
// archive_.

export const VCF_NAME = "contacts.vcf";
export const DATA_NAME = "data.json";
export const README_NAME = "README.txt";

/** What one export run produced. */
export interface ExportArchive {
  /** The `.zip`, ready for `File.write()`. */
  bytes: Uint8Array;
  filename: string;
  /** For the “exported N people” line the caller shows. */
  counts: {
    people: number;
    pets: number;
    contactMethods: number;
    /** Every row in {@link DATA_NAME}, as one number the app shows. */
    otherRecords: number;
    bytes: number;
  };
}

export interface BuildOptions {
  /** Stamped into `PRODID` and {@link README_NAME}. */
  appVersion: string;
  /** When this export was taken; injected, never read from the clock. */
  now: Date;
}

/** Walks the published graph and zips its cards with a README and the data
 *  file; see the README's _The graph walk_. */
export async function buildArchive(
  ports: ExportPorts,
  opts: BuildOptions,
): Promise<ExportArchive> {
  const [people, pets, selfId] = await Promise.all([
    ports.listPeople(),
    ports.listPets(),
    ports.selfPersonId(),
  ]);

  // One read per relationship, however many of its ends are exported.
  const seenRels = new Map<string, Promise<Milestone[]>>();
  const relMilestones = async (
    type: EntityType,
    id: string,
  ): Promise<{
    neighbors: Awaited<ReturnType<ExportPorts["neighborsFor"]>>;
    milestones: Milestone[];
  }> => {
    const all = await ports.neighborsFor(type, id);
    // The port already excludes derived edges; this stops one that forgets.
    const neighbors = all.filter((n) => n.origin === "explicit");
    const milestones = await Promise.all(
      neighbors.map((n) => {
        const cached = seenRels.get(n.relationshipId);
        if (cached !== undefined) return cached;
        const read = ports.milestonesFor("relationship", n.relationshipId);
        seenRels.set(n.relationshipId, read);
        return read;
      }),
    );
    return { neighbors, milestones: milestones.flat() };
  };

  let contactMethods = 0;
  const contacts: ExportContact[] = [];

  for (const person of people) {
    const [methods, milestones, tags, graph] = await Promise.all([
      ports.contactMethodsFor(person.id),
      ports.milestonesFor("person", person.id),
      ports.tagsFor("person", person.id),
      relMilestones("person", person.id),
    ]);
    contactMethods += methods.length;
    contacts.push(
      toExportContact({
        person,
        methods,
        milestones,
        relationshipMilestones: graph.milestones,
        neighbors: graph.neighbors,
        tags,
        isSelf: person.id === selfId,
      }),
    );
  }

  for (const pet of pets) {
    const [milestones, tags, graph] = await Promise.all([
      ports.milestonesFor("pet", pet.id),
      ports.tagsFor("pet", pet.id),
      relMilestones("pet", pet.id),
    ]);
    contacts.push(
      toPetContact({
        pet,
        milestones,
        relationshipMilestones: graph.milestones,
        neighbors: graph.neighbors,
        tags,
      }),
    );
  }

  const vcf = writeVCards(contacts, {
    prodId: `-//Leapsake//Leapsake ${opts.appVersion}//EN`,
  });
  const { data, rows: otherRecords } = await buildExportData(ports);

  const encoder = new TextEncoder();
  const bytes = zipSync(
    {
      [VCF_NAME]: encoder.encode(vcf),
      [DATA_NAME]: encoder.encode(`${JSON.stringify(data, null, 2)}\n`),
      [README_NAME]: encoder.encode(
        readmeText(opts, people.length, pets.length),
      ),
    },
    // The injected instant, so an unchanged store exports the same bytes.
    { level: 6, mtime: opts.now },
  );

  return {
    bytes,
    filename: `leapsake-export-${isoDay(opts.now)}.zip`,
    counts: {
      people: people.length,
      pets: pets.length,
      contactMethods,
      otherRecords,
      bytes: bytes.length,
    },
  };
}

/** The UTC day as `YYYY-MM-DD`: a filename must not vary with the zone. */
function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The README that explains the archive to whoever opens it years later. */
function readmeText(opts: BuildOptions, people: number, pets: number): string {
  const held =
    pets === 0
      ? `${people} ${people === 1 ? "person" : "people"}`
      : `${people} ${people === 1 ? "person" : "people"} and ` +
        `${pets} ${pets === 1 ? "pet" : "pets"}`;

  return `Leapsake export
===============

Written by Leapsake ${opts.appVersion} on ${isoDay(opts.now)}.
Contains ${held}.

${VCF_NAME}
  Your people and pets, their contact details, their dates and how
  they are related, as vCard. Any contacts app will import this file --
  Apple Contacts, Google Contacts, Outlook. Unzip first: a .zip cannot
  be opened by a contacts app directly.

  Contacts apps have no idea what a pet is, so a pet imports there as
  an ordinary contact. Leapsake reads it back as a pet.

${DATA_NAME}
  Everything that is not a contact: your reminders and how they
  repeat, your gift ideas and who they are for, which holidays you
  observe or hid, which people you have told Leapsake are not
  duplicates of each other, and your notification preferences.
  In a format only Leapsake reads -- keep it beside the .vcf.

${README_NAME}
  This file.

Keep the whole .zip. Leapsake never uploads it anywhere -- this copy
exists only where you put it.
`;
}
