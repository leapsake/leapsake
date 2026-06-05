import {
  type MilestoneSubjectType,
  type MilestoneTimelineEntry,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
  preferredSubjectType,
} from "@leapsake/schema";
import { Link } from "react-router-dom";
import { entityBasePath } from "../lib/entityLabel";

/**
 * The Milestones section shared by the Person, Pet, and Relationship view
 * screens — the dated facts of a subject's life. It renders a {@link
 * MilestoneTimelineEntry} list: an entry's **own** milestones are editable in
 * place (Edit / Remove), while milestones drawn from a relationship the subject
 * participates in are shown **read-only** (labelled "· with <partner>") with a
 * link out to the relationship's page — its single, canonical edit surface.
 *
 * An unbound relationship-kind milestone (a Wedding stored on a Person while its
 * spouse was unknown) additionally offers a "Set spouse" affordance to bind it
 * to a relationship later.
 */
export function MilestonesSection({
  subjectType,
  subjectId,
  entries,
}: {
  subjectType: MilestoneSubjectType;
  subjectId: string;
  entries: MilestoneTimelineEntry[];
}) {
  const basePath = `${entityBasePath(subjectType)}/${subjectId}`;

  return (
    <section>
      <header>
        <h2>Milestones</h2>
        <Link to={`${basePath}/milestones/new`}>Add milestone</Link>
      </header>
      {entries.length === 0 ? (
        <p>No milestones yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Milestone</th>
              <th>Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const milestone = entry.milestone;
              const icon = kindDefs[milestone.kind].icon;
              const date = formatMilestoneDate(milestone);
              const fromRelationship = entry.origin === "relationship";
              // An unbound relationship-kind milestone (e.g. a Wedding stored on
              // the Person while its spouse was unknown) can be bound later.
              const canRebind =
                subjectType === "person" &&
                entry.origin === "own" &&
                milestone.subjectType === "person" &&
                preferredSubjectType(milestone.kind) === "relationship";
              return (
                <tr key={milestone.id}>
                  <td>
                    {icon ? `${icon} ` : ""}
                    {milestoneLabel(milestone)}
                    {fromRelationship && entry.otherLabel
                      ? ` · with ${entry.otherLabel}`
                      : ""}
                  </td>
                  <td>{date === "" ? "—" : date}</td>
                  <td>
                    {fromRelationship ? (
                      <Link to={`/relationships/${entry.relationshipId}`}>
                        View
                      </Link>
                    ) : (
                      <>
                        <Link
                          to={`${basePath}/milestones/${milestone.id}/edit`}
                        >
                          Edit
                        </Link>{" "}
                        <Link
                          to={`${basePath}/milestones/${milestone.id}/delete`}
                        >
                          Remove
                        </Link>
                        {canRebind ? (
                          <>
                            {" "}
                            <Link
                              to={`${basePath}/milestones/${milestone.id}/rebind`}
                            >
                              Set spouse
                            </Link>
                          </>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
