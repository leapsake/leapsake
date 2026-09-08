import { writeVCards } from "@leapsake/vcard";
import { zipSync } from "fflate";
import { z } from "zod";
import { toExportContact } from "./contact.js";
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

/**
 * The version stamped into {@link DATA_NAME}, and the thing a future restore path
 * reads first.
 *
 * It is here from the first commit even though the file is nearly empty
 * (`plans/export.md` increment 3 fills it), because increment 1 already ships
 * the file onto users' disks: adding fields to an identified file later is
 * ordinary, while retrofitting a version onto one already in the wild is not.
 */
export const DATA_VERSION = 1;

/**
 * What {@link DATA_NAME} holds. Everything not person-shaped — reminders, gift
 * ideas, observances, `not_a_duplicate` judgments, notification settings — joins
 * this schema in increment 3, each as its own optional key, so a file written by
 * an older app still parses.
 */
export const exportDataSchema = z.object({
  version: z.literal(DATA_VERSION),
});

export type ExportData = z.infer<typeof exportDataSchema>;

/** What one export run produced. */
export interface ExportArchive {
  /** The `.zip`, ready for `File.write()`. */
  bytes: Uint8Array;
  filename: string;
  /** For the "exported N people (M KB)" the caller shows, and for the E2E assertion. */
  counts: { people: number; contactMethods: number; bytes: number };
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
 * Gather every published person, serialize them, and zip the result with a
 * README and the (versioned, still nearly empty) companion data file.
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
  const people = await ports.listPeople();

  let contactMethods = 0;
  const contacts = [];
  for (const person of people) {
    const [methods, milestones, tags] = await Promise.all([
      ports.contactMethodsFor(person.id),
      ports.milestonesFor(person.id),
      ports.tagsFor(person.id),
    ]);
    contactMethods += methods.length;
    contacts.push(toExportContact({ person, methods, milestones, tags }));
  }

  const vcf = writeVCards(contacts, {
    prodId: `-//Leapsake//Leapsake ${opts.appVersion}//EN`,
  });
  const data: ExportData = { version: DATA_VERSION };

  const encoder = new TextEncoder();
  const bytes = zipSync(
    {
      [VCF_NAME]: encoder.encode(vcf),
      [DATA_NAME]: encoder.encode(`${JSON.stringify(data, null, 2)}\n`),
      [README_NAME]: encoder.encode(readmeText(opts, people.length)),
    },
    // The injected instant, not the clock: with it the archive is reproducible
    // byte-for-byte, so two exports of an unchanged store are the same file
    // rather than two files that merely say the same thing.
    { level: 6, mtime: opts.now },
  );

  return {
    bytes,
    filename: `leapsake-export-${isoDay(opts.now)}.zip`,
    counts: { people: people.length, contactMethods, bytes: bytes.length },
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
function readmeText(opts: BuildOptions, people: number): string {
  return `Leapsake export
===============

Written by Leapsake ${opts.appVersion} on ${isoDay(opts.now)}.
Contains ${people} ${people === 1 ? "person" : "people"}.

${VCF_NAME}
  Your people, as vCard. Any contacts app will import this file --
  Apple Contacts, Google Contacts, Outlook. Unzip first: a .zip cannot
  be opened by a contacts app directly.

${DATA_NAME}
  The rest of your Leapsake data, in a format only Leapsake reads.
  Keep it beside the .vcf; on its own it is not much use.

${README_NAME}
  This file.

Keep the whole .zip. Leapsake never uploads it anywhere -- this copy
exists only where you put it.
`;
}
