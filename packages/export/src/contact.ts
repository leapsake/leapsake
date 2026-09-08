import type {
  ContactMethod,
  Milestone,
  Person,
  Pet,
  RelationshipNeighbor,
  Tag,
} from "@leapsake/schema";
import type { ExportContact, ParsedDate, ParsedRelated } from "@leapsake/vcard";
import { fullName, isPublished, kindDefs } from "@leapsake/schema";

/**
 * Leapsake rows as the vCard writer's {@link ExportContact}.
 *
 * This is the mirror of the `ImportPorts` implementation in `@leapsake/core` —
 * that one takes a `ParsedContact` apart into rows, this one puts rows back into
 * the same shape — and the two being the same type is what makes the exported
 * file re-readable at all.
 *
 * A person and a pet share every mapper below deliberately. A pet's card is not
 * a lesser card: it carries the same milestones and the same relationships in
 * the same spelling, and factoring {@link toDates} and {@link toRelated} out is
 * what stops the two drifting into disagreeing about how a date or an edge is
 * written.
 */

/** One person's rows as a card. */
export function toExportContact(input: {
  person: Person;
  methods: readonly ContactMethod[];
  milestones: readonly Milestone[];
  relationshipMilestones: readonly Milestone[];
  neighbors: readonly RelationshipNeighbor[];
  tags: readonly Tag[];
  isSelf: boolean;
}): ExportContact {
  const { person, methods, milestones, tags } = input;

  // The birthday is a milestone like any other in storage, but `BDAY` is a
  // property of its own in vCard, so it is lifted out here. First wins: the
  // schema does not forbid two, and writing two `BDAY`s would leave which one
  // survives up to whichever importer read the file.
  const birthday = milestones.find((m) => m.kind === "birthday");

  return {
    uid: person.id,
    kind: "individual",
    isSelf: input.isSelf,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
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
    dates: toDates(milestones, input.relationshipMilestones, birthday?.id),
    related: toRelated(input.neighbors),
    tags: tags.map((t) => t.name),
    // Nothing is "dropped" on the way *out*: the field exists so the import
    // review can show a user what a foreign card carried and we could not store.
    dropped: [],
  };
}

/**
 * One pet's rows as a card.
 *
 * `petSchema` is only `name` + `gender` + `standing`, so there is nothing to
 * carry beyond the identity, the tags and the graph. The single `name` goes in
 * the first-name slot with the surname left empty — the mononym shape the parser
 * and `personSchema` both already accept, since a Person needs *some* name
 * rather than a first and a last one.
 *
 * A pet has no contact methods by construction: a contact method's owner is a
 * person or a household, so there is no parameter for them here to be forgotten.
 */
export function toPetContact(input: {
  pet: Pet;
  milestones: readonly Milestone[];
  relationshipMilestones: readonly Milestone[];
  neighbors: readonly RelationshipNeighbor[];
  tags: readonly Tag[];
}): ExportContact {
  const { pet, milestones, tags } = input;
  const birthday = milestones.find((m) => m.kind === "birthday");

  return {
    uid: pet.id,
    kind: "pet",
    isSelf: false,
    createdAt: pet.createdAt,
    updatedAt: pet.updatedAt,
    name: { firstName: pet.name, middleName: null, lastName: "" },
    displayName: pet.name,
    gender: pet.gender,
    emails: [],
    phones: [],
    postals: [],
    socials: [],
    birthday:
      birthday === undefined
        ? null
        : { year: birthday.year, month: birthday.month, day: birthday.day },
    dates: toDates(milestones, input.relationshipMilestones, birthday?.id),
    related: toRelated(input.neighbors),
    tags: tags.map((t) => t.name),
    dropped: [],
  };
}

/**
 * Every dated milestone that is not the card's `BDAY`, as `X-ABDATE` entries.
 *
 * `birthdayId` is the one already lifted into `birthday`; excluding it by **id**
 * rather than by kind is what lets a second birthday-kind milestone still be
 * carried, instead of a store that somehow holds two silently exporting one.
 *
 * A milestone with no date at all is skipped: `X-ABDATE` with an empty value is
 * a line saying nothing, and the writer would drop it anyway.
 *
 * `label` is what a human reads in Contacts, and for kind `other` that is the
 * **note** — "Beach house closing", not the word "Other". The kind survives
 * regardless, because the writer carries it in a parameter of its own.
 */
/** Whether a milestone says any part of a date. One with none is skipped: an
 *  `X-ABDATE` with an empty value is a line saying nothing. */
function dated(m: Milestone): boolean {
  return m.year !== null || m.month !== null || m.day !== null;
}

function toDates(
  own: readonly Milestone[],
  relationship: readonly Milestone[],
  birthdayId: string | undefined,
): ParsedDate[] {
  return [...own, ...relationship]
    .filter((m) => m.id !== birthdayId && dated(m))
    .map((m) => ({
      kind: m.kind,
      label: (m.kind === "other" ? m.note : null) ?? kindDefs[m.kind].label,
      date: { year: m.year, month: m.month, day: m.day },
      note: m.note,
      id: m.id,
      // The bearer is the fact that decides this: a milestone borne by the
      // relationship gets written on both partners' cards, and this is what
      // says so.
      relationshipId: m.bearerType === "relationship" ? m.bearerId : null,
    }));
}

/**
 * An entity's explicit edges as `RELATED`.
 *
 * The two forms differ by whether the other end has a card in this file. A
 * published person or pet does, so the edge points at their `UID`; an
 * unpublished one does not — they exist only as a fact about this entity — so
 * the edge *names* them, which is exactly what the store holds. Their gender is
 * not carried, an accepted loss recorded in `plans/export.md`:
 * `RelationshipNeighbor` does not resolve it, so nothing here is tempted to.
 *
 * `roleNote` rides only an `other` role, which is the same rule
 * `createRelationshipInputSchema` enforces on the way in.
 */
function toRelated(
  neighbors: readonly RelationshipNeighbor[],
): ParsedRelated[] {
  return neighbors
    .filter((n) => n.origin === "explicit")
    .map((n) => ({
      name: n.otherLabel,
      role: n.otherRole,
      roleNote: n.otherRoleNote,
      otherUid: isPublished(n.otherStanding) ? n.otherId : null,
      relationshipId: n.relationshipId,
    }));
}
