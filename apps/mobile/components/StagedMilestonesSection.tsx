import {
  type MilestoneBearerType,
  type MilestoneDraft,
  formatMilestoneDate,
  kindDefs,
  milestoneDraftOf,
  milestoneInputOf,
  milestoneLabel,
} from "@leapsake/schema";
import { MilestoneFields, milestoneDraftEmpty } from "./MilestoneFields";
import { DraftRow } from "./DraftRow";
import { RecordSection } from "./RecordSection";

/** A milestone being created on the form; the key survives earlier removals. */
export interface StagedMilestone {
  key: string;
  draft: MilestoneDraft;
}

/** No date, no note: neither written nor holding up the Save. The kind is
 *  only the picker's default. */
export function milestoneRowPending(row: StagedMilestone): boolean {
  return milestoneDraftEmpty(row.draft);
}

/** Whether a row would either write cleanly or be skipped — the Save gate. */
export function milestoneRowValid(row: StagedMilestone): boolean {
  return milestoneRowPending(row) || milestoneInputOf(row.draft).ok;
}

/**
 * Milestones staged on the create form, every row open, with the same
 * {@link MilestoneFields} as every milestone route, schedules folded away.
 */
export function StagedMilestonesSection({
  bearerType,
  entries,
  onChange,
}: {
  bearerType: MilestoneBearerType;
  entries: StagedMilestone[];
  onChange: (entries: StagedMilestone[]) => void;
}) {
  return (
    <RecordSection
      title="Milestones"
      link={{
        what: "milestone",
        action: "add",
        onPress: () =>
          onChange([
            ...entries,
            {
              key: crypto.randomUUID(),
              draft: milestoneDraftOf({ bearerType }),
            },
          ]),
      }}
      isEmpty={entries.length === 0}
      emptyText="No milestones yet."
    >
      {entries.map((entry) => {
        const shaped = milestoneInputOf(entry.draft);
        const label = milestoneLabel({
          kind: entry.draft.kind,
          note: entry.draft.note.trim() || null,
        });
        const icon = kindDefs[entry.draft.kind].icon;
        const date = shaped.ok ? formatMilestoneDate(shaped.input) : "";
        return (
          <DraftRow
            key={entry.key}
            label={
              <>
                {icon ? `${icon} ` : ""}
                {label}
                {date === "" ? "" : ` · ${date}`}
              </>
            }
            subject={label}
            onRemove={() =>
              onChange(entries.filter((e) => e.key !== entry.key))
            }
          >
            <MilestoneFields
              collapseSchedule
              bearerType={bearerType}
              draft={entry.draft}
              errors={shaped.ok ? {} : shaped.errors}
              onChange={(draft) =>
                onChange(
                  entries.map((e) =>
                    e.key === entry.key ? { ...e, draft } : e,
                  ),
                )
              }
            />
          </DraftRow>
        );
      })}
    </RecordSection>
  );
}
