import { useMemo } from "react";
import { Text, TextInput, View } from "react-native";
import type { RelationshipCandidate } from "@leapsake/core";
import {
  type EntityType,
  type RelationshipRole,
  rolesForPair,
} from "@leapsake/schema";
import { Typeahead } from "./Typeahead";
import { styles } from "../lib/styles";

/** A role option as the shared {@link Typeahead} carries it. */
type RoleOption = { role: RelationshipRole; label: string };

/**
 * The structured value the write uses; the caller supplies subject + call.
 *
 * The other end is either somebody already in the list or somebody who isn't,
 * named on the spot — the two need different core calls (`createFromSubject`
 * versus `createWithNewOther`), so they are different shapes here rather than an
 * id that is sometimes empty.
 */
export type RelationshipFormValue = {
  otherType: EntityType;
  otherRole: RelationshipRole;
  otherRoleNote: string | null;
} & (
  | { other: "existing"; otherId: string }
  | { other: "new"; otherName: string }
);

/**
 * What the Name picker holds: a candidate, or a name typed past the end of the
 * list.
 *
 * `label` is the person's or pet's name in both cases — never the "Add … as a
 * new person" phrasing. That phrasing belongs to the row that *offers* the
 * option, not to the option, and putting it in `label` made the field read "Add
 * "Jen" as a new person" after it had already been added.
 */
export type OtherOption =
  | { kind: "existing"; type: EntityType; id: string; label: string }
  | { kind: "new"; type: EntityType; name: string; label: string };

/** A stable key per option; the `new` rows key on type so the two offered for one
 *  typed name don't collide. */
export function otherKey(option: OtherOption): string {
  return option.kind === "existing"
    ? `existing:${option.type}:${option.id}`
    : `new:${option.type}`;
}

/**
 * A relationship as the UI holds it: who the other end is, what they are to the
 * subject, and the free-text note the `other` role needs. The subject's own role
 * is the gender-neutral inverse and is derived by core, never held here.
 */
export interface RelationshipDraft {
  other: OtherOption | null;
  role: RelationshipRole | null;
  note: string;
}

export function emptyRelationshipDraft(): RelationshipDraft {
  return { other: null, role: null, note: "" };
}

/** What to call the other end — for a row's heading, and for naming a failure. */
export function otherLabelOf(draft: RelationshipDraft): string {
  return draft.other?.label ?? "";
}

/** Whether the draft names both ends of a relationship the schema would accept. */
export function relationshipDraftValid(draft: RelationshipDraft): boolean {
  return (
    draft.other !== null &&
    draft.role !== null &&
    (draft.role !== "other" || draft.note.trim().length > 0)
  );
}

/** The draft as the write wants it, or `null` while it is still incomplete. */
export function relationshipDraftToValue(
  draft: RelationshipDraft,
): RelationshipFormValue | null {
  if (!relationshipDraftValid(draft)) return null;
  const { other, role } = draft;
  if (other === null || role === null) return null;
  const common = {
    otherType: other.type,
    otherRole: role,
    otherRoleNote: role === "other" ? draft.note.trim() : null,
  };
  return other.kind === "existing"
    ? { ...common, other: "existing", otherId: other.id }
    : { ...common, other: "new", otherName: other.name };
}

/**
 * One relationship's fields, ported from the desktop `RelationshipForm`. The user
 * picks the *other* entity and that entity's role relative to the subject; the
 * subject's own role is the gender-neutral inverse and is derived by core, never
 * entered here. Both pickers are the shared {@link Typeahead} (the mobile
 * `<datalist>`); the Role one is keyed by the selected entity so its query resets
 * whenever the Name changes.
 *
 * Controlled throughout, with no submit of its own, like {@link PersonFields} and
 * {@link ContactMethodFields}: {@link StagedRelationshipsSection} keeps every row
 * open and live, and the entity form's one Save writes them.
 *
 * The Name picker offers the people and pets already in the list, and beneath
 * them the option to add whatever has been typed as somebody new. That second
 * kind is how an unpublished entity comes about — a coworker's wife, existing as
 * a fact about him and nothing else — and it is why the value is a union: the two
 * need different core calls. Both entity types are offered for a new name,
 * because the role list depends on which it is.
 *
 * `canChangeOther` is false where the write behind the row doesn't allow it:
 * `editFromSubject` changes a role, never an endpoint, and a derived neighbour is
 * materialised against the pair inference already found. Then the name is shown
 * as text and only the role is live.
 */
