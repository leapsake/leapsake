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
 * The prompt's answer form: the offered actions as checkboxes, and Save.
 *
 * Reached from a `🗓 plan` row's "Choose →". Most people never come here — the
 * common answer is the row's own one-tap *Just the day* — so this screen is for
 * the user who wants a card as well, and it should stay as short as that
 * implies. The lead times are the ones each action already declares; moving one
 * is the milestone's full schedule editor, a link away.
 *
 * It posts the **whole** offer set with `enabled` flipped, never just the ticks.
 * Rows existing is what makes "asked, and chose nothing" distinguishable from
 * "never asked", so a partial write would have the question return next year.
 */
export function MilestonePlanPrompt() {
  const { target } = useLoaderData() as { target: PlanReminderTarget };
  const [schedule, setSchedule] = useState<ReminderRuleInput[]>(target.offers);

  const occasion =
    kindDefs[target.milestoneKind].prompt?.occasion ??
    kindDefs[target.milestoneKind].label.toLowerCase();

  return (
    <main>
      {/* The same helper the reminder row's own title goes through, so the
          question cannot be worded one way on Home and another here — and so
          "your first date with Alice" does not become "Alice's first date",
          which says something else entirely. */}
      <h1>{planQuestion({ ...target, occasion })}</h1>
      {/* ⚠️ The row this came from shows the distance to the prompt&rsquo;s own
          deadline — the same convention every reminder row uses, and six weeks
          earlier than the occasion. So the occasion&rsquo;s real date is said
          here, where there is room, rather than left to be inferred. */}
      {target.occurrenceDate !== null && (
        <p>
          {target.subjectIsSelf || target.shared ? "Your" : "Their"} {occasion}{" "}
          is on {isoFromDueMs(target.occurrenceDate)} (
          {formatDueIn(target.occurrenceDate)}).
        </p>
      )}
      <Form method="post">
        <ReminderPromptFields value={schedule} onChange={setSchedule} />
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
