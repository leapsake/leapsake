import {
  type Milestone,
  type MilestoneKind,
  type MilestoneSubjectType,
  type RelationshipNeighbor,
  kindDefs,
  kindsForSubjectType,
  preferredSubjectType,
} from "@leapsake/schema";
import { useMemo, useState } from "react";
import { Form, Link, useNavigation } from "react-router-dom";
import type { RelationshipCandidate } from "./RelationshipForm";
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
 * Add/edit form for a milestone, rendered on a subject entity's page. The user
 * picks a kind (constrained to those the subject type can hold) and any subset
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
  subjectType,
  milestone,
  candidates = [],
  neighbors = [],
  cancelTo,
}: {
  subjectType: MilestoneSubjectType;
  milestone?: Milestone;
  candidates?: RelationshipCandidate[];
  neighbors?: RelationshipNeighbor[];
  cancelTo: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const kinds = useMemo(() => kindsForSubjectType(subjectType), [subjectType]);

  const [kind, setKind] = useState<MilestoneKind>(
    milestone?.kind ?? kinds[0]?.kind ?? "birthday",
  );
  const [month, setMonth] = useState(milestone?.month?.toString() ?? "");
  const [day, setDay] = useState(milestone?.day?.toString() ?? "");
  const [year, setYear] = useState(milestone?.year?.toString() ?? "");
  const [note, setNote] = useState(milestone?.note ?? "");
  const [withWhomReady, setWithWhomReady] = useState(false);

  const editing = milestone !== undefined;
  // A relationship kind added from a Person needs the "with whom?" step; for
  // every other case the subject is fixed and the picker stays hidden.
  const needsWithWhom =
    !editing &&
    subjectType === "person" &&
    preferredSubjectType(kind) === "relationship";

  // Mirror the schema rule: a day is only meaningful alongside a month.
  const dayWithoutMonth = day !== "" && month === "";
  const ready = !dayWithoutMonth && (!needsWithWhom || withWhomReady);

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
            onChange={(event) => setKind(event.target.value as MilestoneKind)}
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
      </fieldset>
    </Form>
  );
}
