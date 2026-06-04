import type { EntityType } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import {
  type RelationshipCandidate,
  RelationshipForm,
} from "../components/RelationshipForm";
import { entityBasePath } from "../lib/entityLabel";

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
          { label: subject.label, to: subjectPath },
          { label: "Add relationship" },
        ]}
      />
      <RelationshipForm
        subjectLabel={subject.label}
        subjectType={subject.type}
        candidates={candidates}
        cancelTo={subjectPath}
      />
    </main>
  );
}
