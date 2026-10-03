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
  promptItemsOf,
} from "@leapsake/schema";
import { CheckboxBox } from "./Checkbox";
import { DatePartsFields } from "./DatePartsFields";
import { DetailField } from "./DetailField";
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
  reminderDuplicate:
    "Two reminders do the same thing. Change or remove one before saving.",
  asksEachYear: "Ask me each year what to do",
} as const;

/** Why Save can't write the milestone yet, or undefined when it can. */
export function milestoneProblem(
  errors: MilestoneDraftErrors,
): string | undefined {
  if (errors.date !== undefined) return TEXT[errors.date];
  if (errors.note === "required") return TEXT.labelRequired;
  if (errors.reminderSchedule === "labelRequired")
    return TEXT.reminderLabelRequired;
  if (errors.reminderSchedule === "duplicate") return TEXT.reminderDuplicate;
  return undefined;
}

/** No date and no note; the kind showing is only the picker's default. */
export function milestoneDraftEmpty(draft: MilestoneDraft): boolean {
  return (
    draft.month.trim() === "" &&
    draft.day.trim() === "" &&
    draft.year.trim() === "" &&
    draft.note.trim() === ""
  );
}

/**
 * One milestone's kind, partial date, note and reminder schedule, with no
 * submit of its own; the schedule can fold away, saying how many are on.
 */
export function MilestoneFields({
  draft,
  onChange,
  errors,
  bearerType,
  collapseSchedule = false,
  kindFixed = false,
  scroll = false,
}: {
  draft: MilestoneDraft;
  onChange: (draft: MilestoneDraft) => void;
  errors: MilestoneDraftErrors;
  bearerType: MilestoneBearerType;
  /** Put the reminder schedule behind a disclosure. */
  collapseSchedule?: boolean;
  /** Show the kind without a picker, where the caller chose it. */
  kindFixed?: boolean;
  /** Fill a screen of its own, in a scroll view. */
  scroll?: boolean;
}) {
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const kinds = kindsForBearerType(bearerType);
  const def = kindDefs[draft.kind];
  // Counted as drawn: a gift and its delivery are one line.
  const lines = promptItemsOf(draft.reminderSchedule);
  const on = lines.filter(({ rule }) => rule.enabled).length;

  const schedule = (
    <>
      {def.prompt !== undefined && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: draft.asksEachYear }}
          accessibilityLabel={TEXT.asksEachYear}
          onPress={() =>
            onChange({ ...draft, asksEachYear: !draft.asksEachYear })
          }
          style={[styles.row, styles.rowWithLead]}
        >
          <CheckboxBox checked={draft.asksEachYear} />
          <Text style={[styles.rowText, styles.rowBody]}>
            {TEXT.asksEachYear}
          </Text>
        </Pressable>
      )}
      <ReminderScheduleFields
        value={draft.reminderSchedule}
        onChange={(rules) => onChange(milestoneDraftWithSchedule(draft, rules))}
      />
    </>
  );

  const fields = (
    <>
      {kindFixed ? (
        <DetailField
          label={TEXT.kind}
          value={`${def.icon ? `${def.icon} ` : ""}${def.label}`}
        />
      ) : (
        <SelectField
          label={TEXT.kind}
          value={draft.kind}
          options={kinds.map((k) => ({ value: k.kind, label: k.label }))}
          onChange={(kind) => onChange(milestoneDraftWithKind(draft, kind))}
        />
      )}

      {/* `milestone-year` is an E2E anchor: subflows/stage-birthday.yaml. */}
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
        {/* An E2E anchor: empty, it offers a driver nothing to select. */}
        <TextInput
          testID="milestone-note"
          style={styles.input}
          value={draft.note}
          onChangeText={(note) => onChange({ ...draft, note })}
        />
      </View>

      {collapseSchedule ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: scheduleOpen }}
            style={styles.sectionHeader}
            onPress={() => setScheduleOpen((open) => !open)}
          >
            <Text style={styles.fieldLabel}>
              {TEXT.reminders(on, lines.length)}
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
