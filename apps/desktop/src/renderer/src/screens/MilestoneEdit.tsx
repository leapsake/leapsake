import type { Milestone, MilestoneBearerType } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { MilestoneForm } from "../components/MilestoneForm";
import { entityBasePath } from "../lib/entityLabel";

/** The bearer entity the edited milestone hangs off of. */
interface Bearer {
  type: MilestoneBearerType;
  id: string;
  label: string;
}

export function MilestoneEdit() {
  const { bearer, milestone } = useLoaderData() as {
    bearer: Bearer;
    milestone: Milestone;
  };
  const bearerPath = `${entityBasePath(bearer.type)}/${bearer.id}`;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: bearer.label, to: bearerPath },
          { label: "Edit milestone" },
        ]}
      />
      <MilestoneForm
        bearerType={bearer.type}
        milestone={milestone}
        cancelTo={bearerPath}
      />
    </main>
  );
}
