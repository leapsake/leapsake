import type {
  EntityType,
  Milestone,
  MilestoneTimelineEntry,
} from "@leapsake/schema";
import type { MilestonesRepo } from "./milestones-repo.js";
import type { RelationshipsRepo } from "./relationships-repo.js";

/** Compare date parts as the repo's SQL orders them, NULLs first. */
function compareDateParts(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return -1; // NULLs first, matching the SQL ORDER BY
  if (b === null) return 1;
  return a - b;
}

/** Order two milestones by (year, month, day), NULLs first. */
function byDate(a: Milestone, b: Milestone): number {
  return (
    compareDateParts(a.year, b.year) ||
    compareDateParts(a.month, b.month) ||
    compareDateParts(a.day, b.day)
  );
}

/** An entity's own milestones plus those of its explicit relationships,
 *  annotated with the relationship, merged by date. Computed on read. */
export async function listTimelineForEntity(
  milestones: Pick<MilestonesRepo, "listForBearer">,
  relationships: Pick<RelationshipsRepo, "listForEntity">,
  resolveLabel: (type: EntityType, id: string) => Promise<string | undefined>,
  type: EntityType,
  id: string,
): Promise<MilestoneTimelineEntry[]> {
  const entries: MilestoneTimelineEntry[] = [];

  // 1. The entity's own milestones — editable in place.
  for (const milestone of await milestones.listForBearer(type, id)) {
    entries.push({
      milestone,
      origin: "own",
      relationshipId: null,
      otherLabel: null,
    });
  }

  // 2. Each explicit relationship's milestones, annotated with that edge's id
  //    and the other partner's label for display.
  for (const rel of await relationships.listForEntity(type, id)) {
    const relMilestones = await milestones.listForBearer(
      "relationship",
      rel.id,
    );
    if (relMilestones.length === 0) continue;
    const subjectIsA = rel.aType === type && rel.aId === id;
    const otherType = subjectIsA ? rel.bType : rel.aType;
    const otherId = subjectIsA ? rel.bId : rel.aId;
    const otherLabel = (await resolveLabel(otherType, otherId)) ?? null;
    for (const milestone of relMilestones) {
      entries.push({
        milestone,
        origin: "relationship",
        relationshipId: rel.id,
        otherLabel,
      });
    }
  }

  return [...entries].sort((a, b) => byDate(a.milestone, b.milestone));
}
