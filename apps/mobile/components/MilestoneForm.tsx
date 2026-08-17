import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import {
  type Milestone,
  type MilestoneKind,
  type MilestoneBearerType,
  type ReminderRuleInput,
  kindDefs,
  kindsForBearerType,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { HeaderSave } from "./HeaderSave";
import { SelectField } from "./SelectField";
import { ReminderScheduleFields } from "./ReminderScheduleFields";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** The structured value the form hands back; the screen supplies bearer + call. */
export interface MilestoneFormValue {
  kind: MilestoneKind;
  year: number | null;
  month: number | null;
  day: number | null;
  note: string | null;
  /** The staggered-reminder schedule to persist (replaces the milestone's rules). */
  reminderSchedule: ReminderRuleInput[];
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
 * Mirroring `PetForm`, this component only collects input: the caller owns the
 * `core.milestones.create/update` call (and supplies the bearer), and gets back
 * a structured {@link MilestoneFormValue}. When `milestone` is provided the form
 * is in edit mode and pre-fills from it.
 *
 * With `inline` it renders into the caller's layout rather than owning the
 * screen — no scroll view of its own, since nesting one inside another of the
 * same orientation silently breaks scrolling. That is how the create screen
 * (app/add.tsx) stages a milestone for a bearer that doesn't exist yet: same
 * fields, same validation, but `onSubmit` appends to a list instead of writing.
 *
 * The two modes carry the submit action in different places, which is what splits
 * the props. On its own screen it declares the native header — `title` plus a
 * right-aligned {@link HeaderSave} — and there is no Cancel, since "‹ Back"
 * already leaves. Inline it keeps the in-body `Cancel  submitLabel` row: the
 * header belongs to the screen around it, and Cancel is the only way to collapse
 * the sub-form.
 */
export function MilestoneForm({
  title,
  bearerType,
  milestone,
  submitLabel,
  onSubmit,
  onCancel,
  inline = false,
}: {
  /** Screen mode: the native header title, set here so it's declared in one place. */
  title?: string;
  bearerType: MilestoneBearerType;
  milestone?: Milestone;
  /** Inline mode: the in-body submit button's label. */
  submitLabel?: string;
  onSubmit: (value: MilestoneFormValue) => Promise<void>;
  /** Inline mode: collapses the sub-form. */
  onCancel?: () => void;
  /** Render without the screen-owning scroll view, for embedding in a form. */
  inline?: boolean;
}) {
  const core = useCore();
  const kinds = kindsForBearerType(bearerType);

  const initialKind = milestone?.kind ?? kinds[0]?.kind ?? "birthday";
  const [kind, setKind] = useState<MilestoneKind>(initialKind);
  const [month, setMonth] = useState(milestone?.month?.toString() ?? "");
  const [day, setDay] = useState(milestone?.day?.toString() ?? "");
  const [year, setYear] = useState(milestone?.year?.toString() ?? "");
  const [note, setNote] = useState(milestone?.note ?? "");
  const [submitting, setSubmitting] = useState(false);

  // The staggered-reminder schedule to edit + submit. Seeded from the kind's
  // defaults; when editing, the milestone's stored rules are loaded in (once) to
  // replace them. Until the user touches it, switching kind re-seeds from the new
  // kind's defaults; once they edit a rule it's theirs and a kind change leaves it.
  const [schedule, setSchedule] = useState<ReminderRuleInput[]>(() =>
    resolveReminderSchedule(initialKind, []),
  );
  const [scheduleCustomized, setScheduleCustomized] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!milestone || hydratedRef.current) return;
    hydratedRef.current = true;
    let active = true;
    void core.milestones
      .reminderSchedule(milestone.id, milestone.kind)
      .then((loaded) => {
        if (active) setSchedule(loaded);
      });
    return () => {
      active = false;
    };
  }, [core, milestone]);

  const onKindChange = (next: MilestoneKind) => {
    setKind(next);
    if (!scheduleCustomized) setSchedule(resolveReminderSchedule(next, []));
  };
  const onScheduleChange = (next: ReminderRuleInput[]) => {
    setSchedule(next);
    setScheduleCustomized(true);
  };

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
  // Mirror the rule that an `other` reminder needs a label (the schema re-checks).
  const scheduleValid = schedule.every(
    (rule) => rule.action !== "other" || (rule.label ?? "").trim() !== "",
  );
  const canSubmit =
    !submitting &&
    !dayWithoutMonth &&
    dayValid &&
    yearValid &&
    noteOk &&
    scheduleValid;

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
        reminderSchedule: schedule,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const def = kindDefs[kind];

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

      <SelectField
        label="Kind"
        value={kind}
        options={kinds.map((k) => ({ value: k.kind, label: k.label }))}
        onChange={(value) => onKindChange(value)}
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
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Year</Text>
        <TextInput
          style={styles.input}
          value={year}
          onChangeText={setYear}
          keyboardType="number-pad"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>
          {noteRequired ? "Label (e.g. Adoption day)" : "Note (optional)"}
        </Text>
        <TextInput style={styles.input} value={note} onChangeText={setNote} />
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

      <ReminderScheduleFields value={schedule} onChange={onScheduleChange} />
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
