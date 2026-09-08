import type { EntityType, Milestone } from "@leapsake/schema";
import { type ExportContact, writeVCards } from "@leapsake/vcard";
import { zipSync } from "fflate";
import { toExportContact, toPetContact } from "./contact.js";
import { buildExportData } from "./data.js";
import type { ExportPorts } from "./ports.js";

/**
 * The export archive: one `.zip` holding the user's data, built entirely in
 * memory and handed to the caller as bytes.
 *
 * **One artifact, not two**, because the situation this file exists for is a user
 * finding it two years later — one share action and one thing to keep track of
 * beats a `.vcf` and a `.json` that must stay together to mean anything.
 * `expo-sharing` also shares one file at a time, so the alternative was two
 * buttons.
 *
 * The accepted cost is that a `.zip` cannot be handed straight to Contacts.app —
 * the user unzips first. {@link README_NAME} is what keeps that from being
 * confusing, and is the reason it is not filler.
 */

export const VCF_NAME = "contacts.vcf";
export const DATA_NAME = "data.json";
export const README_NAME = "README.txt";

/** What one export run produced. */
export interface ExportArchive {
  /** The `.zip`, ready for `File.write()`. */
  bytes: Uint8Array;
  filename: string;
  /** For the "exported N people (M KB)" the caller shows, and for the E2E assertion. */
  counts: {
    people: number;
    pets: number;
    contactMethods: number;
    /**
     * Every row in {@link DATA_NAME} — reminders, gift ideas, holiday choices,
     * duplicate judgments, notification preferences — as one number.
     *
     * One rather than ten because it has a reader: the line the app shows after
     * a share. Without it, the half of the archive that is not contacts is
     * invisible from outside the zip, and neither the user nor the on-device
     * harness can tell a backup that carries their reminders from one that
     * silently does not.
     */
    otherRecords: number;
    bytes: number;
  };
}

export interface BuildOptions {
  /** Stamped into `PRODID` and {@link README_NAME}. */
  appVersion: string;
  /**
   * The moment this export was taken — **injected, never read from the clock**,
   * so the package stays pure and its tests can assert the filename.
   */
  now: Date;
}

/**
 * Gather the whole published graph, serialize it, and zip the result with a
 * README and the versioned companion data file.
 *
 * **A graph walk, not a list.** Increment 1 could visit each person alone;
 * carrying relationships cannot, because an edge is a fact about two entities
 * and lands on both their cards. Two things follow:
 *
 * - Unpublished people and pets are reached only through somebody else's
 *   `neighborsFor`. They never get a card, which is what their standing means:
 *   they exist as a fact about the one entity they hang off.
 * - A milestone borne by a *relationship* is read once per relationship and
 *   written on both partners' cards, carrying the same id. {@link relMilestones}
 *   memoises the read, so an edge visited from both ends costs one query.
 *
 * Deflate rather than store: vCard is extremely compressible text, and a large
 * address book is the case that matters. `zipSync` is fine at these sizes — the
 * whole archive is built in memory, which is also what lets the caller write it
 * once and delete it immediately.
 */
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
    // Derived edges are computed live and have no stored row — the port's own
    // contract excludes them, and filtering here as well means a fake or a
    // future implementation that forgets cannot leak an inference into the file.
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
    // The injected instant, not the clock: with it the archive is reproducible
    // byte-for-byte, so two exports of an unchanged store are the same file
    // rather than two files that merely say the same thing.
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

/** `2026-09-07` in UTC — a filename, so it must not vary with the reader's zone. */
function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The only part of the archive that explains itself to somebody opening it long
 * after the fact — which is the whole situation the file exists for. It names
 * both files, says which one any contacts app will take and which one needs
 * Leapsake, and stamps the version that wrote it, so a future restore path has
 * something to read even if the `.json` turns out to be unreadable.
 */
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
