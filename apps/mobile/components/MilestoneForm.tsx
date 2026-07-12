import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  type Milestone,
  type MilestoneKind,
  type MilestoneBearerType,
  kindDefs,
  kindsForBearerType,
} from "@leapsake/schema";
import { SelectField } from "./SelectField";
import { colors, styles } from "../lib/styles";

/** The structured value the form hands back; the screen supplies bearer + call. */
export interface MilestoneFormValue {
  kind: MilestoneKind;
  year: number | null;
  month: number | null;
  day: number | null;
  note: string | null;
}

/** Month options for the picker: a leading unset, then value "1".."12" with the locale's long names. */
const MONTH_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Date(Date.UTC(2001, i, 1)).toLocaleDateString(undefined, {
      month: "long",
      timeZone: "UTC",
    }),
  })),
];

/**
 * Add/edit form for a milestone, ported from the desktop `MilestoneForm` (minus
 * its relationship-binding "with whom?" / rebind branches, which belong with the
 * deferred Relationships increment). The user picks a kind — constrained to those
 * the bearer type can hold — plus any subset of a partial date (month, day,
 * year) and an optional note. The day⇒month rule is mirrored here for friendly
 * inline validation; the schema re-validates on submit.
 *
 * Mirroring `PetForm`, this component only collects input: the screen owns the
 * `core.milestones.create/update` call (and supplies the bearer), and gets back
 * a structured {@link MilestoneFormValue}. When `milestone` is provided the form
 * is in edit mode and pre-fills from it.
 */
export function MilestoneForm({
  bearerType,
  milestone,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  bearerType: MilestoneBearerType;
  milestone?: Milestone;
  submitLabel: string;
  onSubmit: (value: MilestoneFormValue) => Promise<void>;
  onCancel: () => void;
}) {
  const kinds = kindsForBearerType(bearerType);

  const [kind, setKind] = useState<MilestoneKind>(
    milestone?.kind ?? kinds[0]?.kind ?? "birthday",
  );
  const [month, setMonth] = useState(milestone?.month?.toString() ?? "");
  const [day, setDay] = useState(milestone?.day?.toString() ?? "");
  const [year, setYear] = useState(milestone?.year?.toString() ?? "");
  const [note, setNote] = useState(milestone?.note ?? "");
  const [submitting, setSubmitting] = useState(false);

  const monthNum = month === "" ? null : Number(month);
  const dayNum = day.trim() === "" ? null : Number(day);
  const yearNum = year.trim() === "" ? null : Number(year);

  // Mirror the schema rules so submit is only offered for a value it will accept.
  const dayWithoutMonth = dayNum !== null && monthNum === null;
  const dayValid =
    dayNum === null ||
    (Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31);
  const yearValid = yearNum === null || Number.isInteger(yearNum);
  const noteRequired = kind === "other";
  const noteOk = !noteRequired || note.trim().length > 0;
  const canSubmit =
    !submitting && !dayWithoutMonth && dayValid && yearValid && noteOk;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        kind,
        year: yearNum,
        month: monthNum,
        day: dayNum,
        note: note.trim() === "" ? null : note.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const def = kindDefs[kind];

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

      <SelectField
        label="Kind"
        value={kind}
        options={kinds.map((k) => ({ value: k.kind, label: k.label }))}
        onChange={(value) => setKind(value)}
      />

      <SelectField
        label="Month"
        value={month}
        options={MONTH_OPTIONS}
        onChange={(value) => {
          setMonth(value);
          // A day is only meaningful alongside a month; clearing month clears it.
          if (value === "") setDay("");
        }}
      />

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Day</Text>
        <TextInput
          style={[styles.input, month === "" && { opacity: 0.5 }]}
          value={day}
          onChangeText={setDay}
          editable={month !== ""}
          keyboardType="number-pad"
          placeholder="—"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Year</Text>
        <TextInput
          style={styles.input}
          value={year}
          onChangeText={setYear}
          keyboardType="number-pad"
          placeholder="—"
          placeholderTextColor={colors.muted}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{noteRequired ? "Label" : "Note"}</Text>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder={noteRequired ? "e.g. Adoption day" : "optional"}
          placeholderTextColor={colors.muted}
        />
      </View>

      {dayWithoutMonth ? (
        <Text style={styles.muted}>
          Pick a month before a day, or clear the day.
        </Text>
      ) : null}

      <Text style={styles.muted}>
        {def.icon ? `${def.icon} ` : ""}
        {def.label}
      </Text>
    </ScrollView>
  );
}
