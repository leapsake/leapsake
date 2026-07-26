import type { EntityType } from "@leapsake/schema";
import {
  Breadcrumbs,
  RelationshipForm,
  type RelationshipCandidate,
} from "@leapsake/ui/web";
import { entityBasePath } from "@leapsake/ui/headless";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { useSubmitting } from "../lib/useSubmitting";

/** The subject entity a new relationship hangs off of. */
interface Subject {
  type: EntityType;
  id: string;
  label: string;
}

export function RelationshipCreate() {
  const { subject, candidates } = useLoaderData() as {
    subject: Subject;
    candidates: RelationshipCandidate[];
  };
  const subjectPath = `${entityBasePath(subject.type)}/${subject.id}`;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, href: subjectPath },
          { label: "Add relationship" },
        ]}
      />
      <RelationshipForm
        subjectType={subject.type}
        candidates={candidates}
        cancelTo={subjectPath}
        submitting={useSubmitting()}
      />
    </main>
  );
}
