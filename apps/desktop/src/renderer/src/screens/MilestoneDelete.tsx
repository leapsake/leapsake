import {
  type Milestone,
  type MilestoneSubjectType,
  formatMilestoneDate,
  milestoneLabel,
} from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { entityBasePath } from "../lib/entityLabel";

/** The subject entity the milestone being removed hangs off of. */
interface Subject {
  type: MilestoneSubjectType;
  id: string;
  label: string;
}

export function MilestoneDelete() {
  const { subject, milestone } = useLoaderData() as {
    subject: Subject;
    milestone: Milestone;
  };
  const subjectPath = `${entityBasePath(subject.type)}/${subject.id}`;
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

  const date = formatMilestoneDate(milestone);

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, to: subjectPath },
          { label: "Remove milestone" },
        ]}
      />
      <h1>Remove milestone?</h1>
      <p>
        Remove {milestoneLabel(milestone).toLowerCase()}
        {date === "" ? "" : ` (${date})`} from {subject.label}?
      </p>

      <Form method="post">
        <fieldset disabled={deleting}>
          <button type="submit">Remove</button>{" "}
          <Link to={subjectPath}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
