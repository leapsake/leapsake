import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  type Milestone,
  type MilestoneBearerType,
  type MilestoneKind,
  type ReminderRuleInput,
  kindDefs,
  kindsForBearerType,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { ReminderScheduleFields } from "./ReminderScheduleFields";
import { SelectField } from "./SelectField";
import { styles } from "../lib/styles";

/** The structured value the write uses; the caller supplies bearer + call. */
export interface MilestoneFormValue {
  kind: MilestoneKind;
  year: number | null;
  month: number | null;
  day: number | null;
  note: string | null;
  /** The staggered-reminder schedule to persist (replaces the milestone's rules). */
  reminderSchedule: ReminderRuleInput[];
}

/**
 * A milestone as the UI holds it: the date parts as typed, nothing parsed —
 * the same idea as {@link PersonDraft} and {@link ContactDraft}. A half-typed
 * year is a string on its way to being a number, and has to survive being looked
 * at.
 */
export interface MilestoneDraft {
  kind: MilestoneKind;
  /** "" or "1".."12" — the picker's own values. */
  month: string;
  day: string;
  year: string;
  note: string;
  reminderSchedule: ReminderRuleInput[];
  /**
   * Whether the schedule is the **user's** rather than the kind's defaults.
   * Until they touch it, changing the kind re-seeds it from the new kind's
   * defaults; once they have edited a rule it is theirs and a kind change leaves
   * it alone. Never written — it is a fact about the editing, not the milestone.
   */
  scheduleCustomized: boolean;
}

/** Month options: a leading unset, then "1".."12" with the locale's long names. */
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

export function emptyMilestoneDraft(
  bearerType: MilestoneBearerType,
): MilestoneDraft {
  const kind = kindsForBearerType(bearerType)[0]?.kind ?? "birthday";
  return {
    kind,
    month: "",
    day: "",
    year: "",
    note: "",
    reminderSchedule: resolveReminderSchedule(kind, []).rules,
    scheduleCustomized: false,
  };
}

/**
 * A saved milestone as a draft. The schedule is passed in rather than fetched:
 * it lives a query away (`core.milestones.reminderSchedule`), and the screen that
 * seeds a whole form of these does that query with all its others.
 */
export function milestoneDraftFrom(
  milestone: Milestone,
  reminderSchedule: ReminderRuleInput[],
): MilestoneDraft {
  return {
    kind: milestone.kind,
    month: milestone.month?.toString() ?? "",
    day: milestone.day?.toString() ?? "",
    year: milestone.year?.toString() ?? "",
    note: milestone.note ?? "",
    reminderSchedule,
    scheduleCustomized: false,
  };
}

/** The draft as the write wants it: the date parts parsed, the note trimmed. */
export function milestoneDraftToValue(
  draft: MilestoneDraft,
): MilestoneFormValue {
  const note = draft.note.trim();
  return {
    kind: draft.kind,
    year: numberOrNull(draft.year),
    month: numberOrNull(draft.month),
    day: numberOrNull(draft.day),
    note: note === "" ? null : note,
    reminderSchedule: draft.reminderSchedule,
  };
}

function numberOrNull(raw: string): number | null {
  return raw.trim() === "" ? null : Number(raw);
}

/** A day is only meaningful alongside the month it falls in. */
function dayWithoutMonth(draft: MilestoneDraft): boolean {
  return draft.day.trim() !== "" && draft.month === "";
}

/**
 * Whether the draft would pass the schema — the same rules it enforces, mirrored
 * so the form can refuse before the write does.
 */
export function milestoneDraftValid(draft: MilestoneDraft): boolean {
  const day = numberOrNull(draft.day);
  const year = numberOrNull(draft.year);
  return (
    !dayWithoutMonth(draft) &&
    (day === null || (Number.isInteger(day) && day >= 1 && day <= 31)) &&
    (year === null || Number.isInteger(year)) &&
    // An `other` milestone is named by its note, and an `other` reminder by its
    // label; the schema re-checks both.
    (draft.kind !== "other" || draft.note.trim().length > 0) &&
    draft.reminderSchedule.every(
      (rule) => rule.action !== "other" || (rule.label ?? "").trim() !== "",
    )
  );
}

