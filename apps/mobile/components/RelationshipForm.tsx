import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { RelationshipCandidate } from "@leapsake/core";
import {
  type EntityType,
  type RelationshipRole,
  rolesForPair,
} from "@leapsake/schema";
import { colors, styles } from "../lib/styles";

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
 * core, never entered here. RN has no `<datalist>`, so the typeahead is a filter
 * `TextInput` over the candidate list rendering a pressable list — the mobile
 * stand-in for the desktop datalist.
 *
 * `lockedOther` fixes the other end and hides the picker: it serves both the
 * materialise-a-derived-edge path (other endpoint known, role chosen) and the
 * edit-an-explicit-edge path (endpoints immutable, only the role changes). Like
 * the other forms, this only collects input — the screen owns the
 * `core.relationships.*` call — and hands back a {@link RelationshipFormValue}.
 */
export function RelationshipForm({
  subjectType,
  candidates,
  lockedOther,
  initialRole,
  initialNote,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  subjectType: EntityType;
  candidates?: RelationshipCandidate[];
  lockedOther?: LockedOther;
  initialRole?: RelationshipRole;
  initialNote?: string | null;
  submitLabel: string;
  onSubmit: (value: RelationshipFormValue) => Promise<void>;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RelationshipCandidate | null>(
    lockedOther
      ? { type: lockedOther.type, id: lockedOther.id, label: lockedOther.label }
      : null,
  );
  const [role, setRole] = useState<RelationshipRole | null>(
    initialRole ?? null,
  );
  const [roleQuery, setRoleQuery] = useState("");
  const [note, setNote] = useState(initialNote ?? "");
  const [submitting, setSubmitting] = useState(false);

  const otherType = selected?.type ?? null;

  // Roles the other end may hold for this pair; the subject's role is the implied
  // inverse, so the picker only offers roles whose inverse the subject can hold.
  const roleOptions = useMemo(
    () => (otherType ? rolesForPair(otherType, subjectType) : []),
    [otherType, subjectType],
  );

  // Filter the candidate typeahead; only meaningful when the picker is shown.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = candidates ?? [];
    return (
      q === "" ? all : all.filter((c) => c.label.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [candidates, query]);

  // The role list is long once gendered variants are included (Father, Mother,
  // … alongside Parent), so — like the name picker above — it's a typeahead
  // rather than pills. Empty query shows the whole list to browse.
  const roleMatches = useMemo(() => {
    const q = roleQuery.trim().toLowerCase();
    return (
      q === ""
        ? roleOptions
        : roleOptions.filter((r) => r.label.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [roleOptions, roleQuery]);

  const roleLabel =
    roleOptions.find((r) => r.role === role)?.label ?? role ?? "";

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
    <ScrollView
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
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

      {lockedOther ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name</Text>
          <Text style={styles.fieldValue}>{lockedOther.label}</Text>
        </View>
      ) : selected !== null ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name</Text>
          <View style={styles.rowMeta}>
            <Text style={styles.fieldValue}>{selected.label}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSelected(null);
                setRole(null);
                setRoleQuery("");
              }}
            >
              <Text style={styles.link}>Change</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Start typing a name"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
          />
          {matches.length === 0 ? (
            <Text style={styles.muted}>No matches.</Text>
          ) : (
            matches.map((candidate) => (
              <Pressable
                key={`${candidate.type}:${candidate.id}`}
                accessibilityRole="button"
                style={styles.row}
                onPress={() => {
                  setSelected(candidate);
                  setRole(null);
                  setQuery("");
                  setRoleQuery("");
                }}
              >
                <Text style={styles.rowText}>{candidate.label}</Text>
              </Pressable>
            ))
          )}
        </View>
      )}

      {selected !== null ? (
        role !== null ? (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.rowMeta}>
              <Text style={styles.fieldValue}>{roleLabel}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setRole(null);
                  setRoleQuery("");
                }}
              >
                <Text style={styles.link}>Change</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Role</Text>
            <TextInput
              style={styles.input}
              value={roleQuery}
              onChangeText={setRoleQuery}
              placeholder="Start typing a role"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
            />
            {roleMatches.length === 0 ? (
              <Text style={styles.muted}>No matches.</Text>
            ) : (
              roleMatches.map((r) => (
                <Pressable
                  key={r.role}
                  accessibilityRole="button"
                  style={styles.row}
                  onPress={() => {
                    setRole(r.role);
                    setRoleQuery("");
                  }}
                >
                  <Text style={styles.rowText}>{r.label}</Text>
                </Pressable>
              ))
            )}
          </View>
        )
      ) : null}

      {noteRequired ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Note</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. landlord"
            placeholderTextColor={colors.muted}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}
