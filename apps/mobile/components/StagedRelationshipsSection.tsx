import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { RelationshipCandidate } from "@leapsake/core";
import { type EntityType, labelForRole } from "@leapsake/schema";
import {
  RelationshipForm,
  type RelationshipFormValue,
} from "./RelationshipForm";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * A staged relationship: everything the write needs bar the subject, plus the
 * other end's label, resolved at pick time so a row can name it without
 * re-consulting the candidate list.
 */
export type StagedRelationship = RelationshipFormValue & {
  otherLabel: string;
};

/** The role shown for a staged row: the free-text note for "other", else the label. */
function roleText(entry: StagedRelationship): string {
  return entry.otherRole === "other" && entry.otherRoleNote
    ? entry.otherRoleNote
    : labelForRole(entry.otherRole);
}

/**
 * Relationships on the **create** screen — the staged counterpart to
 * {@link RelationshipsSection}, held in an array until the subject has an id and
 * then written by `app/add.tsx`. See {@link StagedMilestonesSection} for why
 * staging works this way, and desktop's `RelationshipFields` for the same section
 * on that client.
 *
 * A row is fully resolved the moment it's picked, which is what lets it be staged
 * at all: the other end is either an existing person or pet, or a name typed past
 * the end of the list, and neither needs the subject to exist. Only the *subject*
 * is unsaved. So "add a pet, its owner, and the owner's wife" is one pass;
 * relating two brand-new **published** people still takes two, since only one new
 * entity per pass can be the one this form is creating.
 *
 * Candidates come from `core.views.candidates()` rather than
 * `views.relationshipNew`, which needs a subject id to exclude. Nothing needs
 * excluding here — the subject doesn't exist yet, so it cannot be in the list.
 * Neither is an already-staged entity excluded: the same pair may relate in more
 * than one way, which the schema deliberately permits.
 *
 * Collapsed until asked for, like the other staged sections.
 */
export function StagedRelationshipsSection({
  subjectType,
  entries,
  onChange,
}: {
  subjectType: EntityType;
  entries: StagedRelationship[];
  onChange: (entries: StagedRelationship[]) => void;
}) {
  const core = useCore();
  const [candidates, setCandidates] = useState<RelationshipCandidate[] | null>(
    null,
  );
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    void core.views.candidates().then((items) => {
      if (active) setCandidates(items);
    });
    return () => {
      active = false;
    };
  }, [core]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Relationships</Text>
        {!adding && (
          <Pressable accessibilityRole="button" onPress={() => setAdding(true)}>
            <Text style={styles.link}>Add relationship</Text>
          </Pressable>
        )}
      </View>

      {entries.map((entry, index) => (
        <View key={index} style={styles.row}>
          <Text style={styles.rowText}>{entry.otherLabel}</Text>
          <View style={styles.rowMeta}>
            <Text style={styles.muted}>{roleText(entry)}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => onChange(entries.filter((_, i) => i !== index))}
            >
              <Text style={[styles.link, styles.danger]}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {adding ? (
        candidates === null ? (
          <Text style={styles.muted}>Loading people and pets…</Text>
        ) : (
          <RelationshipForm
            inline
            subjectType={subjectType}
            candidates={candidates}
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onSubmit={async (value) => {
              // A staged row names its other end so it can be read back without
              // re-consulting the candidate list. For somebody being named for
              // the first time, that name *is* the label.
              const otherLabel =
                value.other === "new"
                  ? value.otherName
                  : (candidates.find(
                      (c) =>
                        c.type === value.otherType && c.id === value.otherId,
                    )?.label ?? "");
              onChange([...entries, { ...value, otherLabel }]);
              setAdding(false);
            }}
          />
        )
      ) : entries.length === 0 ? (
        <Text style={styles.muted}>No relationships yet.</Text>
      ) : null}
    </View>
  );
}
