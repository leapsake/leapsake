import type {
  MilestoneSubjectType,
  RelationshipNeighbor,
} from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { MilestoneForm } from "../components/MilestoneForm";
import type { RelationshipCandidate } from "../components/RelationshipForm";
import { entityBasePath } from "../lib/entityLabel";

/** The subject entity a new milestone hangs off of. */
interface Subject {
  type: MilestoneSubjectType;
  id: string;
  label: string;
}

export function MilestoneCreate() {
  // `candidates`/`neighbors` are present only for a Person subject — they drive
  // the "with whom?" step for the relationship kinds (Met / First Date / Wedding).
  const { subject, candidates, neighbors } = useLoaderData() as {
    subject: Subject;
    candidates?: RelationshipCandidate[];
    neighbors?: RelationshipNeighbor[];
  };
  const subjectPath = `${entityBasePath(subject.type)}/${subject.id}`;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, to: subjectPath },
          { label: "Add milestone" },
        ]}
      />
      <MilestoneForm
        subjectType={subject.type}
        candidates={candidates}
        neighbors={neighbors}
        cancelTo={subjectPath}
      />
    </main>
  );
}
