import {
  type EntityType,
  type RelationshipNeighbor,
  relationshipDraftOf,
} from "@leapsake/schema";
import { Breadcrumbs, RelationshipForm } from "@leapsake/ui/web";
import { entityBasePath } from "@leapsake/ui/headless";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { useSubmitting } from "../lib/useSubmitting";

/** The subject entity the edited relationship hangs off of. */
interface Subject {
  type: EntityType;
  id: string;
  label: string;
}

/** Edit the other end's role, stored or derived; core derives the subject's. */
export function RelationshipEdit() {
  const { subject, neighbor } = useLoaderData() as {
    subject: Subject;
    neighbor: RelationshipNeighbor;
  };
  const subjectPath = `${entityBasePath(subject.type)}/${subject.id}`;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, href: subjectPath },
          { label: "Edit relationship" },
        ]}
      />
      <RelationshipForm
        subjectType={subject.type}
        initial={relationshipDraftOf(neighbor)}
        cancelTo={subjectPath}
        submitting={useSubmitting()}
      />
    </main>
  );
}
