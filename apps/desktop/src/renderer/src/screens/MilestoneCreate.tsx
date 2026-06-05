import type { EntityType } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { MilestoneForm } from "../components/MilestoneForm";
import { entityBasePath } from "../lib/entityLabel";

/** The subject entity a new milestone hangs off of. */
interface Subject {
  type: EntityType;
  id: string;
  label: string;
}

export function MilestoneCreate() {
  const { subject } = useLoaderData() as { subject: Subject };
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
      <MilestoneForm subjectType={subject.type} cancelTo={subjectPath} />
    </main>
  );
}
