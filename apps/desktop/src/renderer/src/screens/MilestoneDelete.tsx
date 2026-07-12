import {
  type Milestone,
  type MilestoneBearerType,
  formatMilestoneDate,
  milestoneLabel,
} from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { entityBasePath } from "../lib/entityLabel";

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
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

  const date = formatMilestoneDate(milestone);

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: bearer.label, to: bearerPath },
          { label: "Remove milestone" },
        ]}
      />
      <h1>Remove milestone?</h1>
      <p>
        Remove {milestoneLabel(milestone).toLowerCase()}
        {date === "" ? "" : ` (${date})`} from {bearer.label}?
      </p>

      <Form method="post">
        <fieldset disabled={deleting}>
          <button type="submit">Remove</button>{" "}
          <Link to={bearerPath}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
