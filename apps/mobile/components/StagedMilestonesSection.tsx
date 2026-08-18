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
 * A staged milestone plus a client-minted key. The key exists so a staged *gift*
 * can name this milestone as its occasion before either of them is written: the
 * create screen maps the key to the real id as it writes, and rewrites the gift's
 * occasion onto it (`resolveStagedOccasion`). A uuid rather than a counter or an
 * array index — an occasion's id is a `z.uuid()`, so the placeholder stays
 * shape-valid while it sits in form state, and it survives removing an earlier
 * row.
 */
export interface StagedMilestone extends MilestoneFormValue {
  key: string;
}

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
  entries: StagedMilestone[];
  onChange: (entries: StagedMilestone[]) => void;
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

      {entries.map((entry) => {
        const icon = kindDefs[entry.kind].icon;
        const date = formatMilestoneDate(entry);
        return (
          <View key={entry.key} style={styles.row}>
            <Text style={styles.rowText}>
              {icon ? `${icon} ` : ""}
              {milestoneLabel(entry)}
            </Text>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>{date === "" ? "—" : date}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  onChange(entries.filter((e) => e.key !== entry.key))
                }
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
            onChange([...entries, { ...value, key: crypto.randomUUID() }]);
            setAdding(false);
          }}
        />
      ) : entries.length === 0 ? (
        <Text style={styles.muted}>No milestones yet.</Text>
      ) : null}
    </View>
  );
}
