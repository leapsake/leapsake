import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { RelationshipCandidate } from "@leapsake/core";
import type { EntityType } from "@leapsake/schema";
import {
  type RelationshipDraft,
  RelationshipFields,
  emptyRelationshipDraft,
  otherLabelOf,
  relationshipDraftValid,
} from "./RelationshipFields";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * A relationship being authored on the create form: the draft the write needs
 * bar the subject, whose other end was resolved at pick time so a row can name
 * it without re-consulting the candidate list.
 *
 * Every row here is a create. A saved record's neighbours — a stored edge to
 * re-role, an inferred one to materialise or dismiss — are each their own screen
 * off that record's page, and the three-way distinction that used to live on
 * this type lives in the route that writes.
 */
export interface StagedRelationship {
  key: string;
  draft: RelationshipDraft;
}

/**
 * A row with nobody picked yet — the "Add relationship" tap nobody followed
 * through on. Neither written nor allowed to hold up the Save, for the reason
 * {@link contactRowPending} gives.
 */
export function relationshipRowPending(row: StagedRelationship): boolean {
  return row.draft.other === null;
}

/** Whether a row would either write cleanly or be skipped — the Save gate. */
export function relationshipRowValid(row: StagedRelationship): boolean {
  return relationshipRowPending(row) || relationshipDraftValid(row.draft);
}

/**
 * Relationships on the **create** screen — the staged counterpart to
 * {@link RelationshipsSection}, held in an array until the form is saved. See
 * {@link StagedMilestonesSection} for why staging works this way, and desktop's
 * `RelationshipFields` for the same section on that client.
 *
 * A row is fully resolved the moment it's picked, which is what lets it be staged
 * at all: the other end is either an existing person or pet, or a name typed past
 * the end of the list, and neither needs the subject to exist. On the create
 * screen only the *subject* is unsaved. So "add a pet, its owner, and the owner's
 * wife" is one pass; relating two brand-new **published** people still takes two,
 * since only one new entity per pass can be the one the form is creating.
 *
 * Candidates come from `core.views.candidates()` rather than
 * `views.relationshipNew`, which needs a subject id to exclude. On the create
 * screen nothing needs excluding — the subject doesn't exist yet, so it cannot be
 * in the list. Neither is an already-staged entity excluded: the same pair may
 * relate in more than one way, which the schema deliberately permits.
 *
 * **Every row is open**, for the reason {@link StagedContactsSection} gives, and
 * every row keeps its picker: each one is a create, so nothing here is
 * constrained by an endpoint a write cannot move. That constraint belongs to the
 * screens off a saved record's page — see {@link RelationshipForm}.
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
      </View>

      {entries.map((entry) => {
        const label = otherLabelOf(entry.draft);
        return (
          <View key={entry.key} style={[styles.row, styles.inlineForm]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.fieldLabel}>
                {label === "" ? "New relationship" : label}
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
            <RelationshipFields
              subjectType={subjectType}
              candidates={candidates ?? []}
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
        <Text style={styles.muted}>No relationships yet.</Text>
      ) : null}

      {/* The picker a new row opens on is the whole of it, so the link waits for
          the candidates rather than appending a row that can't be filled in. */}
      {candidates === null ? (
        <Text style={styles.muted}>Loading people and pets…</Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onChange([
              ...entries,
              { key: crypto.randomUUID(), draft: emptyRelationshipDraft() },
            ])
          }
        >
          <Text style={styles.link}>Add relationship</Text>
        </Pressable>
      )}
    </View>
  );
}
