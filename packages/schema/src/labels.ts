import type { Person } from "./person.js";
import type { Pet } from "./pet.js";
import type { EntityType } from "./relationship.js";

/** Join the name parts that are present, single-spaced. */
export function joinNameParts(
  ...parts: readonly (string | null | undefined)[]
): string {
  return parts.filter((part) => part != null && part !== "").join(" ");
}

/**
 * A person's display name, "First Last", falling back to the middle name when
 * it is the only one.
 */
export function fullName(person: Person): string {
  const outer = joinNameParts(person.firstName, person.lastName);
  return outer === "" ? (person.middleName ?? "") : outer;
}

/** A person's full name or a pet's name. */
export function entityLabel(type: EntityType, entity: Person | Pet): string {
  return type === "person" ? fullName(entity as Person) : (entity as Pet).name;
}

/** A tag's display label: its stored name after a "#". */
export function tagLabel(name: string): string {
  return `#${name}`;
}
