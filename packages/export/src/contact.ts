import type { ContactMethod, Milestone, Person, Tag } from "@leapsake/schema";
import type { ExportContact } from "@leapsake/vcard";
import { fullName } from "@leapsake/schema";

/**
 * One person's rows as the vCard writer's {@link ExportContact}.
 *
 * This is the mirror of the `ImportPorts` implementation in `@leapsake/core` —
 * that one takes a `ParsedContact` apart into rows, this one puts rows back into
 * the same shape — and the two being the same type is what makes the exported
 * file re-readable at all.
 *
 * **Scope is `plans/export.md` increment 1**: the person and their contact
 * methods. `dates` (the nine non-birthday milestone kinds) and `related`
 * (unpublished people) stay empty here rather than being half-filled, because a
 * card carrying *some* of someone's milestones is worse than one carrying none —
 * a user comparing the export against the app would have no way to tell which
 * kinds made it.
 */
export function toExportContact(input: {
  person: Person;
  methods: readonly ContactMethod[];
  milestones: readonly Milestone[];
  tags: readonly Tag[];
}): ExportContact {
  const { person, methods, milestones, tags } = input;

  // The birthday is a milestone like any other in storage, but `BDAY` is a
  // property of its own in vCard, so it is lifted out here. First wins: the
  // schema does not forbid two, and writing two `BDAY`s would leave which one
  // survives up to whichever importer read the file.
  const birthday = milestones.find((m) => m.kind === "birthday");

  return {
    uid: person.id,
    name: {
      // The Person schema spells absent as `null`; `ParsedName` spells it as the
      // empty string, because that is what a source file's own blank field
      // yields. `nameInputFrom` is the inverse of these three lines.
      firstName: person.firstName ?? "",
      middleName: person.middleName,
      lastName: person.lastName ?? "",
    },
    // The same formatter every client labels a person with, so the `FN` in the
    // file reads exactly as the app does rather than being composed a second way.
    // It cannot be empty for a valid Person (the schema demands a name part), but
    // `|| null` says so rather than trusting it — an empty `FN` is a card our own
    // parser turns away.
    displayName: fullName(person) || null,
    gender: person.gender,
    emails: methods.flatMap((m) =>
      m.kind === "email"
        ? [{ label: m.method.label, address: m.method.address }]
        : [],
    ),
    phones: methods.flatMap((m) =>
      m.kind === "phone"
        ? [
            {
              label: m.method.label,
              number: m.method.number,
              extension: m.method.extension,
              country: m.method.country,
              smsCapable: m.method.smsCapable,
            },
          ]
        : [],
    ),
    postals: methods.flatMap((m) =>
      m.kind === "postal"
        ? [
            {
              label: m.method.label,
              line1: m.method.line1,
              line2: m.method.line2,
              locality: m.method.locality,
              region: m.method.region,
              postalCode: m.method.postalCode,
              country: m.method.country,
            },
          ]
        : [],
    ),
    socials: methods.flatMap((m) =>
      m.kind === "social"
        ? [
            {
              label: m.method.label,
              platform: m.method.platform,
              handle: m.method.handle,
              url: m.method.url,
              platformUserId: m.method.platformUserId,
            },
          ]
        : [],
    ),
    birthday:
      birthday === undefined
        ? null
        : { year: birthday.year, month: birthday.month, day: birthday.day },
    dates: [],
    related: [],
    tags: tags.map((t) => t.name),
    // Nothing is "dropped" on the way *out*: the field exists so the import
    // review can show a user what a foreign card carried and we could not store.
    dropped: [],
  };
}
