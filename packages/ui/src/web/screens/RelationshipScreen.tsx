import type {
  EntityType,
  Milestone,
  MilestoneTimelineEntry,
} from "@leapsake/schema";
import { entityBasePath } from "../../headless/routes.js";
import { useUi } from "../adapter.js";
import { Breadcrumbs, type Crumb } from "../primitives/Breadcrumbs.js";
import { DetailList } from "../primitives/DetailList.js";
import { MilestonesSection } from "../sections/MilestonesSection.js";

/** One endpoint of the relationship, resolved for display. */
export interface RelationshipPartner {
  type: EntityType;
  id: string;
  label: string;
  roleLabel: string;
}

/**
 * A relationship's detail page — the canonical home for managing the
 * relationship's milestones (Wedding, First Date, Met). The same milestones also
 * surface read-only on each partner's timeline (see {@link MilestonesSection}),
 * but they are added/edited/removed here. Editing the roles or deleting the
 * relationship reuses the subject-scoped relationship screens, addressed through
 * the first endpoint.
 */
export function RelationshipScreen({
  trail,
  relationshipId,
  title,
  partners,
  milestones,
}: {
  trail: Crumb[];
  relationshipId: string;
  title: string;
  partners: readonly RelationshipPartner[];
  milestones: readonly Milestone[];
}) {
  const { Link } = useUi();
  const relPath = `/relationships/${relationshipId}`;

  // The relationship's own milestones, as editable timeline entries (this page
  // is where they're managed).
  const entries: MilestoneTimelineEntry[] = milestones.map((milestone) => ({
    milestone,
    origin: "own",
    relationshipId: null,
    otherLabel: null,
  }));

  return (
    <main>
      <Breadcrumbs trail={trail} />

      <header>
        <h1>{title}</h1>
        <Link href={`${relPath}/edit`}>Edit roles</Link>{" "}
        <Link href={`${relPath}/delete`}>Delete</Link>
      </header>

      <DetailList
        details={partners.map((partner) => ({
          term: partner.roleLabel,
          value: (
            <Link href={`${entityBasePath(partner.type)}/${partner.id}`}>
              {partner.label}
            </Link>
          ),
        }))}
      />

      <MilestonesSection
        bearerType="relationship"
        bearerId={relationshipId}
        entries={entries}
      />
    </main>
  );
}
