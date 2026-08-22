import { useMemo } from "react";
import { Text, TextInput, View } from "react-native";
import type { RelationshipCandidate } from "@leapsake/core";
import {
  type EntityType,
  type RelationshipNeighbor,
  type RelationshipRole,
  holderTypesFor,
  rolesForSubject,
} from "@leapsake/schema";
import { PickerField } from "./PickerField";
import { Typeahead } from "./Typeahead";
import { styles } from "../lib/styles";

/** A role option as the shared {@link PickerField} carries it. */
type RoleOption = { role: RelationshipRole; label: string };

/** Both, for a role that rules out neither — most of them. */
const ANY_TYPE: readonly EntityType[] = ["person", "pet"];

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

/**
 * A subject's neighbour as a draft — the seed for both a row on the create form
 * and the screen that revises one, and for a *derived* neighbour also the seed
 * for materialising it, since what gets written is exactly what was inferred
 * until the user changes the role.
 */
export function relationshipDraftFrom(
  neighbor: RelationshipNeighbor,
): RelationshipDraft {
  return {
    other: {
      kind: "existing",
      type: neighbor.otherType,
      id: neighbor.otherId,
      label: neighbor.otherLabel,
    },
    role: neighbor.otherRole,
    note: neighbor.otherRoleNote ?? "",
  };
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
 * entered here.
 *
 * Controlled throughout, with no submit of its own, like {@link PersonFields} and
 * {@link ContactMethodFields}: {@link StagedRelationshipsSection} keeps every row
 * open and live, and the create form's one Save writes them.
 *
 * ### The Role comes first, and narrows the Name
 *
 * Role used to depend on Name: it appeared only once somebody was picked, its
 * options were `rolesForPair`, and re-picking the name cleared whatever role had
 * been chosen. That had the dependency backwards for the sake of two roles out of
 * forty-one. Every kinship role is `holderTypes: "any"` — the schema is content
 * for a dog to be your sister — and the only roles that say anything about the
 * other end are `owner` (a person) and `pet` (a pet), which are inverses, so
 * exactly one of them is on offer for a given subject.
 *
 * So Role offers {@link rolesForSubject}, the whole list, from the moment the
 * screen opens, and a role that *does* constrain the other end filters the Name
 * picker to the types that can hold it ({@link holderTypesFor}) instead of being
 * filtered by it. Either field can be answered first. The one case that still
 * conflicts — a name already picked whose type the newly chosen role forbids —
 * clears the name, which is the same rule in the other direction and fires for
 * two roles rather than for every re-pick.
 *
 * ### The two shapes
 *
 * Role shares its line with the Name it qualifies, the way a contact method's
 * Label shares one with the address it names — so it is a {@link PickerField},
 * collapsed to a row with its forty options behind a sheet, because a third of a
 * phone's width is nowhere to list them. Name keeps the full width and its
 * matches inline ({@link Typeahead}), since it needs room for "Add … as a new
 * person" and for names longer than a role.
 *
 * The Name picker offers the people and pets already in the list, and beneath
 * them the option to add whatever has been typed as somebody new. That second
 * kind is how an unpublished entity comes about — a coworker's wife, existing as
 * a fact about him and nothing else — and it is why the value is a union: the two
 * need different core calls.
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
  // Every role this subject could stand opposite, whoever the other end is.
  const roleOptions = useMemo(
    () => rolesForSubject(subjectType),
    [subjectType],
  );

  // Which entity types the chosen role admits — both, for all but `owner` and
  // `pet`. With no role chosen nothing is ruled out.
  const allowedTypes: readonly EntityType[] = useMemo(
    () => (draft.role === null ? ANY_TYPE : holderTypesFor(draft.role)),
    [draft.role],
  );

  // The chosen role as an option; falls back to the raw role when it isn't in
  // the list (defensive — a stored edge whose role this subject type no longer
  // offers), so it still displays rather than reading as unset.
  const selectedRole: RoleOption | null =
    draft.role === null
      ? null
      : (roleOptions.find((r) => r.role === draft.role) ?? {
          role: draft.role,
          label: draft.role,
        });

  /** Answer the Role picker, dropping a name the new role cannot be held by. */
  function pickRole(role: RelationshipRole) {
    const admits = holderTypesFor(role);
    const keepsOther =
      draft.other === null || admits.includes(draft.other.type);
    onChange({ ...draft, role, other: keepsOther ? draft.other : null });
  }

  const roleField = (
    <PickerField<RoleOption>
      testID="relationship-other-role"
      label="Role"
      // Not the label, which is already right above it and would read twice.
      placeholder="Pick one"
      value={selectedRole}
      options={roleOptions}
      onChange={(option) => pickRole(option.role)}
      getKey={(r) => r.role}
      getLabel={(r) => r.label}
    />
  );

  const nameField =
    !canChangeOther && draft.other !== null ? (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Name</Text>
        <Text style={styles.fieldValue}>{draft.other.label}</Text>
      </View>
    ) : (
      <Typeahead<OtherOption>
        testID="relationship-other-name"
        label="Name"
        value={draft.other}
        options={(candidates ?? [])
          .filter((c) => allowedTypes.includes(c.type))
          .map((c) => ({
            kind: "existing" as const,
            type: c.type,
            id: c.id,
            label: c.label,
          }))}
        // Somebody not in the list yet: typing their name and picking one of
        // these rows creates them alongside the relationship, as a person who
        // exists only as this fact about the subject. Both entity types are
        // offered unless the role has ruled one out — a coworker's dog is as
        // legitimate a thing to record as their wife.
        createOptions={(typed) =>
          allowedTypes.map((type) => ({
            kind: "new" as const,
            type,
            name: typed,
            label: typed,
          }))
        }
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
        onChange={(other) => onChange({ ...draft, other })}
        getKey={otherKey}
        getLabel={(o) => o.label}
      />
    );

  return (
    <>
      {/* Top-aligned rather than bottom-, unlike a contact method's pair: the
          Name field grows downwards as its matches list, and bottom-aligning
          would slide Role down the page alongside them. */}
      <View style={[styles.fieldPair, styles.fieldPairTop]}>
        <View style={styles.fieldPairNarrow}>{roleField}</View>
        <View style={styles.fieldPairWide}>{nameField}</View>
      </View>

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
