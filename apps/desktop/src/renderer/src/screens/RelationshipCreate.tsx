import type { EntityType } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import {
  type RelationshipCandidate,
  RelationshipForm,
} from "../components/RelationshipForm";

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

  return (
    <main>
      <Breadcrumbs
        trail={[
          { label: "People", to: "/" },
          { label: subject.label, to: `/people/${subject.id}` },
          { label: "Add relationship" },
        ]}
      />
      <RelationshipForm
        subjectLabel={subject.label}
        subjectType={subject.type}
        candidates={candidates}
        cancelTo={`/people/${subject.id}`}
      />
    </main>
  );
}