/**
 * Whether the draft says nothing yet: no date and no note, whatever kind is
 * showing. A kind alone is the picker's own default rather than an answer, so a
 * row in this state is the "Add milestone" tap nobody followed through on — see
 * {@link milestoneRowPending}.
 */
export function milestoneDraftEmpty(draft: MilestoneDraft): boolean {
  return (
    draft.month === "" &&
    draft.day.trim() === "" &&
    draft.year.trim() === "" &&
    draft.note.trim() === ""
  );
}

/** How many of the schedule's rules are switched on — the collapsed summary. */
function scheduleSummary(schedule: readonly ReminderRuleInput[]): string {
  const on = schedule.filter((rule) => rule.enabled).length;
  if (schedule.length === 0) return "None";
  return on === schedule.length ? `${on}` : `${on} of ${schedule.length}`;
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
  bearerType,
  collapseSchedule = false,
}: {
  draft: MilestoneDraft;
  onChange: (draft: MilestoneDraft) => void;
  bearerType: MilestoneBearerType;
  /** Put the reminder schedule behind a disclosure — see above. */
  collapseSchedule?: boolean;
}) {
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const set = <K extends keyof MilestoneDraft>(
    key: K,
    value: MilestoneDraft[K],
  ) => onChange({ ...draft, [key]: value });

  const kinds = kindsForBearerType(bearerType);
  const def = kindDefs[draft.kind];
  const noteRequired = draft.kind === "other";

  const schedule = (
    <ReminderScheduleFields
      value={draft.reminderSchedule}
      onChange={(reminderSchedule) =>
        onChange({ ...draft, reminderSchedule, scheduleCustomized: true })
      }
    />
  );

  return (
    <>
      <SelectField
        label="Kind"
        value={draft.kind}
        options={kinds.map((k) => ({ value: k.kind, label: k.label }))}
        onChange={(kind) =>
          onChange({
            ...draft,
            kind,
            reminderSchedule: draft.scheduleCustomized
              ? draft.reminderSchedule
              : resolveReminderSchedule(kind, []).rules,
          })
        }
      />

      <SelectField
        label="Month"
        value={draft.month}
        options={MONTH_OPTIONS}
        onChange={(month) =>
          // A day is only meaningful alongside a month; clearing month clears it.
          onChange({ ...draft, month, day: month === "" ? "" : draft.day })
        }
      />

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Day</Text>
        <TextInput
          style={[styles.input, draft.month === "" && { opacity: 0.5 }]}
          value={draft.day}
          onChangeText={(value) => set("day", value)}
          editable={draft.month !== ""}
          keyboardType="number-pad"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Year</Text>
        {/*
          The harness's way to say *something* about a milestone: the Kind and
          Month are `SelectField`s, whose options iOS doesn't expose, and a plain
          `TextInput` carries no accessibility text of its own (see the note in
          `PersonFields`). A year is the one date part a driver can just type.
        */}
        <TextInput
          testID="milestone-year"
          style={styles.input}
          value={draft.year}
          onChangeText={(value) => set("year", value)}
          keyboardType="number-pad"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>
          {noteRequired ? "Label (e.g. Adoption day)" : "Note (optional)"}
        </Text>
        {/*
          Addressable for the same reason `milestone-year` above is: empty, it offers a
          driver nothing to select it by, and Flow 3 of the crucial-flow catalog types a
          note here and reads it back off the person's page.
        */}
        <TextInput
          testID="milestone-note"
          style={styles.input}
          value={draft.note}
          onChangeText={(value) => set("note", value)}
        />
      </View>

      {dayWithoutMonth(draft) ? (
        <Text style={styles.muted}>
          Pick a month before a day, or clear the day.
        </Text>
      ) : null}

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
              Reminders · {scheduleSummary(draft.reminderSchedule)}
            </Text>
            <Text style={styles.link}>{scheduleOpen ? "Hide" : "Show"}</Text>
          </Pressable>
          {scheduleOpen ? schedule : null}
        </>
      ) : (
        schedule
      )}
    </>
  );
}
