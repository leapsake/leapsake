import type { Milestone, MilestoneSubjectType } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { MilestoneForm } from "../components/MilestoneForm";
import { entityBasePath } from "../lib/entityLabel";

/** The subject entity the edited milestone hangs off of. */
interface Subject {
  type: MilestoneSubjectType;
  id: string;
  label: string;
}

export function MilestoneEdit() {
  const { subject, milestone } = useLoaderData() as {
    subject: Subject;
    milestone: Milestone;
  };
  const subjectPath = `${entityBasePath(subject.type)}/${subject.id}`;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, to: subjectPath },
          { label: "Edit milestone" },
        ]}
      />
      <MilestoneForm
        subjectType={subject.type}
        milestone={milestone}
        cancelTo={subjectPath}
      />
    </main>
  );
}
