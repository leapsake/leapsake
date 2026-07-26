import {
  type MilestoneBearerType,
  type MilestoneTimelineEntry,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
  preferredBearerType,
} from "@leapsake/schema";
import { entityBasePath } from "../../headless/routes.js";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { DataTable } from "../primitives/DataTable.js";
import { EmptyState, Section } from "../primitives/Section.js";

/**
 * The Milestones section shared by the Person, Pet, and Relationship view
 * screens — the dated facts of a bearer's life. It renders a {@link
 * MilestoneTimelineEntry} list: an entry's **own** milestones are editable in
 * place (Edit / Remove), while milestones drawn from a relationship the bearer
 * participates in are shown **read-only** (labelled with the other party) and
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
  const m = useMessages();
  const basePath = `${entityBasePath(bearerType)}/${bearerId}`;

  return (
    <Section
      title={m.milestones.title}
      actions={
        <Link href={`${basePath}/milestones/new`}>{m.milestones.add}</Link>
      }
    >
      {entries.length === 0 ? (
        <EmptyState>{m.milestones.empty}</EmptyState>
      ) : (
        <DataTable
          items={entries}
          getKey={(entry) => entry.milestone.id}
          columns={[
            {
              header: m.milestones.columnMilestone,
              cell: (entry) => {
                const icon = kindDefs[entry.milestone.kind].icon;
                const label = milestoneLabel(entry.milestone);
                const named =
                  entry.origin === "relationship" && entry.otherLabel
                    ? m.milestones.withPartner(label, entry.otherLabel)
                    : label;
                return `${icon ? `${icon} ` : ""}${named}`;
              },
            },
            {
              header: m.milestones.columnDate,
              cell: (entry) => {
                const date = formatMilestoneDate(entry.milestone);
                return date === "" ? m.common.none : date;
              },
            },
            {
              header: "",
              cell: (entry) => {
                const milestone = entry.milestone;
                if (entry.origin === "relationship") {
                  return (
                    <Link href={`/relationships/${entry.relationshipId}`}>
                      {m.milestones.view}
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
                    <Link href={`${milestonePath}/edit`}>{m.common.edit}</Link>{" "}
                    <Link href={`${milestonePath}/delete`}>
                      {m.common.remove}
                    </Link>
                    {canRebind ? (
                      <>
                        {" "}
                        <Link href={`${milestonePath}/rebind`}>
                          {m.milestones.setSpouse}
                        </Link>
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
