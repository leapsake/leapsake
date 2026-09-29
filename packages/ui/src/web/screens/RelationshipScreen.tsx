import type {
  EntityType,
  Milestone,
  MilestoneTimelineEntry,
} from "@leapsake/schema";
import { entityBasePath } from "../../headless/routes.js";
import { useMessages } from "../../messages/index.js";
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

/** A relationship's page, where its milestones are managed; partners' pages
 *  show them read-only. */
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
  const m = useMessages();
  const relPath = `/relationships/${relationshipId}`;

  // The relationship's own milestones, editable here.
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
        <Link href={`${relPath}/edit`}>{m.relationship.editRoles}</Link>{" "}
        <Link href={`${relPath}/delete`}>{m.common.delete}</Link>
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
