import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  type MilestoneBearerType,
  type MilestoneDraft,
  type MilestoneDraftErrors,
  kindDefs,
  kindsForBearerType,
  milestoneDraftWithKind,
  milestoneDraftWithSchedule,
} from "@leapsake/schema";
import { DatePartsFields } from "./DatePartsFields";
import { ReminderScheduleFields } from "./ReminderScheduleFields";
import { SelectField } from "./SelectField";
import { styles } from "../lib/styles";

const TEXT = {
  kind: "Kind",
  date: "Date",
  label: "Label (e.g. Adoption day)",
  note: "Note (optional)",
  show: "Show",
  hide: "Hide",
  reminders: (on: number, total: number) =>
    total === 0
      ? "Reminders · None"
      : on === total
        ? `Reminders · ${on}`
        : `Reminders · ${on} of ${total}`,
  dayWithoutMonth: "Enter a month to go with the day, or clear the day.",
  outOfRange: "Enter a month from 1 to 12 and a day from 1 to 31.",
  labelRequired: "Give this milestone a label before saving.",
  reminderLabelRequired:
    "Give each “Other” reminder a label before saving, or remove it.",
} as const;

/** Why Save can't write the milestone yet, or undefined when it can. */
export function milestoneProblem(
  errors: MilestoneDraftErrors,
): string | undefined {
  if (errors.date !== undefined) return TEXT[errors.date];
  if (errors.note === "required") return TEXT.labelRequired;
  if (errors.reminderSchedule === "labelRequired")
    return TEXT.reminderLabelRequired;
  return undefined;
}

/**
 * Whether the draft says nothing yet: no date and no note, whatever kind is
 * showing. A kind alone is the picker's own default rather than an answer, so a
 * row in this state is the "Add milestone" tap nobody followed through on — see
 * {@link milestoneRowPending}.
 */
export function milestoneDraftEmpty(draft: MilestoneDraft): boolean {
  return (
    draft.month.trim() === "" &&
    draft.day.trim() === "" &&
    draft.year.trim() === "" &&
    draft.note.trim() === ""
  );
}

/**
 * One milestone's fields, ported from the desktop `MilestoneForm` (minus its
 * relationship-binding "with whom?" branches, which belong with the deferred
 * Relationships increment): a kind — constrained to those the bearer type can
 * hold — any subset of a partial date, an optional note, and the staggered
 * reminder schedule.
 *
 * Controlled throughout, with no submit of its own, like {@link PersonFields} and
 * {@link ContactMethodFields}: whoever owns the draft sees every keystroke. That
 * is what lets {@link StagedMilestonesSection} keep every row open and live, and
 * what leaves the writing to whichever Save the caller has.
 *
 * The **reminder schedule** is the one thing that folds away (`collapseSchedule`),
 * because it is a list editor rather than a field: a birthday's defaults alone are
 * three switches, three pickers and three numbers, and a form of four open
 * milestones would be nothing but reminder rules. Collapsed it still says how many
 * are on, and opening it costs a tap and changes nothing.
 */
export function MilestoneFields({
  draft,
  onChange,
  errors,
  bearerType,
  collapseSchedule = false,
  scroll = false,
}: {
  draft: MilestoneDraft;
  onChange: (draft: MilestoneDraft) => void;
  errors: MilestoneDraftErrors;
  bearerType: MilestoneBearerType;
  /** Put the reminder schedule behind a disclosure — see above. */
  collapseSchedule?: boolean;
  /** Fill a screen of its own, in a scroll view. */
  scroll?: boolean;
}) {
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const kinds = kindsForBearerType(bearerType);
  const def = kindDefs[draft.kind];
  const on = draft.reminderSchedule.filter((rule) => rule.enabled).length;

  const schedule = (
    <ReminderScheduleFields
      value={draft.reminderSchedule}
      onChange={(rules) => onChange(milestoneDraftWithSchedule(draft, rules))}
    />
  );

  const fields = (
    <>
      <SelectField
        label={TEXT.kind}
        value={draft.kind}
        options={kinds.map((k) => ({ value: k.kind, label: k.label }))}
        onChange={(kind) => onChange(milestoneDraftWithKind(draft, kind))}
      />

      {/* `milestone-year` is load-bearing for the harness: see subflows/stage-birthday.yaml. */}
      <DatePartsFields
        label={TEXT.date}
        value={draft}
        onChange={({ month, day, year }) =>
          onChange({ ...draft, month, day, year })
        }
        testIDPrefix="milestone"
        error={errors.date === undefined ? null : TEXT[errors.date]}
      />

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>
          {draft.kind === "other" ? TEXT.label : TEXT.note}
        </Text>
        {/*
          Addressable for the same reason `milestone-year` above is: empty, it offers a
          driver nothing to select it by, and Flow 2 of the crucial-flow catalog types a
          note here and reads it back from the edit form.
        */}
        <TextInput
          testID="milestone-note"
          style={styles.input}
          value={draft.note}
          onChangeText={(note) => onChange({ ...draft, note })}
        />
      </View>

      <Text style={styles.muted}>
        {def.icon ? `${def.icon} ` : ""}
        {def.label}
      </Text>

      {collapseSchedule ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: scheduleOpen }}
            style={styles.sectionHeader}
            onPress={() => setScheduleOpen((open) => !open)}
          >
            <Text style={styles.fieldLabel}>
              {TEXT.reminders(on, draft.reminderSchedule.length)}
            </Text>
            <Text style={styles.link}>
              {scheduleOpen ? TEXT.hide : TEXT.show}
            </Text>
          </Pressable>
          {scheduleOpen ? schedule : null}
        </>
      ) : (
        schedule
      )}
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
