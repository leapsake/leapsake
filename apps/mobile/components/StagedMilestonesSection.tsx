import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type Milestone,
  type MilestoneBearerType,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { MilestoneForm, type MilestoneFormValue } from "./MilestoneForm";
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
export interface StagedMilestone extends MilestoneFormValue {
  key: string;
  /**
   * The milestone this row was read back from, on the edit screen. Absent on a
   * row added to the form, which is the whole difference between a create and an
   * update when the form is applied.
   */
  saved?: Milestone;
  /**
   * Whether this row's editor has been submitted here. Only an edited row is
   * written back: an untouched one is a faithful copy of what is already stored,
   * and re-writing it would touch `updatedAt` for nothing — and would write the
   * placeholder schedule below over the milestone's real one.
   */
  edited?: boolean;
}

/**
 * A saved milestone as a staged row. Its `reminderSchedule` is a **placeholder**
 * — the kind's defaults rather than the milestone's stored rules, which live a
 * fetch away. Nothing reads it: an unedited row is never written, and opening the
 * editor hands {@link MilestoneForm} the `saved` milestone, which loads the real
 * schedule itself.
 */
export function stagedMilestoneOf(milestone: Milestone): StagedMilestone {
  return {
    key: milestone.id,
    saved: milestone,
    kind: milestone.kind,
    year: milestone.year,
    month: milestone.month,
    day: milestone.day,
    note: milestone.note,
    reminderSchedule: resolveReminderSchedule(milestone.kind, []),
  };
}

/**
 * Milestones on the **create** and **edit** screens, where nothing is written
 * until the form is saved: each one is held in a plain array, and the screen
 * turns that array into `core.milestones.create/update/softDelete` calls in one
 * pass. Nothing here touches the database — the counterpart on a detail screen is
 * {@link MilestonesSection}, which is read-only now that this is where milestones
 * are revised.
 *
 * The form itself is the same {@link MilestoneForm} the relationship screen's
 * routes use, in `inline` mode, so a staged milestone gets the identical fields,
 * the identical validation, and the identical reminder schedule wherever it is
 * authored. Collapsed until asked for: the common case is a name and a Save.
 *
 * A row seeded from a saved milestone opens on the milestone itself (which loads
 * its stored reminder schedule); a row already edited here opens on what the user
 * last left in it. Removing a row only takes it out of the list — the deletion,
 * like everything else, happens when the form is saved.
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
  // Which row's editor is open, by key — or "new" for the add form. One at a
  // time, so a section of open drafts can't disagree about the same list.
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Milestones</Text>
        {open === null && (
          <Pressable accessibilityRole="button" onPress={() => setOpen("new")}>
            <Text style={styles.link}>Add milestone</Text>
          </Pressable>
        )}
      </View>

      {entries.map((entry) => {
        const icon = kindDefs[entry.kind].icon;
        const date = formatMilestoneDate(entry);
        if (open === entry.key) {
          return (
            <MilestoneForm
              key={entry.key}
              inline
              bearerType={bearerType}
              // An untouched row opens on the stored milestone so the editor can
              // load its real reminder schedule; once edited here, the draft the
              // user left behind is the truer starting point.
              milestone={entry.edited === true ? undefined : entry.saved}
              value={
                entry.edited === true || entry.saved === undefined
                  ? entry
                  : undefined
              }
              submitLabel="Save"
              onCancel={close}
              onSubmit={async (value) => {
                onChange(
                  entries.map((e) =>
                    e.key === entry.key ? { ...e, ...value, edited: true } : e,
                  ),
                );
                close();
              }}
            />
          );
        }
        return (
          <View key={entry.key} style={styles.row}>
            <Text style={styles.rowText}>
              {icon ? `${icon} ` : ""}
              {milestoneLabel(entry)}
            </Text>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>{date === "" ? "—" : date}</Text>
              <View style={styles.rowActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${milestoneLabel(entry)}`}
                  onPress={() => setOpen(entry.key)}
                >
                  <Text style={styles.link}>Edit</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${milestoneLabel(entry)}`}
                  onPress={() =>
                    onChange(entries.filter((e) => e.key !== entry.key))
                  }
                >
                  <Text style={[styles.link, styles.danger]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}

      {open === "new" ? (
        <MilestoneForm
          inline
          // Remounts on a bearer-type change so the kind picker re-seeds from the
          // new type's kinds; the create screen discards staged entries anyway.
          key={bearerType}
          bearerType={bearerType}
          submitLabel="Add"
          onCancel={close}
          onSubmit={async (value) => {
            onChange([...entries, { ...value, key: crypto.randomUUID() }]);
            close();
          }}
        />
      ) : entries.length === 0 ? (
        <Text style={styles.muted}>No milestones yet.</Text>
      ) : null}
    </View>
  );
}
