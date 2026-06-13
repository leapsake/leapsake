import type {
  EntityType,
  Milestone,
  MilestoneTimelineEntry,
} from "@leapsake/schema";
import type { MilestonesRepo } from "./milestones-repo.js";
import type { RelationshipsRepo } from "./relationships-repo.js";

/**
 * Compare two partial dates with the same ordering the repo's SQL uses
 * (`ORDER BY year, month, day`, SQLite sorting NULLs first): a milestone missing
 * an earlier part sorts ahead of one that has it. Used to re-merge an entity's
 * own milestones with those drawn from its relationships into one timeline.
 */
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

/**
 * The merged milestone timeline for a Person or Pet: its **own** milestones plus
 * the milestones of every **explicit** relationship it participates in, resolved
 * read-only onto its timeline via a 1-hop join (never materialised). A pure
 * composition over the two repositories — it mirrors `kinship-service.ts`: no
 * direct DB access, deleting a source fact makes its timeline entry vanish on the
 * next read.
 *
 * Relationship-origin entries are annotated with the `relationshipId` (so the UI
 * can link out to the relationship's page, the single edit surface) and the
 * other partner's label, resolved via the caller-supplied `resolveLabel` (the
 * IPC layer already has one; passing it keeps this function free of the
 * people/pets repos). Only explicit edges are walked — derived edges have no
 * stored row and so can hold no milestones.
 *
 * The result is date-sorted with the same NULLs-first ordering the repo uses, so
 * own and relationship entries interleave by date.
 */
export async function listTimelineForEntity(
  milestones: Pick<MilestonesRepo, "listForSubject">,
  relationships: Pick<RelationshipsRepo, "listForEntity">,
  resolveLabel: (type: EntityType, id: string) => Promise<string | undefined>,
  type: EntityType,
  id: string,
): Promise<MilestoneTimelineEntry[]> {
  const entries: MilestoneTimelineEntry[] = [];

  // 1. The entity's own milestones — editable in place.
  for (const milestone of await milestones.listForSubject(type, id)) {
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
    const relMilestones = await milestones.listForSubject(
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
