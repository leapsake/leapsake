import type {
  Milestone,
  MilestoneBearerType,
  ReminderRuleInput,
} from "@leapsake/schema";
import { Breadcrumbs, MilestoneForm } from "@leapsake/ui/web";
import { entityBasePath } from "@leapsake/ui/headless";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { useSubmitting } from "../lib/useSubmitting";

/** The bearer entity the edited milestone hangs off of. */
interface Bearer {
  type: MilestoneBearerType;
  id: string;
  label: string;
}

export function MilestoneEdit() {
  const { bearer, milestone, reminderSchedule } = useLoaderData() as {
    bearer: Bearer;
    milestone: Milestone;
    reminderSchedule: ReminderRuleInput[];
  };
  const bearerPath = `${entityBasePath(bearer.type)}/${bearer.id}`;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: bearer.label, href: bearerPath },
          { label: "Edit milestone" },
        ]}
      />
      <MilestoneForm
        bearerType={bearer.type}
        milestone={milestone}
        initialSchedule={reminderSchedule}
        cancelTo={bearerPath}
        submitting={useSubmitting()}
      />
    </main>
  );
}
