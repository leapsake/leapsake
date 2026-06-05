import type {
  EntityType,
  MilestoneSubjectType,
  Person,
  Pet,
} from "@leapsake/schema";
import { fullName } from "./fullName";

/**
 * Display label for any relationship-graph entity: a person's full name or a
 * pet's name. Used wherever relationship candidates and labels are built so the
 * two entity types render uniformly.
 */
export function entityLabel(type: EntityType, entity: Person | Pet): string {
  return type === "person" ? fullName(entity as Person) : (entity as Pet).name;
}

/**
 * Base route path for a milestone subject's view/edit/delete pages. Accepts the
 * wider {@link MilestoneSubjectType} so the milestone routes can target a
 * relationship's detail page too; existing person/pet callers are unaffected.
 */
export function entityBasePath(type: MilestoneSubjectType): string {
  if (type === "pet") return "/pets";
  if (type === "relationship") return "/relationships";
  return "/people";
}
