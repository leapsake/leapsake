import {
  type Milestone,
  type MilestoneKind,
  type MilestoneBearerType,
  type RelationshipNeighbor,
  type ReminderRuleInput,
  kindDefs,
  kindsForBearerType,
  preferredBearerType,
  resolveReminderSchedule,
} from "@leapsake/schema";
import { useMemo, useState } from "react";
import { Form, Link, useNavigation } from "react-router-dom";
import type { RelationshipCandidate } from "./RelationshipForm";
import { ReminderScheduleFields } from "./ReminderScheduleFields";
import { WithWhomFields } from "./WithWhomFields";

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
 * rule is mirrored here for friendly inline validation; the server re-validates.
 *
 * Visible inputs are controlled so the kind/date interplay (the note field for
 * `other`, the day-needs-month guard) can react live; their `name`s carry the
 * machine values the route action consumes. When `milestone` is provided the
 * form is in edit mode and pre-fills from it.
 *
 * Adding a relationship kind (Met / First Date / Wedding) from a **Person**
 * reveals a {@link WithWhomFields} step: `candidates`/`neighbors` (loaded only
 * for a Person create) drive binding/inference of the other party.
 */
export function MilestoneForm({
  bearerType,
  milestone,
  initialSchedule,
  candidates = [],
  neighbors = [],
  cancelTo,
}: {
  bearerType: MilestoneBearerType;
  milestone?: Milestone;
  /**
   * The milestone's resolved reminder schedule (stored rules, else kind
   * defaults), loaded when editing. Absent on create — the schedule is derived
   * from the picked kind's defaults instead.
   */
  initialSchedule?: ReminderRuleInput[];
  candidates?: RelationshipCandidate[];
  neighbors?: RelationshipNeighbor[];
  cancelTo: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const kinds = useMemo(() => kindsForBearerType(bearerType), [bearerType]);

  const initialKind = milestone?.kind ?? kinds[0]?.kind ?? "birthday";
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
    initialSchedule ?? resolveReminderSchedule(initialKind, []),
  );
  const [scheduleCustomized, setScheduleCustomized] = useState(false);

  const onKindChange = (next: MilestoneKind) => {
    setKind(next);
    if (!scheduleCustomized) setSchedule(resolveReminderSchedule(next, []));
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
  // enabled only when every such row has one (the server re-validates).
  const scheduleValid = schedule.every(
    (rule) => rule.action !== "other" || (rule.label ?? "").trim() !== "",
  );
  const ready =
    !dayWithoutMonth && scheduleValid && (!needsWithWhom || withWhomReady);

  return (
    <Form method="post">
      <header>
        <h1>{editing ? "Edit milestone" : "Add milestone"}</h1>
        <button type="submit" disabled={submitting || !ready}>
          {editing ? "Save" : "Add"}
        </button>{" "}
        <Link to={cancelTo}>Cancel</Link>
      </header>

      <fieldset disabled={submitting}>
        <label>
          Kind{" "}
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
        </label>{" "}
        {needsWithWhom && (
          <WithWhomFields
            kind={kind}
            candidates={candidates}
            neighbors={neighbors}
            allowUnbound={kind === "wedding"}
            onReadyChange={setWithWhomReady}
          />
        )}{" "}
        <label>
          Month{" "}
          <select
            name="month"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              if (event.target.value === "") setDay("");
            }}
          >
            <option value="">—</option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Day{" "}
          <select
            name="day"
            value={day}
            disabled={month === ""}
            onChange={(event) => setDay(event.target.value)}
          >
            <option value="">—</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Year{" "}
          <input
            type="number"
            name="year"
            value={year}
            onChange={(event) => setYear(event.target.value)}
            placeholder="—"
          />
        </label>{" "}
        <label>
          {kind === "other" ? "Label" : "Note"}{" "}
          <input
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={kind === "other" ? "e.g. Adoption day" : "optional"}
            required={kind === "other"}
          />
        </label>
        {dayWithoutMonth && <p>Pick a month before a day, or clear the day.</p>}
        <p>
          {kindDefs[kind].icon ? `${kindDefs[kind].icon} ` : ""}
          {kindDefs[kind].label}
        </p>
        {/* The staggered-reminder schedule, serialised to a hidden field the
            route action reads (the controlled-field-with-a-name pattern). */}
        <ReminderScheduleFields value={schedule} onChange={onScheduleChange} />
        <input
          type="hidden"
          name="reminderSchedule"
          value={JSON.stringify(schedule)}
        />
      </fieldset>
    </Form>
  );
}
