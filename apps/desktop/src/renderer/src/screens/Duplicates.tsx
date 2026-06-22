import type { DuplicateCandidate } from "@leapsake/core";
import { Link, useFetcher, useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";

/** Human-friendly tier copy; falls back to the raw tier if ever extended. */
const TIER_LABEL: Record<string, string> = {
  high: "Very likely the same",
  medium: "Possibly the same",
};

/**
 * Review duplicates — the detection surface (reconciliation Increment B). Lists
 * candidate pairs the detector proposes, each with the reasons it matched, and
 * two actions: **Merge…** (reuses the Increment A confirm flow, with the
 * duplicate preselected) and **Not the same** (records the pair so no device
 * re-nags). It only proposes; the merge itself still goes through the confirm.
 */
export function Duplicates() {
  const candidates = useLoaderData() as DuplicateCandidate[];

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb]} />
      <h1>Review duplicates</h1>

      {candidates.length === 0 ? (
        <p>No possible duplicates found.</p>
      ) : (
        <>
          <p>
            These pairs look like they might be the same person. Merge the ones
            that are; mark the rest so they stop being suggested.
          </p>
          <ul>
            {candidates.map((candidate) => (
              <DuplicateRow
                key={`${candidate.a.id}:${candidate.b.id}`}
                candidate={candidate}
              />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function DuplicateRow({ candidate }: { candidate: DuplicateCandidate }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const { a, b, tier, reasons } = candidate;

  return (
    <li>
      <p>
        <strong>{a.name}</strong> &amp; <strong>{b.name}</strong>{" "}
        <em>({TIER_LABEL[tier] ?? tier})</em>
      </p>
      <ul>
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <Link to={`/people/${a.id}/merge?loser=${b.id}`}>Merge…</Link>{" "}
      <fetcher.Form method="post" style={{ display: "inline" }}>
        <input type="hidden" name="idA" value={a.id} />
        <input type="hidden" name="idB" value={b.id} />
        <button type="submit" disabled={busy}>
          Not the same
        </button>
      </fetcher.Form>
    </li>
  );
}
