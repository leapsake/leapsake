import type {
  EntityType,
  Milestone,
  MilestoneTimelineEntry,
  Relationship,
} from "@leapsake/schema";
import { Fragment } from "react";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { MilestonesSection } from "../components/MilestonesSection";
import { entityBasePath } from "../lib/entityLabel";

/** One endpoint of the relationship, resolved for display. */
interface Partner {
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
export function RelationshipView() {
  const { relationship, partners, title, milestones } = useLoaderData() as {
    relationship: Relationship;
    partners: Partner[];
    title: string;
    milestones: Milestone[];
  };

  // The relationship's own milestones, as editable timeline entries (this page
  // is where they're managed).
  const entries: MilestoneTimelineEntry[] = milestones.map((milestone) => ({
    milestone,
    origin: "own",
    relationshipId: null,
    otherLabel: null,
  }));

  const relPath = `/relationships/${relationship.id}`;

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb]} />

      <header>
        <h1>{title}</h1>
        <Link to={`${relPath}/edit`}>Edit roles</Link>{" "}
        <Link to={`${relPath}/delete`}>Delete</Link>
      </header>

      <dl>
        {partners.map((partner) => (
          <Fragment key={`${partner.type}:${partner.id}`}>
            <dt>{partner.roleLabel}</dt>
            <dd>
              <Link to={`${entityBasePath(partner.type)}/${partner.id}`}>
                {partner.label}
              </Link>
            </dd>
          </Fragment>
        ))}
      </dl>

      <MilestonesSection
        bearerType="relationship"
        bearerId={relationship.id}
        entries={entries}
      />
    </main>
  );
}
