import {
  type Milestone,
  type MilestoneBearerType,
  formatMilestoneDate,
  milestoneLabel,
} from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { entityBasePath } from "../lib/entityLabel";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

/** The bearer entity the milestone being removed hangs off of. */
interface Bearer {
  type: MilestoneBearerType;
  id: string;
  label: string;
}

export function MilestoneDelete() {
  const { bearer, milestone } = useLoaderData() as {
    bearer: Bearer;
    milestone: Milestone;
  };
  const bearerPath = `${entityBasePath(bearer.type)}/${bearer.id}`;
  const date = formatMilestoneDate(milestone);

  return (
    <ConfirmDelete
      trail={[
        homeCrumb,
        { label: bearer.label, href: bearerPath },
        { label: "Remove milestone" },
      ]}
      heading="Remove milestone?"
      confirmLabel="Remove"
      cancelTo={bearerPath}
      submitting={useSubmitting()}
    >
      Remove {milestoneLabel(milestone).toLowerCase()}
      {date === "" ? "" : ` (${date})`} from {bearer.label}?
    </ConfirmDelete>
  );
}
