import { useEffect, useState } from "react";
import { Text } from "react-native";
import type { RelationshipCandidate } from "@leapsake/core";
import {
  type EntityType,
  type RelationshipDraft,
  otherTypesFor,
  relationshipDraftOf,
  relationshipDraftWithRole,
  relationshipInputOf,
  rolesForSubject,
} from "@leapsake/schema";
import { RelationshipFields, otherLabelOf } from "./RelationshipFields";
import { DraftRow } from "./DraftRow";
import { RecordSection } from "./RecordSection";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

const NEW_RELATIONSHIP = "New relationship";

/** A relationship being created on the form, its other end resolved at pick. */
export interface StagedRelationship {
  key: string;
  draft: RelationshipDraft;
}

/** A row with nobody picked yet: neither written nor holding up the Save. */
export function relationshipRowPending(row: StagedRelationship): boolean {
  return row.draft.other === null;
}

/** Whether a row would either write cleanly or be skipped — the Save gate. */
export function relationshipRowValid(row: StagedRelationship): boolean {
  return relationshipRowPending(row) || relationshipInputOf(row.draft).ok;
}

/**
 * Relationships staged on the create form, every row open. Candidates exclude
 * nobody: the subject is unsaved, and one pair may relate more than one way.
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
  const roleOptions = rolesForSubject(subjectType);

  return (
    // Add waits for the candidates, or a new row could not be filled in.
    <RecordSection
      title="Relationships"
      link={
        candidates === null
          ? undefined
          : {
              what: "relationship",
              action: "add",
              onPress: () =>
                onChange([
                  ...entries,
                  { key: crypto.randomUUID(), draft: relationshipDraftOf() },
                ]),
            }
      }
      isEmpty={entries.length === 0 && candidates !== null}
      emptyText="No relationships yet."
    >
      {entries.map((entry) => {
        const label = otherLabelOf(entry.draft) || NEW_RELATIONSHIP;
        const setDraft = (draft: RelationshipDraft) =>
          onChange(
            entries.map((e) => (e.key === entry.key ? { ...e, draft } : e)),
          );
        return (
          <DraftRow
            key={entry.key}
            label={label}
            subject={label}
            onRemove={() =>
              onChange(entries.filter((e) => e.key !== entry.key))
            }
          >
            <RelationshipFields
              candidates={candidates ?? []}
              draft={entry.draft}
              onChange={setDraft}
              setRole={(role) =>
                setDraft(relationshipDraftWithRole(entry.draft, role))
              }
              roleOptions={roleOptions}
              otherTypes={otherTypesFor(entry.draft.role)}
            />
          </DraftRow>
        );
      })}

      {candidates === null && (
        <Text style={styles.muted}>Loading people and pets…</Text>
      )}
    </RecordSection>
  );
}
