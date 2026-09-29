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

// Leapsake rows as the vCard writer's {@link ExportContact}, the inverse of
// import. People and pets share every mapper, so the two can't drift.

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

  // The first birthday becomes `BDAY`; any other goes out as a dated entry.
  const birthday = milestones.find((m) => m.kind === "birthday");

  return {
    uid: person.id,
    kind: "individual",
    isSelf: input.isSelf,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
    name: {
      // `ParsedName` spells absent as `""`; `nameInputFrom` is the inverse.
      firstName: person.firstName ?? "",
      middleName: person.middleName,
      lastName: person.lastName ?? "",
    },
    // The app's own name formatter; an empty `FN` would be refused on import.
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
    // Only an import drops anything.
    dropped: [],
  };
}

/** One pet's rows as a card, its name in the first-name slot. */
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

/** Whether a milestone says any part of a date. */
function dated(m: Milestone): boolean {
  return m.year !== null || m.month !== null || m.day !== null;
}

/** Every dated milestone but the `BDAY`, excluded by id so a second birthday
 *  still goes out; an `other`'s label is its note. */
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
      // A relationship's milestone is written on both partners' cards.
      relationshipId: m.bearerType === "relationship" ? m.bearerId : null,
    }));
}

/** An entity's explicit edges as `RELATED`: by `UID` to a published end, by
 *  name to an unpublished one, whose gender is not carried. */
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
