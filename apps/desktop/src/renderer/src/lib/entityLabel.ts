import type { MilestoneBearerType } from "@leapsake/schema";

/**
 * Base route path for a milestone bearer's view/edit/delete pages. Accepts the
 * wider {@link MilestoneBearerType} so the milestone routes can target a
 * relationship's detail page too; existing person/pet callers are unaffected.
 */
export function entityBasePath(type: MilestoneBearerType): string {
  if (type === "pet") return "/pets";
  if (type === "relationship") return "/relationships";
  return "/people";
}