export function RelationshipFields({
  draft,
  onChange,
  subjectType,
  candidates,
  canChangeOther = true,
}: {
  draft: RelationshipDraft;
  onChange: (draft: RelationshipDraft) => void;
  subjectType: EntityType;
  candidates?: readonly RelationshipCandidate[];
  /** Whether the other end may still be re-picked — see above. */
  canChangeOther?: boolean;
}) {
  const otherType = draft.other?.type ?? null;

  // Roles the other end may hold for this pair; the subject's role is the implied
  // inverse, so the picker only offers roles whose inverse the subject can hold.
  const roleOptions = useMemo(
    () => (otherType ? rolesForPair(otherType, subjectType) : []),
    [otherType, subjectType],
  );

  // The chosen role as a Typeahead option; falls back to the raw role when it
  // isn't in the current pair's list (defensive — an edited edge whose role the
  // pair no longer offers), so it still displays rather than reverting to search.
  const selectedRole: RoleOption | null =
    draft.role === null
      ? null
      : (roleOptions.find((r) => r.role === draft.role) ?? {
          role: draft.role,
          label: draft.role,
        });

  return (
    <>
      {!canChangeOther && draft.other !== null ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name</Text>
          <Text style={styles.fieldValue}>{draft.other.label}</Text>
        </View>
      ) : (
        <Typeahead<OtherOption>
          testID="relationship-other-name"
          label="Name"
          value={draft.other}
          options={(candidates ?? []).map((c) => ({
            kind: "existing" as const,
            type: c.type,
            id: c.id,
            label: c.label,
          }))}
          // Somebody not in the list yet: typing their name and picking one of
          // these rows creates them alongside the relationship, as a person who
          // exists only as this fact about the subject. Both entity types are
          // offered because the role list below depends on which it is, so the
          // question can't be deferred — and because a coworker's dog is as
          // legitimate a thing to record as their wife.
          createOptions={(typed) => [
            {
              kind: "new" as const,
              type: "person" as const,
              name: typed,
              label: typed,
            },
            {
              kind: "new" as const,
              type: "pet" as const,
              name: typed,
              label: typed,
            },
          ]}
          // Only the offered row says "Add …". The chosen-value row renders
          // `label`, which is the plain name, so the field reads as the person it
          // now holds rather than as the invitation that put them there.
          renderOption={(option) => (
            <Text style={styles.rowText}>
              {option.kind === "existing"
                ? option.label
                : `Add "${option.name}" as a new ${option.type}`}
            </Text>
          )}
          // Re-picking the name invalidates the role (it's pair-dependent).
          onChange={(other) => onChange({ ...draft, other, role: null })}
          getKey={otherKey}
          getLabel={(o) => o.label}
        />
      )}

      {draft.other !== null ? (
        <Typeahead<RoleOption>
          // Remount on a name change so the role's live query resets.
          key={otherKey(draft.other)}
          testID="relationship-other-role"
          label="Role"
          value={selectedRole}
          options={roleOptions}
          onChange={(option) =>
            onChange({ ...draft, role: option?.role ?? null })
          }
          getKey={(r) => r.role}
          getLabel={(r) => r.label}
        />
      ) : null}

      {draft.role === "other" ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Note (e.g. landlord)</Text>
          <TextInput
            style={styles.input}
            value={draft.note}
            onChangeText={(note) => onChange({ ...draft, note })}
          />
        </View>
      ) : null}
    </>
  );
}
