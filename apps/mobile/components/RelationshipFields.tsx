import { Text, TextInput, View } from "react-native";
import type { RelationshipCandidate } from "@leapsake/core";
import type {
  EntityType,
  RelationshipDraft,
  RelationshipRole,
} from "@leapsake/schema";
import {
  type CommittedParty,
  type NewParty,
  relationshipCommit,
} from "@leapsake/ui/headless";
import { PartyField } from "./PartyField";
import { PickerField } from "./PickerField";
import { styles } from "../lib/styles";
import { FormScrollView } from "./FormScrollView";

const TEXT = {
  role: "Role",
  // Not the label, which is already right above it and would read twice.
  rolePick: "Pick one",
  name: "Name",
  note: "Note (e.g. landlord)",
} as const;

/** A role option as the shared {@link PickerField} carries it. */
type RoleOption = { role: RelationshipRole; label: string };

/** What to call the other end, for a row's heading and a failure. */
export function otherLabelOf(draft: RelationshipDraft): string {
  const other = draft.other;
  if (other === null) return "";
  return other.kind === "typed" ? other.text : other.label;
}

/**
 * The other end and its role; core derives the subject's. Role comes first
 * and narrows Name, since only `owner` and `pet` constrain the other end.
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
  /** False where the write changes a role, never an endpoint. */
  canChangeOther?: boolean;
  /** Writes a new other end with this relationship; absent with no saved
   *  subject. */
  commitOther?: (
    party: NewParty,
    role: RelationshipRole,
    note: string | null,
  ) => Promise<CommittedParty>;
  /** Fill a screen of its own, in a scroll view. */
  scroll?: boolean;
}) {
  // Falls back to the raw role, so a stored edge's role outside the list
  // still displays.
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
        commit={relationshipCommit(draft, commitOther)}
      />
    );

  const fields = (
    <>
      {/* Top-aligned, since Name grows downwards as its matches list. */}
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
    <FormScrollView contentContainerStyle={styles.screen}>
      {fields}
    </FormScrollView>
  );
}
