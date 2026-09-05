import {
  type Milestone,
  type MilestoneBearerType,
  type MilestoneKind,
  type RelationshipNeighbor,
  type ReminderRuleInput,
  kindDefs,
  kindsForBearerType,
  preferredBearerType,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { useMemo, useState } from "react";
import { useMessages } from "../../messages/index.js";
import type { RelationshipCandidate } from "../fields/RelationshipFields.js";
import { ReminderScheduleFields } from "../fields/ReminderScheduleFields.js";
import { WithWhomFields } from "../fields/WithWhomFields.js";
import { FormShell } from "../patterns/FormShell.js";
import { Field } from "../primitives/Field.js";

/** Month options for the picker: value 1–12 with the locale's long names. */
const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(Date.UTC(2001, i, 1)).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  }),
}));

/** Day options 1–31; the day⇒month rule is enforced below, not by the range. */
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/**
 * Add/edit form for a milestone, rendered on a bearer entity's page. The user
 * picks a kind (constrained to those the bearer type can hold) and any subset
 * of a partial date — month, day, year — plus an optional note. The day⇒month
 * rule is mirrored here for friendly inline validation; the write path
 * re-validates.
 *
 * Visible inputs are controlled so the kind/date interplay (the note field for
 * `other`, the day-needs-month guard) can react live; their `name`s carry the
 * machine values the write path consumes. When `milestone` is provided the form
 * is in edit mode and pre-fills from it.
 *
 * Adding a relationship kind (Met / First Date / Wedding) from a **Person**
 * reveals a {@link WithWhomFields} step: `candidates`/`neighbors` (loaded only
 * for a Person create) drive binding/inference of the other party.
 */
export function MilestoneForm({
  bearerType,
  milestone,
  initialKind: requestedKind,
  initialSchedule,
  candidates = [],
  neighbors = [],
  cancelTo,
  submitting,
}: {
  bearerType: MilestoneBearerType;
  milestone?: Milestone;
  /**
   * The kind to open on when creating, where the caller knows which one is
   * wanted — a partnership question ("when is your wedding anniversary?") sends
   * the user here to answer *that*, and a blank kind picker would hand the
   * question back. Ignored when editing, where the milestone's own kind wins.
   */
  initialKind?: MilestoneKind;
  /**
   * The milestone's resolved reminder schedule (stored rules, else kind
   * defaults), loaded when editing. Absent on create — the schedule is derived
   * from the picked kind's defaults instead.
   */
  initialSchedule?: ReminderRuleInput[];
  candidates?: readonly RelationshipCandidate[];
  neighbors?: readonly RelationshipNeighbor[];
  cancelTo: string;
  submitting: boolean;
}) {
  const m = useMessages();
  const kinds = useMemo(() => kindsForBearerType(bearerType), [bearerType]);

  const initialKind =
    milestone?.kind ?? requestedKind ?? kinds[0]?.kind ?? "birthday";
  const [kind, setKind] = useState<MilestoneKind>(initialKind);
  const [month, setMonth] = useState(milestone?.month?.toString() ?? "");
  const [day, setDay] = useState(milestone?.day?.toString() ?? "");
  const [year, setYear] = useState(milestone?.year?.toString() ?? "");
  const [note, setNote] = useState(milestone?.note ?? "");
  const [withWhomReady, setWithWhomReady] = useState(false);

  // The staggered-reminder schedule to edit + submit. Seeded from the loaded
  // schedule (edit) or the initial kind's defaults (create). Until the user
  // touches it, switching kind re-seeds it from the new kind's defaults; once
  // they edit a rule it's theirs and a kind change leaves it alone.
  const [schedule, setSchedule] = useState<ReminderRuleInput[]>(
    initialSchedule ?? resolveReminderSchedule(initialKind, []).rules,
  );
  const [scheduleCustomized, setScheduleCustomized] = useState(false);

  const onKindChange = (next: MilestoneKind) => {
    setKind(next);
    if (!scheduleCustomized)
      setSchedule(resolveReminderSchedule(next, []).rules);
  };
  const onScheduleChange = (next: ReminderRuleInput[]) => {
    setSchedule(next);
    setScheduleCustomized(true);
  };

  const editing = milestone !== undefined;
  // A relationship kind added from a Person needs the "with whom?" step; for
  // every other case the bearer is fixed and the picker stays hidden.
  const needsWithWhom =
    !editing &&
    bearerType === "person" &&
    preferredBearerType(kind) === "relationship";

  // Mirror the schema rule: a day is only meaningful alongside a month.
  const dayWithoutMonth = day !== "" && month === "";
  // Mirror the rule that an `other` reminder needs a label, so submit stays
  // enabled only when every such row has one (the write path re-validates).
  const scheduleValid = schedule.every(
    (rule) => rule.action !== "other" || (rule.label ?? "").trim() !== "",
  );

  return (
    <FormShell
      title={editing ? m.milestoneForm.editHeading : m.milestoneForm.addHeading}
      submitLabel={editing ? m.common.save : m.milestoneForm.submitAdd}
      cancelTo={cancelTo}
      submitting={submitting}
      canSubmit={
        !dayWithoutMonth && scheduleValid && (!needsWithWhom || withWhomReady)
      }
    >
      <Field label={m.milestoneForm.kind}>
        <select
          name="kind"
          value={kind}
          onChange={(event) =>
            onKindChange(event.target.value as MilestoneKind)
          }
        >
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>{" "}
      {needsWithWhom && (
        <WithWhomFields
          kind={kind}
          candidates={candidates}
          neighbors={neighbors}
          allowUnbound={kind === "wedding"}
          onReadyChange={setWithWhomReady}
        />
      )}{" "}
      <Field label={m.milestoneForm.month}>
        <select
          name="month"
          value={month}
          onChange={(event) => {
            setMonth(event.target.value);
            if (event.target.value === "") setDay("");
          }}
        >
          <option value="">{m.common.none}</option>
          {MONTHS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>{" "}
      <Field label={m.milestoneForm.day}>
        <select
          name="day"
          value={day}
          disabled={month === ""}
          onChange={(event) => setDay(event.target.value)}
        >
          <option value="">{m.common.none}</option>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </Field>{" "}
      <Field label={m.milestoneForm.year}>
        <input
          type="number"
          name="year"
          value={year}
          onChange={(event) => setYear(event.target.value)}
          placeholder={m.common.none}
        />
      </Field>{" "}
      <Field
        label={
          kind === "other" ? m.milestoneForm.label : m.milestoneForm.noteLabel
        }
      >
        <input
          name="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            kind === "other"
              ? m.milestoneForm.labelPlaceholder
              : m.milestoneForm.notePlaceholder
          }
          required={kind === "other"}
        />
      </Field>
      {dayWithoutMonth && <p>{m.milestoneForm.dayNeedsMonth}</p>}
      <p>
        {kindDefs[kind].icon ? `${kindDefs[kind].icon} ` : ""}
        {kindDefs[kind].label}
      </p>
      {/* The staggered-reminder schedule, serialised to a hidden field the
          write path reads (the controlled-field-with-a-name pattern). */}
      <ReminderScheduleFields value={schedule} onChange={onScheduleChange} />
      <input
        type="hidden"
        name="reminderSchedule"
        value={JSON.stringify(schedule)}
      />
    </FormShell>
  );
}
