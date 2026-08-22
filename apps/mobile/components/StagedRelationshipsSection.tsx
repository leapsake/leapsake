import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import type { RelationshipCandidate } from "@leapsake/core";
import {
  type EntityType,
  type RelationshipNeighbor,
  type RelationshipRole,
  baseRole,
} from "@leapsake/schema";
import {
  type RelationshipDraft,
  RelationshipFields,
  emptyRelationshipDraft,
  otherLabelOf,
  relationshipDraftFrom,
  relationshipDraftValid,
} from "./RelationshipFields";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * A relationship being authored on a form: the draft the write needs bar the
 * subject, whose other end was resolved at pick time so a row can name it without
 * re-consulting the candidate list.
 *
 * On the edit screen a row may also stand for something already true of the
 * subject, and which of the three it is decides what saving does:
 *
 * - **added here** (neither `savedId` nor `derived`) — a create.
 * - **`savedId`** — a stored edge; an edit changes its role, a removal deletes it.
 * - **`derived`** — a neighbour the inference engine computed, which has no row
 *   to change. Editing it *materialises* a stored edge (the same thing the old
 *   detail-page "Edit" did by sending you to the add form), and removing it
 *   records a dismissal instead of a deletion.
 */
export interface StagedRelationship {
  key: string;
  draft: RelationshipDraft;
  /** The stored edge this row was read back from. */
  savedId?: string;
  /** An inferred neighbour, carrying the base role a dismissal is keyed on. */
  derived?: { baseRole: RelationshipRole };
  /**
   * The other end exists only because of this edge, so removing it takes them
   * with it — the one removal on this form that is more than an unlinking.
   */
  otherUnpublished?: boolean;
  /** Whether it has been typed into here — see {@link StagedMilestone}. */
  edited?: boolean;
}

/** A subject's neighbour as a staged row. */
export function stagedRelationshipOf(
  neighbor: RelationshipNeighbor,
): StagedRelationship {
  const draft = relationshipDraftFrom(neighbor);
  return neighbor.origin === "explicit"
    ? {
        draft,
        key: neighbor.relationshipId,
        savedId: neighbor.relationshipId,
        otherUnpublished: neighbor.otherStanding === "unpublished",
      }
    : {
        draft,
        // A derived neighbour has no stored id to key on, so the pair and the
        // base role name it — the same triple `kinship.dismiss` is addressed by.
        key: `derived:${neighbor.otherType}:${neighbor.otherId}:${baseRole(neighbor.otherRole)}`,
        derived: { baseRole: baseRole(neighbor.otherRole) },
      };
}

/** Whether the row's other end is still the row's to pick. */
export function canChangeOther(row: StagedRelationship): boolean {
  return row.savedId === undefined && row.derived === undefined;
}

/**
 * A row added here with nobody picked yet — the "Add relationship" tap nobody
 * followed through on. Neither written nor allowed to hold up the Save, for the
 * reason {@link contactRowPending} gives.
 */
export function relationshipRowPending(row: StagedRelationship): boolean {
  return canChangeOther(row) && row.draft.other === null;
}

/** Whether a row would either write cleanly or be skipped — the Save gate. */
export function relationshipRowValid(row: StagedRelationship): boolean {
  return relationshipRowPending(row) || relationshipDraftValid(row.draft);
}

/**
 * Relationships on the **create** and **edit** screens — the staged counterpart
 * to {@link RelationshipsSection}, held in an array until the form is saved. See
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
 * **Every row is open**, for the reason {@link StagedContactsSection} gives.
 * A stored or derived row keeps its other end **locked** even so, because that is
 * what the write behind it allows — only the role is live there. A row added on
 * this form has no such constraint and keeps its picker.
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

  /** Take a row out of the list — saying so first where that removes a person. */
  function remove(entry: StagedRelationship) {
    const drop = () => onChange(entries.filter((e) => e.key !== entry.key));
    if (entry.otherUnpublished !== true) {
      drop();
      return;
    }
    // The one removal here with a consequence beyond this list, and the user is
    // told about it while it can still be reconsidered — even though, like every
    // other change on this form, nothing happens until Save.
    Alert.alert(
      "Remove relationship",
      `${otherLabelOf(entry.draft)} is only recorded here, so saving this will remove them too.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: drop },
      ],
    );
  }

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
                onPress={() => remove(entry)}
              >
                <Text style={[styles.link, styles.danger]}>Remove</Text>
              </Pressable>
            </View>
            <RelationshipFields
              subjectType={subjectType}
              candidates={candidates ?? []}
              canChangeOther={canChangeOther(entry)}
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
