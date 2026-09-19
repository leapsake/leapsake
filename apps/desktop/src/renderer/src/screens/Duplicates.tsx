import type { DuplicateCandidate } from "@leapsake/core";
import { Breadcrumbs } from "@leapsake/ui/web";
import { homeCrumb } from "../lib/crumbs";
import { Link, useFetcher, useLoaderData } from "react-router-dom";

/** Human-friendly tier copy; falls back to the raw tier if ever extended. */
const TIER_LABEL: Record<string, string> = {
  high: "Very likely the same",
  medium: "Possibly the same",
};

/** The candidates to review, plus the person the screen is scoped to (if any) —
 *  `null` is the unscoped "review everything" view. */
export interface DuplicatesData {
  candidates: DuplicateCandidate[];
  /** The just-created / just-inspected person, when arriving scoped. */
  focus: { id: string; name: string } | null;
}

/**
 * Duplicate pairs with their reasons, to merge or mark "Not the same". With
 * `?for=<personId>` it is a prompt about one person, which always moves on.
 */
export function Duplicates() {
  const { candidates, focus } = useLoaderData() as DuplicatesData;
  const scoped = focus !== null;

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb]} />
      <h1>
        {scoped ? "Is this someone you already have?" : "Review duplicates"}
      </h1>

      {candidates.length === 0 ? (
        <>
          <p>
            {scoped
              ? "Nothing else looks like the same person."
              : "No possible duplicates found."}
          </p>
          {scoped && <p>{<Link to={`/people/${focus.id}`}>Continue</Link>}</p>}
        </>
      ) : (
        <>
          <p>
            {scoped ? (
              <>
                <strong>{focus.name}</strong> looks like{" "}
                {candidates.length === 1
                  ? "someone already in your list"
                  : "people already in your list"}
                . Merge if they're the same; mark the rest so they stop being
                suggested.
              </>
            ) : (
              <>
                These pairs look like they might be the same person. Merge the
                ones that are; mark the rest so they stop being suggested.
              </>
            )}
          </p>
          <ul>
            {candidates.map((candidate) => (
              <DuplicateRow
                key={`${candidate.a.id}:${candidate.b.id}`}
                candidate={candidate}
              />
            ))}
          </ul>
          {/* Never a dead end: the prompt is skippable, and the pairs stay
              outstanding (and re-linked from three other surfaces) if it is. */}
          {scoped && (
            <p>
              <Link to={`/people/${focus.id}`}>Not now</Link>
            </p>
          )}
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
