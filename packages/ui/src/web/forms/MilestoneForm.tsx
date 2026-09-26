import {
  type Milestone,
  type MilestoneBearerType,
  type MilestoneDraft,
  type MilestoneDraftErrors,
  type MilestoneKind,
  type RelationshipNeighbor,
  type ReminderRuleInput,
  kindDefs,
  kindsForBearerType,
  preferredBearerType,
} from "@leapsake/schema";
import { type ReactNode, useState } from "react";
import { useMilestoneForm } from "../../headless/index.js";
import { type Messages, useMessages } from "../../messages/index.js";
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

/** Day options 1–31; a day with no month is refused on Save, not by the range. */
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/**
 * Add/edit form for a milestone: {@link useMilestoneForm}'s draft rendered by
 * {@link MilestoneFields}. A relationship kind added from a Person also asks
 * "with whom?" ({@link WithWhomFields}), from `candidates` and `neighbors`.
 */
export function MilestoneForm({
  bearerType,
  milestone,
  initialKind,
  initialSchedule,
  candidates = [],
  neighbors = [],
  cancelTo,
  submitting,
}: {
  bearerType: MilestoneBearerType;
  milestone?: Milestone;
  /** The kind to open on when creating, where the caller knows which is wanted. */
  initialKind?: MilestoneKind;
  /** The milestone's stored schedule, else its kind's defaults; absent on create. */
  initialSchedule?: ReminderRuleInput[];
  candidates?: readonly RelationshipCandidate[];
  neighbors?: readonly RelationshipNeighbor[];
  cancelTo: string;
  submitting: boolean;
}) {
  const m = useMessages();
  const form = useMilestoneForm({
    bearerType,
    milestone,
    kind: initialKind,
    reminderSchedule: initialSchedule,
  });
  const [withWhomReady, setWithWhomReady] = useState(false);

  const editing = milestone !== undefined;
  const needsWithWhom =
    !editing &&
    bearerType === "person" &&
    preferredBearerType(form.fields.kind) === "relationship";

  return (
    <FormShell
      title={editing ? m.milestoneForm.editHeading : m.milestoneForm.addHeading}
      submitLabel={editing ? m.common.save : m.milestoneForm.submitAdd}
      cancelTo={cancelTo}
      submitting={submitting}
      problem={
        needsWithWhom && !withWhomReady
          ? m.milestoneForm.withWhomRequired
          : milestoneProblem(form.errors, m)
      }
    >
      <MilestoneFields
        bearerType={bearerType}
        fields={form.fields}
        errors={form.errors}
        set={form.set}
        setKind={form.setKind}
        setSchedule={form.setSchedule}
        withWhom={
          needsWithWhom && (
            <WithWhomFields
              kind={form.fields.kind}
              candidates={candidates}
              neighbors={neighbors}
              allowUnbound={form.fields.kind === "wedding"}
              onReadyChange={setWithWhomReady}
            />
          )
        }
      />
    </FormShell>
  );
}

function milestoneProblem(
  errors: MilestoneDraftErrors,
  m: Messages,
): string | undefined {
  if (errors.date === "dayWithoutMonth") return m.milestoneForm.dayNeedsMonth;
  if (errors.date === "outOfRange") return m.milestoneForm.dateOutOfRange;
  if (errors.note === "required") return m.milestoneForm.labelRequired;
  if (errors.reminderSchedule === "labelRequired")
    return m.milestoneForm.reminderLabelRequired;
  return undefined;
}

/**
 * A milestone's fields, posted under the names the write path reads: a kind the
 * bearer can hold, any subset of a partial date, a note, and the reminder
 * schedule as JSON on a hidden input.
 */
export function MilestoneFields({
  bearerType,
  fields,
  errors,
  set,
  setKind,
  setSchedule,
  withWhom,
}: {
  bearerType: MilestoneBearerType;
  fields: MilestoneDraft;
  errors: MilestoneDraftErrors;
  set: <K extends keyof MilestoneDraft>(
    key: K,
    value: MilestoneDraft[K],
  ) => void;
  setKind: (kind: MilestoneKind) => void;
  setSchedule: (rules: ReminderRuleInput[]) => void;
  /** The "with whom?" step, shown under the kind when it applies. */
  withWhom?: ReactNode;
}) {
  const m = useMessages();
  const other = fields.kind === "other";
  const def = kindDefs[fields.kind];

  return (
    <>
      <Field label={m.milestoneForm.kind}>
        <select
          name="kind"
          value={fields.kind}
          onChange={(event) => setKind(event.target.value as MilestoneKind)}
        >
          {kindsForBearerType(bearerType).map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>{" "}
      {withWhom}{" "}
      <Field label={m.milestoneForm.month}>
        <select
          name="month"
          value={fields.month}
          onChange={(event) => {
            set("month", event.target.value);
            if (event.target.value === "") set("day", "");
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
          value={fields.day}
          onChange={(event) => set("day", event.target.value)}
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
          step={1}
          value={fields.year}
          onChange={(event) => set("year", event.target.value)}
          placeholder={m.common.none}
        />
      </Field>{" "}
      <Field label={other ? m.milestoneForm.label : m.milestoneForm.noteLabel}>
        <input
          name="note"
          value={fields.note}
          onChange={(event) => set("note", event.target.value)}
          placeholder={
            other
              ? m.milestoneForm.labelPlaceholder
              : m.milestoneForm.notePlaceholder
          }
          required={other}
        />
      </Field>
      {errors.date === "dayWithoutMonth" && (
        <p>{m.milestoneForm.dayNeedsMonth}</p>
      )}
      <p>
        {def.icon ? `${def.icon} ` : ""}
        {def.label}
      </p>
      <ReminderScheduleFields
        value={fields.reminderSchedule}
        onChange={setSchedule}
      />
      <input
        type="hidden"
        name="reminderSchedule"
        value={JSON.stringify(fields.reminderSchedule)}
      />
    </>
  );
}
