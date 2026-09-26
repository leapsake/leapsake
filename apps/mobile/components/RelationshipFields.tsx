import { ScrollView, Text, TextInput, View } from "react-native";
import type { RelationshipCandidate } from "@leapsake/core";
import type {
  EntityType,
  RelationshipDraft,
  RelationshipRole,
} from "@leapsake/schema";
import {
  type CommittedParty,
  type PartyChoice,
  PartyField,
} from "./PartyField";
import { PickerField } from "./PickerField";
import { styles } from "../lib/styles";

const TEXT = {
  role: "Role",
  // Not the label, which is already right above it and would read twice.
  rolePick: "Pick one",
  name: "Name",
  note: "Note (e.g. landlord)",
} as const;

/** A role option as the shared {@link PickerField} carries it. */
type RoleOption = { role: RelationshipRole; label: string };

/** What to call the other end — for a row's heading, and for naming a failure. */
export function otherLabelOf(draft: RelationshipDraft): string {
  const other = draft.other;
  if (other === null) return "";
  return other.kind === "typed" ? other.text : other.label;
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
 * So Role offers `roleOptions`, the whole list from `useRelationshipForm` (the
 * list web reads too), from the moment the screen opens, and a role that *does*
 * constrain the other end narrows the Name picker to `otherTypes` instead of
 * being filtered by it. Either field can be answered first. The one case that still
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
  setRole,
  roleOptions,
  otherTypes,
  candidates,
  canChangeOther = true,
  commitOther,
  scroll = false,
}: {
  draft: RelationshipDraft;
  onChange: (draft: RelationshipDraft) => void;
  /** Picks a role, dropping a name the new role cannot be held by. */
  setRole: (role: RelationshipRole) => void;
  roleOptions: readonly RoleOption[];
  /** The entity types the Name picker offers, narrowed by the role. */
  otherTypes: readonly EntityType[];
  candidates?: readonly RelationshipCandidate[];
  /** Whether the other end may still be re-picked — see above. */
  canChangeOther?: boolean;
  /** Writes a new other end with this relationship, so Edit can open them;
   *  absent where there is no saved subject to relate them to. */
  commitOther?: (
    party: Extract<PartyChoice, { kind: "new" }>,
    role: RelationshipRole,
    note: string | null,
  ) => Promise<CommittedParty>;
  /** Fill a screen of its own, in a scroll view. */
  scroll?: boolean;
}) {
  // The chosen role as an option; falls back to the raw role when it isn't in
  // the list, so a stored edge's role still displays rather than reading as unset.
  const selectedRole: RoleOption | null =
    draft.role === null
      ? null
      : (roleOptions.find((r) => r.role === draft.role) ?? {
          role: draft.role,
          label: draft.role,
        });

  const roleField = (
    <PickerField<RoleOption>
      testID="relationship-other-role"
      label={TEXT.role}
      placeholder={TEXT.rolePick}
      value={selectedRole}
      options={roleOptions}
      onChange={(option) => setRole(option.role)}
      getKey={(r) => r.role}
      getLabel={(r) => r.label}
    />
  );

  const role = draft.role;
  const noteReady = role !== "other" || draft.note.trim().length > 0;
  const other = draft.other?.kind === "typed" ? null : draft.other;

  const nameField =
    !canChangeOther && other !== null ? (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{TEXT.name}</Text>
        <Text style={styles.fieldValue}>{other.label}</Text>
      </View>
    ) : (
      <PartyField
        testID="relationship-other-name"
        label={TEXT.name}
        value={other}
        onChange={(next) => onChange({ ...draft, other: next })}
        candidates={candidates ?? []}
        types={otherTypes}
        // Edit on somebody new writes the relationship, so it waits for a role.
        commit={
          commitOther === undefined || role === null || !noteReady
            ? undefined
            : (party) =>
                commitOther(
                  party,
                  role,
                  role === "other" ? draft.note.trim() : null,
                )
        }
      />
    );

  const fields = (
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
          <Text style={styles.fieldLabel}>{TEXT.note}</Text>
          <TextInput
            style={styles.input}
            value={draft.note}
            onChangeText={(note) => onChange({ ...draft, note })}
          />
        </View>
      ) : null}
    </>
  );

  if (!scroll) return fields;
  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      {fields}
    </ScrollView>
  );
}
