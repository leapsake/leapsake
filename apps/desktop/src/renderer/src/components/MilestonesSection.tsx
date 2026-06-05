import {
  type Milestone,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
} from "@leapsake/schema";
import { Link } from "react-router-dom";
import { entityBasePath } from "../lib/entityLabel";

/**
 * The Milestones section shared by the Person and Pet view screens — the dated
 * facts of a subject's life (birthdays today, the big dates generally). Mirrors
 * {@link RelationshipsSection}: it lists the milestones the loader fetched, each
 * shown as `{icon} {label} — {date}` with edit/remove links, plus an
 * "Add milestone" affordance. v1 handles `person`/`pet` subjects; the schema and
 * data layers already accept `relationship` subjects for later.
 */
export function MilestonesSection({
  subjectType,
  subjectId,
  milestones,
}: {
  subjectType: "person" | "pet";
  subjectId: string;
  milestones: Milestone[];
}) {
  const basePath = `${entityBasePath(subjectType)}/${subjectId}`;

  return (
    <section>
      <header>
        <h2>Milestones</h2>
        <Link to={`${basePath}/milestones/new`}>Add milestone</Link>
      </header>
      {milestones.length === 0 ? (
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
            {milestones.map((milestone) => {
              const icon = kindDefs[milestone.kind].icon;
              const date = formatMilestoneDate(milestone);
              return (
                <tr key={milestone.id}>
                  <td>
                    {icon ? `${icon} ` : ""}
                    {milestoneLabel(milestone)}
                  </td>
                  <td>{date === "" ? "—" : date}</td>
                  <td>
                    <Link to={`${basePath}/milestones/${milestone.id}/edit`}>
                      Edit
                    </Link>{" "}
                    <Link to={`${basePath}/milestones/${milestone.id}/delete`}>
                      Remove
                    </Link>
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
