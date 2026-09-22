import { useState } from "react";
import { Form, Link, useLoaderData } from "react-router-dom";
import type { PlanReminderTarget } from "@leapsake/core";
import {
  type ReminderRuleInput,
  formatDueIn,
  isoFromDueMs,
  kindDefs,
  planQuestion,
} from "@leapsake/schema";
import { ReminderPromptFields } from "@leapsake/ui/web";

/**
 * The offered actions as checkboxes. Posts the whole offer set, never just the
 * ticks, so "chose nothing" stays distinct from "never asked".
 */
export function MilestonePlanPrompt() {
  const { target } = useLoaderData() as { target: PlanReminderTarget };
  const [schedule, setSchedule] = useState<ReminderRuleInput[]>(target.offers);

  const occasion =
    kindDefs[target.milestoneKind].prompt?.occasion ??
    kindDefs[target.milestoneKind].label.toLowerCase();

  return (
    <main>
      {/* The row's own title helper, so the question reads the same. */}
      <h1>{planQuestion({ ...target, occasion })}</h1>
      {/* The row counted down to the prompt's deadline, weeks early, so the
          occasion's real date is said here. */}
      {target.occurrenceDate !== null && (
        <p>
          {target.subjectIsSelf || target.shared ? "Your" : "Their"} {occasion}{" "}
          is on {isoFromDueMs(target.occurrenceDate)} (
          {formatDueIn(target.occurrenceDate)}).
        </p>
      )}
      <Form method="post">
        <ReminderPromptFields
          value={schedule}
          greeting={kindDefs[target.milestoneKind].greeting}
          onChange={setSchedule}
        />
        <input
          type="hidden"
          name="reminderSchedule"
          value={JSON.stringify(schedule)}
        />
        <button type="submit">Save</button> <Link to="/reminders">Cancel</Link>
      </Form>
    </main>
  );
}
