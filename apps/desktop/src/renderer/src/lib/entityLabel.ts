import type { EntityType, Person, Pet } from "@leapsake/schema";
import { fullName } from "./fullName";

/**
 * Display label for any relationship-graph entity: a person's full name or a
 * pet's name. Used wherever relationship candidates and labels are built so the
 * two entity types render uniformly.
 */
export function entityLabel(type: EntityType, entity: Person | Pet): string {
  return type === "person" ? fullName(entity as Person) : (entity as Pet).name;
}

/** Base route path for an entity type's view/edit/delete pages. */
export function entityBasePath(type: EntityType): string {
  return type === "pet" ? "/pets" : "/people";
}
