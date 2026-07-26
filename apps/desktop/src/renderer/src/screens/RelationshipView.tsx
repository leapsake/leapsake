import type { Milestone, Relationship } from "@leapsake/schema";
import { RelationshipScreen, type RelationshipPartner } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";

/** The route container for a relationship's detail page. */
export function RelationshipView() {
  const { relationship, partners, title, milestones } = useLoaderData() as {
    relationship: Relationship;
    partners: RelationshipPartner[];
    title: string;
    milestones: Milestone[];
  };

  return (
    <RelationshipScreen
      trail={[homeCrumb]}
      relationshipId={relationship.id}
      title={title}
      partners={partners}
      milestones={milestones}
    />
  );
}
