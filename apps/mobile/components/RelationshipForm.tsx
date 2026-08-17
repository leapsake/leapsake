import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import type { RelationshipCandidate } from "@leapsake/core";
import {
  type EntityType,
  type RelationshipRole,
  rolesForPair,
} from "@leapsake/schema";
import { HeaderSave } from "./HeaderSave";
import { Typeahead } from "./Typeahead";
import { styles } from "../lib/styles";

/** A role option as the shared {@link Typeahead} carries it. */
type RoleOption = { role: RelationshipRole; label: string };

/** The structured value the form hands back; the screen supplies subject + call. */
export interface RelationshipFormValue {
  otherType: EntityType;
  otherId: string;
  otherRole: RelationshipRole;
  otherRoleNote: string | null;
}

/** The fixed other end when adding/materialising/editing against a known entity. */
export interface LockedOther {
  type: EntityType;
  id: string;
  label: string;
}

/**
 * Add/edit form for a relationship, ported from the desktop `RelationshipForm`.
 * The user picks the *other* entity and that entity's role relative to the
 * subject; the subject's own role is the gender-neutral inverse and is derived by
 * core, never entered here. Both pickers are the shared {@link Typeahead} (the
 * mobile `<datalist>`); the Role one is keyed by the selected entity so its query
 * resets whenever the Name changes.
 *
 * `lockedOther` fixes the other end and hides the picker: it serves both the
 * materialise-a-derived-edge path (other endpoint known, role chosen) and the
 * edit-an-explicit-edge path (endpoints immutable, only the role changes). Like
 * the other forms, this only collects input — the screen owns the
 * `core.relationships.*` call — and hands back a {@link RelationshipFormValue} —
 * and it declares its own native header, title plus a right-aligned
 * {@link HeaderSave}, so `canSubmit` never has to be lifted out of it.
 */
export function RelationshipForm({
  title,
  subjectType,
  candidates,
  lockedOther,
  initialRole,
  initialNote,
  onSubmit,
}: {
  /** Native header title, set here so the header is declared in one place. */
  title: string;
  subjectType: EntityType;
  candidates?: RelationshipCandidate[];
  lockedOther?: LockedOther;
  initialRole?: RelationshipRole;
  initialNote?: string | null;
  onSubmit: (value: RelationshipFormValue) => Promise<void>;
}) {
  const [selected, setSelected] = useState<RelationshipCandidate | null>(
    lockedOther
      ? { type: lockedOther.type, id: lockedOther.id, label: lockedOther.label }
      : null,
  );
  const [role, setRole] = useState<RelationshipRole | null>(
    initialRole ?? null,
  );
  const [note, setNote] = useState(initialNote ?? "");
  const [submitting, setSubmitting] = useState(false);

  const otherType = selected?.type ?? null;

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
    role === null
      ? null
      : (roleOptions.find((r) => r.role === role) ?? { role, label: role });

  const noteRequired = role === "other";
  const noteOk = !noteRequired || note.trim().length > 0;
  const canSubmit = !submitting && selected !== null && role !== null && noteOk;

  async function handleSubmit() {
    if (!canSubmit || selected === null || role === null) return;
    setSubmitting(true);
    try {
      await onSubmit({
        otherType: selected.type,
        otherId: selected.id,
        otherRole: role,
        otherRoleNote: noteRequired ? note.trim() : null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <HeaderSave
              canSave={canSubmit}
              saving={submitting}
              onPress={() => void handleSubmit()}
            />
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        {lockedOther ? (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Name</Text>
            <Text style={styles.fieldValue}>{lockedOther.label}</Text>
          </View>
        ) : (
          <Typeahead<RelationshipCandidate>
            label="Name"
            value={selected}
            options={candidates ?? []}
            // Re-picking the name invalidates the role (it's pair-dependent).
            onChange={(candidate) => {
              setSelected(candidate);
              setRole(null);
            }}
            getKey={(c) => `${c.type}:${c.id}`}
            getLabel={(c) => c.label}
          />
        )}

        {selected !== null ? (
          <Typeahead<RoleOption>
            // Remount on a name change so the role's live query resets.
            key={selected.id}
            label="Role"
            value={selectedRole}
            options={roleOptions}
            onChange={(option) => setRole(option?.role ?? null)}
            getKey={(r) => r.role}
            getLabel={(r) => r.label}
          />
        ) : null}

        {noteRequired ? (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Note (e.g. landlord)</Text>
            <TextInput style={styles.input} value={note} onChangeText={setNote} />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
