import type {
  MilestoneBearerType,
  MilestoneKind,
  RelationshipNeighbor,
} from "@leapsake/schema";
import { isMilestoneKind } from "@leapsake/schema";
import {
  Breadcrumbs,
  MilestoneForm,
  type RelationshipCandidate,
} from "@leapsake/ui/web";
import { entityBasePath } from "@leapsake/ui/headless";
import { useLoaderData, useSearchParams } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { useSubmitting } from "../lib/useSubmitting";

/** The bearer entity a new milestone hangs off of. */
interface Bearer {
  type: MilestoneBearerType;
  id: string;
  label: string;
}

export function MilestoneCreate() {
  // Present only for a Person, for the relationship kinds' "with whom?" step.
  const { bearer, candidates, neighbors } = useLoaderData() as {
    bearer: Bearer;
    candidates?: RelationshipCandidate[];
    neighbors?: RelationshipNeighbor[];
  };
  const bearerPath = `${entityBasePath(bearer.type)}/${bearer.id}`;
  // `?kind=`, from the partnership question's CTA. Validated, not cast: the
  // user can edit a URL.
  const requested = useSearchParams()[0].get("kind");
  const initialKind: MilestoneKind | undefined = isMilestoneKind(requested)
    ? requested
    : undefined;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: bearer.label, href: bearerPath },
          { label: "Add milestone" },
        ]}
      />
      <MilestoneForm
        bearerType={bearer.type}
        initialKind={initialKind}
        candidates={candidates}
        neighbors={neighbors}
        cancelTo={bearerPath}
        submitting={useSubmitting()}
      />
    </main>
  );
}
