import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type MilestoneBearerType,
  formatMilestoneDate,
  kindDefs,
  milestoneLabel,
} from "@leapsake/schema";
import { MilestoneForm, type MilestoneFormValue } from "./MilestoneForm";
import { styles } from "../lib/styles";

/**
 * Milestones on the **create** screen, where there is no bearer to write them to
 * yet: each one is held in a plain array and written after `core.people.create`
 * (or `core.pets.create`) returns an id. Nothing here touches the database — the
 * counterpart for a saved entity is {@link MilestonesSection}, whose rows edit in
 * place through pushed routes.
 *
 * The form itself is the same {@link MilestoneForm} those routes use, in `inline`
 * mode, so a staged milestone gets the identical fields, the identical validation,
 * and the identical reminder schedule as one added a minute later from the detail
 * page. Collapsed until asked for: the common case is a name and a Save.
 */
export function StagedMilestonesSection({
  bearerType,
  entries,
  onChange,
}: {
  bearerType: MilestoneBearerType;
  entries: MilestoneFormValue[];
  onChange: (entries: MilestoneFormValue[]) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Milestones</Text>
        {!adding && (
          <Pressable accessibilityRole="button" onPress={() => setAdding(true)}>
            <Text style={styles.link}>Add milestone</Text>
          </Pressable>
        )}
      </View>

      {entries.map((entry, index) => {
        const icon = kindDefs[entry.kind].icon;
        const date = formatMilestoneDate(entry);
        return (
          <View key={index} style={styles.row}>
            <Text style={styles.rowText}>
              {icon ? `${icon} ` : ""}
              {milestoneLabel(entry)}
            </Text>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>{date === "" ? "—" : date}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => onChange(entries.filter((_, i) => i !== index))}
              >
                <Text style={[styles.link, styles.danger]}>Remove</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {adding ? (
        <MilestoneForm
          inline
          // Remounts on a bearer-type change so the kind picker re-seeds from the
          // new type's kinds; the create screen discards staged entries anyway.
          key={bearerType}
          bearerType={bearerType}
          submitLabel="Add"
          onCancel={() => setAdding(false)}
          onSubmit={async (value) => {
            onChange([...entries, value]);
            setAdding(false);
          }}
        />
      ) : entries.length === 0 ? (
        <Text style={styles.muted}>No milestones yet.</Text>
      ) : null}
    </View>
  );
}
