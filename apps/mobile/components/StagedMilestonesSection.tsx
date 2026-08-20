import { Pressable, Text, View } from "react-native";
import {
  type Milestone,
  type MilestoneBearerType,
  type ReminderRuleInput,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
} from "@leapsake/schema";
import {
  type MilestoneDraft,
  MilestoneFields,
  emptyMilestoneDraft,
  milestoneDraftEmpty,
  milestoneDraftFrom,
  milestoneDraftToValue,
  milestoneDraftValid,
} from "./MilestoneFields";
import { styles } from "../lib/styles";

/**
 * A milestone being authored on a form, plus a client-minted key.
 *
 * The key exists so a staged *gift* can name this milestone as its occasion
 * before either of them is written: the screen maps the key to the real id as it
 * writes, and rewrites the gift's occasion onto it (`resolveStagedOccasion`). A
 * uuid rather than a counter or an array index — an occasion's id is a
 * `z.uuid()`, so the placeholder stays shape-valid while it sits in form state,
 * and it survives removing an earlier row. A row seeded from a **saved**
 * milestone keys on that milestone's id, which is already a real occasion target.
 */
export interface StagedMilestone {
  key: string;
  draft: MilestoneDraft;
  /**
   * The milestone this row was read back from, on the edit screen. Absent on a
   * row added to the form, which is the whole difference between a create and an
   * update when the form is applied.
   */
  saved?: Milestone;
  /**
   * Whether it has been typed into here. Only an edited row is written back: an
   * untouched one is a faithful copy of what is already stored, and re-writing it
   * would touch `updatedAt` for nothing.
   */
  edited?: boolean;
}

/**
 * A saved milestone as a staged row. The reminder schedule comes from the screen
 * rather than from a fetch here: the row shows it, so it has to be the stored one
 * from the start, and the screen that seeds a whole form of these reads them all
 * in the one pass ({@link EntityEditForm}).
 */
export function stagedMilestoneOf(
  milestone: Milestone,
  reminderSchedule: ReminderRuleInput[],
): StagedMilestone {
  return {
    key: milestone.id,
    saved: milestone,
    draft: milestoneDraftFrom(milestone, reminderSchedule),
  };
}

/**
 * A row added here that says nothing yet — no date, no note. Neither written nor
 * allowed to hold up the Save, for the reason {@link contactRowPending} gives: a
 * blank row is a question the user declined to answer, and the kind showing in it
 * is the picker's default rather than an answer of theirs.
 */
export function milestoneRowPending(row: StagedMilestone): boolean {
  return row.saved === undefined && milestoneDraftEmpty(row.draft);
}

/** Whether a row would either write cleanly or be skipped — the Save gate. */
export function milestoneRowValid(row: StagedMilestone): boolean {
  return milestoneRowPending(row) || milestoneDraftValid(row.draft);
}

/**
 * Milestones on the **create** and **edit** screens, where nothing is written
 * until the form is saved: each one is held in a plain array, and the screen
 * turns that array into `core.milestones.create/update/softDelete` calls in one
 * pass. Nothing here touches the database — the counterpart on a detail screen is
 * {@link MilestonesSection}, which is read-only now that this is where milestones
 * are revised.
 *
 * **Every row is open**, for the reason {@link StagedContactsSection} gives: a
 * date you can retype is the same kind of thing as the name at the top of the
 * screen, and a sub-form with its own Save asked the user to believe that Save
 * meant something different from the form's. The fields are the same
 * {@link MilestoneFields} the relationship screen's routes put on a screen of
 * their own, so a milestone gets identical fields and identical validation
 * wherever it is authored — with its reminder schedule folded away, since a form
 * of four open milestones would otherwise be nothing but reminder rules.
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
            {/* What the row is, next to the way out of it — the same line the
                collapsed row used to be, kept because it is the only thing that
                says which milestone's Remove this is. */}
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
                    e.key === entry.key ? { ...e, draft, edited: true } : e,
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
