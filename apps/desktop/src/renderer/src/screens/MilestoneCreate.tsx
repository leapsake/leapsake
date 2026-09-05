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
  // `candidates`/`neighbors` are present only for a Person bearer — they drive
  // the "with whom?" step for the relationship kinds (Met / First Date / Wedding).
  const { bearer, candidates, neighbors } = useLoaderData() as {
    bearer: Bearer;
    candidates?: RelationshipCandidate[];
    neighbors?: RelationshipNeighbor[];
  };
  const bearerPath = `${entityBasePath(bearer.type)}/${bearer.id}`;
  // `?kind=` opens the form on a chosen kind. Set by the partnership question's
  // CTA ("when is your wedding anniversary?"), which would otherwise hand the
  // question back as a blank picker. Validated rather than cast: it arrives from
  // a URL the user can edit.
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
