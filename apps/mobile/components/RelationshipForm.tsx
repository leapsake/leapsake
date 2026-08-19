import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
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

/**
 * The structured value the form hands back; the screen supplies subject + call.
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
type OtherOption =
  | { kind: "existing"; type: EntityType; id: string; label: string }
  | { kind: "new"; type: EntityType; name: string; label: string };

/** A stable key per option; the `new` rows key on type so the two offered for one
 *  typed name don't collide. */
function otherKey(option: OtherOption): string {
  return option.kind === "existing"
    ? `existing:${option.type}:${option.id}`
    : `new:${option.type}`;
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
 * the other forms, this only collects input — the caller owns the
 * `core.relationships.*` call — and hands back a {@link RelationshipFormValue}.
 *
 * The Name picker offers the people and pets already in the list, and beneath
 * them the option to add whatever has been typed as somebody new. That second
 * kind is how an unpublished entity comes about — a coworker's wife, existing as
 * a fact about him and nothing else — and it is why the form's value is a union:
 * the two need different core calls. Both entity types are offered for a new
 * name, because the role list depends on which it is.
 *
 * With `inline` it renders into the caller's layout rather than owning the
 * screen — no scroll view of its own, since nesting one inside another of the
 * same orientation silently breaks scrolling. That is how the create screen
 * (app/add.tsx) stages a relationship for a subject that doesn't exist yet: the
 * other end never depends on the subject, so the picker, the pair-dependent role
 * list, and the `other` note rule are all identical; only the subject id is
 * missing, and it arrives before the write.
 *
 * The two modes carry the submit action in different places, which is what splits
 * the props. On its own screen it declares the native header — `title` plus a
 * right-aligned {@link HeaderSave} — and there is no Cancel, since "‹ Back"
 * already leaves. Inline it keeps the in-body `Cancel  submitLabel` row: the
 * header belongs to the screen around it, and Cancel is the only way to collapse
 * the sub-form.
 */
export function RelationshipForm({
  title,
  subjectType,
  candidates,
  lockedOther,
  initialRole,
  initialNote,
  submitLabel,
  onSubmit,
  onCancel,
  inline = false,
}: {
  /** Screen mode: the native header title, set here so it's declared in one place. */
  title?: string;
  subjectType: EntityType;
  candidates?: RelationshipCandidate[];
  lockedOther?: LockedOther;
  initialRole?: RelationshipRole;
  initialNote?: string | null;
  /** Inline mode: the in-body submit button's label. */
  submitLabel?: string;
  onSubmit: (value: RelationshipFormValue) => Promise<void>;
  /** Inline mode: collapses the sub-form. */
  onCancel?: () => void;
  /** Render without the screen-owning scroll view, for embedding in a form. */
  inline?: boolean;
}) {
  const [selected, setSelected] = useState<OtherOption | null>(
    lockedOther
      ? {
          kind: "existing",
          type: lockedOther.type,
          id: lockedOther.id,
          label: lockedOther.label,
        }
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
      const common = {
        otherType: selected.type,
        otherRole: role,
        otherRoleNote: noteRequired ? note.trim() : null,
      };
      await onSubmit(
        selected.kind === "existing"
          ? { ...common, other: "existing", otherId: selected.id }
          : { ...common, other: "new", otherName: selected.name },
      );
    } finally {
      setSubmitting(false);
    }
  }

  const body = (
    <>
      {inline ? (
        <View style={[styles.headerActions, { justifyContent: "flex-end" }]}>
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            disabled={submitting}
          >
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[styles.button, !canSubmit && { opacity: 0.5 }]}
          >
            <Text style={styles.buttonText}>{submitLabel}</Text>
          </Pressable>
        </View>
      ) : null}

      {lockedOther ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name</Text>
          <Text style={styles.fieldValue}>{lockedOther.label}</Text>
        </View>
      ) : (
        <Typeahead<OtherOption>
          testID="relationship-other-name"
          label="Name"
          value={selected}
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
          onChange={(option) => {
            setSelected(option);
            setRole(null);
          }}
          getKey={otherKey}
          getLabel={(o) => o.label}
        />
      )}

      {selected !== null ? (
        <Typeahead<RoleOption>
          // Remount on a name change so the role's live query resets.
          key={otherKey(selected)}
          testID="relationship-other-role"
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
    </>
  );

  if (inline) return <View style={styles.inlineForm}>{body}</View>;

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
        {body}
      </ScrollView>
    </>
  );
}
