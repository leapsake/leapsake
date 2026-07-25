import {
  type MilestoneBearerType,
  type MilestoneTimelineEntry,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
  preferredBearerType,
} from "@leapsake/schema";
import { entityBasePath } from "../../headless/routes.js";
import { useUi } from "../adapter.js";
import { DataTable } from "../primitives/DataTable.js";
import { EmptyState, Section } from "../primitives/Section.js";

/**
 * The Milestones section shared by the Person, Pet, and Relationship view
 * screens — the dated facts of a bearer's life. It renders a {@link
 * MilestoneTimelineEntry} list: an entry's **own** milestones are editable in
 * place (Edit / Remove), while milestones drawn from a relationship the bearer
 * participates in are shown **read-only** (labelled “· with <partner>”) with a
 * link out to the relationship's page — its single, canonical edit surface.
 *
 * An unbound relationship-kind milestone (a Wedding stored on a Person while its
 * spouse was unknown) additionally offers a “Set spouse” affordance to bind it
 * to a relationship later.
 */
export function MilestonesSection({
  bearerType,
  bearerId,
  entries,
}: {
  bearerType: MilestoneBearerType;
  bearerId: string;
  entries: readonly MilestoneTimelineEntry[];
}) {
  const { Link } = useUi();
  const basePath = `${entityBasePath(bearerType)}/${bearerId}`;

  return (
    <Section
      title="Milestones"
      actions={<Link href={`${basePath}/milestones/new`}>Add milestone</Link>}
    >
      {entries.length === 0 ? (
        <EmptyState>No milestones yet.</EmptyState>
      ) : (
        <DataTable
          items={entries}
          getKey={(entry) => entry.milestone.id}
          columns={[
            {
              header: "Milestone",
              cell: (entry) => {
                const icon = kindDefs[entry.milestone.kind].icon;
                return (
                  <>
                    {icon ? `${icon} ` : ""}
                    {milestoneLabel(entry.milestone)}
                    {entry.origin === "relationship" && entry.otherLabel
                      ? ` · with ${entry.otherLabel}`
                      : ""}
                  </>
                );
              },
            },
            {
              header: "Date",
              cell: (entry) => {
                const date = formatMilestoneDate(entry.milestone);
                return date === "" ? "—" : date;
              },
            },
            {
              header: "",
              cell: (entry) => {
                const milestone = entry.milestone;
                if (entry.origin === "relationship") {
                  return (
                    <Link href={`/relationships/${entry.relationshipId}`}>
                      View
                    </Link>
                  );
                }
                // An unbound relationship-kind milestone (e.g. a Wedding stored
                // on the Person while its spouse was unknown) can be bound later.
                const canRebind =
                  bearerType === "person" &&
                  milestone.bearerType === "person" &&
                  preferredBearerType(milestone.kind) === "relationship";
                const milestonePath = `${basePath}/milestones/${milestone.id}`;
                return (
                  <>
                    <Link href={`${milestonePath}/edit`}>Edit</Link>{" "}
                    <Link href={`${milestonePath}/delete`}>Remove</Link>
                    {canRebind ? (
                      <>
                        {" "}
                        <Link href={`${milestonePath}/rebind`}>Set spouse</Link>
                      </>
                    ) : null}
                  </>
                );
              },
            },
          ]}
        />
      )}
    </Section>
  );
}
