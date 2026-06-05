import {
  type Milestone,
  type MilestoneSubjectType,
  type RelationshipNeighbor,
  milestoneLabel,
} from "@leapsake/schema";
import { useState } from "react";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import type { RelationshipCandidate } from "../components/RelationshipForm";
import { WithWhomFields } from "../components/WithWhomFields";

/** The Person whose unbound milestone is being linked to a relationship. */
interface Subject {
  type: MilestoneSubjectType;
  id: string;
  label: string;
}

/**
 * Rebind an unbound relationship-kind milestone (a Wedding stored on a Person
 * while its spouse was unknown) to a relationship — reusing the same
 * {@link WithWhomFields} picker the add flow uses. Submitting re-points the
 * milestone's subject to the chosen/created relationship.
 */
export function MilestoneRebind() {
  const { subject, milestone, candidates, neighbors } = useLoaderData() as {
    subject: Subject;
    milestone: Milestone;
    candidates: RelationshipCandidate[];
    neighbors: RelationshipNeighbor[];
  };
  const subjectPath = `/people/${subject.id}`;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [ready, setReady] = useState(false);

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, to: subjectPath },
          { label: "Set spouse" },
        ]}
      />
      <Form method="post">
        <header>
          <h1>Set spouse</h1>
          <button type="submit" disabled={submitting || !ready}>
            Link
          </button>{" "}
          <Link to={subjectPath}>Cancel</Link>
        </header>
        <p>Link {milestoneLabel(milestone).toLowerCase()} to a relationship.</p>
        <fieldset disabled={submitting}>
          <WithWhomFields
            kind={milestone.kind}
            candidates={candidates}
            neighbors={neighbors}
            allowUnbound={false}
            onReadyChange={setReady}
          />
        </fieldset>
      </Form>
    </main>
  );
}
