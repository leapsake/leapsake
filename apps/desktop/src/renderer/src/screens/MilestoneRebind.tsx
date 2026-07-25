import {
  type Milestone,
  type MilestoneBearerType,
  type RelationshipNeighbor,
  milestoneLabel,
} from "@leapsake/schema";
import { Breadcrumbs } from "@leapsake/ui/web";
import { useState } from "react";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import type { RelationshipCandidate } from "../components/RelationshipForm";
import { WithWhomFields } from "../components/WithWhomFields";
import { homeCrumb } from "../lib/crumbs";

/** The Person whose unbound milestone is being linked to a relationship. */
interface Bearer {
  type: MilestoneBearerType;
  id: string;
  label: string;
}

/**
 * Rebind an unbound relationship-kind milestone (a Wedding stored on a Person
 * while its spouse was unknown) to a relationship — reusing the same
 * {@link WithWhomFields} picker the add flow uses. Submitting re-points the
 * milestone's bearer to the chosen/created relationship.
 */
export function MilestoneRebind() {
  const { bearer, milestone, candidates, neighbors } = useLoaderData() as {
    bearer: Bearer;
    milestone: Milestone;
    candidates: RelationshipCandidate[];
    neighbors: RelationshipNeighbor[];
  };
  const bearerPath = `/people/${bearer.id}`;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [ready, setReady] = useState(false);

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: bearer.label, href: bearerPath },
          { label: "Set spouse" },
        ]}
      />
      <Form method="post">
        <header>
          <h1>Set spouse</h1>
          <button type="submit" disabled={submitting || !ready}>
            Link
          </button>{" "}
          <Link to={bearerPath}>Cancel</Link>
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
