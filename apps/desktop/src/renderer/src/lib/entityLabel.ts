import type { MilestoneSubjectType } from "@leapsake/schema";

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
