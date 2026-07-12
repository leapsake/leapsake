import type {
  MilestoneBearerType,
  RelationshipNeighbor,
} from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { MilestoneForm } from "../components/MilestoneForm";
import type { RelationshipCandidate } from "../components/RelationshipForm";
import { entityBasePath } from "../lib/entityLabel";

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

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: bearer.label, to: bearerPath },
          { label: "Add milestone" },
        ]}
      />
      <MilestoneForm
        bearerType={bearer.type}
        candidates={candidates}
        neighbors={neighbors}
        cancelTo={bearerPath}
      />
    </main>
  );
}
