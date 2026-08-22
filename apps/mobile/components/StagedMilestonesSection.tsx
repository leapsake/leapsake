import { Pressable, Text, View } from "react-native";
import {
  type MilestoneBearerType,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
} from "@leapsake/schema";
import {
  type MilestoneDraft,
  MilestoneFields,
  emptyMilestoneDraft,
  milestoneDraftEmpty,
  milestoneDraftToValue,
  milestoneDraftValid,
} from "./MilestoneFields";
import { styles } from "../lib/styles";

/**
 * A milestone being authored on the create form, plus a client-minted key.
 *
 * The key is a uuid rather than a counter or an array index: it once had to
 * stand in for the milestone's real id, so that a staged *gift* could name it as
 * an occasion before either was written, and an occasion's id is a `z.uuid()`. A
 * gift names nothing but its recipient now, so the key is only a React key —
 * kept a uuid because it must survive removing an earlier row.
 */
export interface StagedMilestone {
  key: string;
  draft: MilestoneDraft;
}

/**
 * A row that says nothing yet — no date, no note. Neither written nor allowed to
 * hold up the Save, for the reason {@link contactRowPending} gives: a blank row
 * is a question the user declined to answer, and the kind showing in it is the
 * picker's default rather than an answer of theirs.
 */
export function milestoneRowPending(row: StagedMilestone): boolean {
  return milestoneDraftEmpty(row.draft);
}

/** Whether a row would either write cleanly or be skipped — the Save gate. */
export function milestoneRowValid(row: StagedMilestone): boolean {
  return milestoneRowPending(row) || milestoneDraftValid(row.draft);
}

/**
 * Milestones on the **create** screen, where nothing is written until the form
 * is saved: each one is held in a plain array, and the screen turns that array
 * into `core.milestones.create` calls in one pass. Nothing here touches the
 * database — the counterpart on a detail screen is {@link MilestonesSection},
 * where each milestone is added and revised on a screen of its own.
 *
 * **Every row is open**, for the reason {@link StagedContactsSection} gives: a
 * date you can retype is the same kind of thing as the name at the top of the
 * screen, and a sub-form with its own Save would ask the user to believe that
 * Save meant something different from the form's. The fields are the same
 * {@link MilestoneFields} every milestone route puts on a screen of its own, so
 * a milestone gets identical fields and identical validation wherever it is
 * authored — with its reminder schedule folded away here, since a form of four
 * open milestones would otherwise be nothing but reminder rules.
 *
 * "Add milestone" appends a row; removing takes one out. Both are only edits to
 * the list until the form is saved.
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
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Milestones</Text>
      </View>

      {entries.map((entry) => {
        const value = milestoneDraftToValue(entry.draft);
        const label = milestoneLabel(value);
        const icon = kindDefs[entry.draft.kind].icon;
        const date = formatMilestoneDate(value);
        return (
          <View key={entry.key} style={[styles.row, styles.inlineForm]}>
            {/* What the row is so far, next to the way out of it — the only
                thing that says which milestone's Remove this is. */}
            <View style={styles.sectionHeader}>
              <Text style={styles.fieldLabel}>
                {icon ? `${icon} ` : ""}
                {label}
                {date === "" ? "" : ` · ${date}`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${label}`}
                onPress={() =>
                  onChange(entries.filter((e) => e.key !== entry.key))
                }
              >
                <Text style={[styles.link, styles.danger]}>Remove</Text>
              </Pressable>
            </View>
            <MilestoneFields
              collapseSchedule
              bearerType={bearerType}
              draft={entry.draft}
              onChange={(draft) =>
                onChange(
                  entries.map((e) =>
                    e.key === entry.key ? { ...e, draft } : e,
                  ),
                )
              }
            />
          </View>
        );
      })}

      {entries.length === 0 ? (
        <Text style={styles.muted}>No milestones yet.</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() =>
          onChange([
            ...entries,
            {
              key: crypto.randomUUID(),
              draft: emptyMilestoneDraft(bearerType),
            },
          ])
        }
      >
        <Text style={styles.link}>Add milestone</Text>
      </Pressable>
    </View>
  );
}
