import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import type { RelationshipCandidate } from "@leapsake/core";
import {
  type EntityType,
  type RelationshipNeighbor,
  type RelationshipRole,
  baseRole,
  labelForRole,
} from "@leapsake/schema";
import {
  RelationshipForm,
  type RelationshipFormValue,
} from "./RelationshipForm";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * A relationship being authored on a form: everything the write needs bar the
 * subject, plus the other end's label, resolved at pick time so a row can name it
 * without re-consulting the candidate list.
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
export type StagedRelationship = RelationshipFormValue & {
  key: string;
  otherLabel: string;
  /** The stored edge this row was read back from. */
  savedId?: string;
  /** An inferred neighbour, carrying the base role a dismissal is keyed on. */
  derived?: { baseRole: RelationshipRole };
  /**
   * The other end exists only because of this edge, so removing it takes them
   * with it — the one removal on this form that is more than an unlinking.
   */
  otherUnpublished?: boolean;
  /** Whether its editor has been submitted here — see {@link StagedMilestone}. */
  edited?: boolean;
};

/** A subject's neighbour as a staged row. */
export function stagedRelationshipOf(
  neighbor: RelationshipNeighbor,
): StagedRelationship {
  const common = {
    otherType: neighbor.otherType,
    otherRole: neighbor.otherRole,
    otherRoleNote: neighbor.otherRoleNote,
    otherLabel: neighbor.otherLabel,
    other: "existing" as const,
    otherId: neighbor.otherId,
  };
  return neighbor.origin === "explicit"
    ? {
        ...common,
        key: neighbor.relationshipId,
        savedId: neighbor.relationshipId,
        otherUnpublished: neighbor.otherStanding === "unpublished",
      }
    : {
        ...common,
        // A derived neighbour has no stored id to key on, so the pair and the
        // base role name it — the same triple `kinship.dismiss` is addressed by.
        key: `derived:${neighbor.otherType}:${neighbor.otherId}:${baseRole(neighbor.otherRole)}`,
        derived: { baseRole: baseRole(neighbor.otherRole) },
      };
}

/** The role shown for a staged row: the free-text note for "other", else the label. */
function roleText(entry: StagedRelationship): string {
  return entry.otherRole === "other" && entry.otherRoleNote
    ? entry.otherRoleNote
    : labelForRole(entry.otherRole);
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
 * A stored or derived row opens with its other end **locked**, because that is
 * what the write behind it allows: `editFromSubject` changes a role, never an
 * endpoint, and a derived neighbour is materialised against the pair inference
 * already found. A row added on this form has no such constraint and reopens with
 * its picker intact.
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
  // Which row's editor is open, by key — or "new" for the add form.
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);

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
      `${entry.otherLabel} is only recorded here, so saving this will remove them too.`,
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
        {open === null && (
          <Pressable accessibilityRole="button" onPress={() => setOpen("new")}>
            <Text style={styles.link}>Add relationship</Text>
          </Pressable>
        )}
      </View>

      {entries.map((entry) => {
        if (open === entry.key) {
          const locked =
            entry.savedId !== undefined || entry.derived !== undefined;
          return (
            <RelationshipForm
              key={entry.key}
              inline
              subjectType={subjectType}
              candidates={candidates ?? []}
              lockedOther={
                locked && entry.other === "existing"
                  ? {
                      type: entry.otherType,
                      id: entry.otherId,
                      label: entry.otherLabel,
                    }
                  : undefined
              }
              initialValue={locked ? undefined : entry}
              initialRole={locked ? entry.otherRole : undefined}
              initialNote={locked ? entry.otherRoleNote : undefined}
              submitLabel="Save"
              onCancel={close}
              onSubmit={async (value) => {
                const otherLabel = labelFor(value, candidates ?? [], entry);
                onChange(
                  entries.map((e) =>
                    e.key === entry.key
                      ? { ...e, ...value, otherLabel, edited: true }
                      : e,
                  ),
                );
                close();
              }}
            />
          );
        }
        return (
          <View key={entry.key} style={styles.row}>
            <Text style={styles.rowText}>{entry.otherLabel}</Text>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>{roleText(entry)}</Text>
              <View style={styles.rowActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${entry.otherLabel}`}
                  onPress={() => setOpen(entry.key)}
                >
                  <Text style={styles.link}>Edit</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${entry.otherLabel}`}
                  onPress={() => remove(entry)}
                >
                  <Text style={[styles.link, styles.danger]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}

      {open === "new" ? (
        candidates === null ? (
          <Text style={styles.muted}>Loading people and pets…</Text>
        ) : (
          <RelationshipForm
            inline
            subjectType={subjectType}
            candidates={candidates}
            submitLabel="Add"
            onCancel={close}
            onSubmit={async (value) => {
              onChange([
                ...entries,
                {
                  ...value,
                  key: crypto.randomUUID(),
                  otherLabel: labelFor(value, candidates),
                },
              ]);
              close();
            }}
          />
        )
      ) : entries.length === 0 ? (
        <Text style={styles.muted}>No relationships yet.</Text>
      ) : null}
    </View>
  );
}

/**
 * What to call the other end of a submitted row, so it can be read back without
 * re-consulting the candidate list. For somebody being named for the first time,
 * that name *is* the label; for a locked row the picker never moved, so the label
 * it already had still stands.
 */
function labelFor(
  value: RelationshipFormValue,
  candidates: readonly RelationshipCandidate[],
  previous?: StagedRelationship,
): string {
  if (value.other === "new") return value.otherName;
  return (
    candidates.find((c) => c.type === value.otherType && c.id === value.otherId)
      ?.label ??
    previous?.otherLabel ??
    ""
  );
}
