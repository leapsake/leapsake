import type { HolidayDetail } from "@leapsake/core";
import type { ReminderRuleInput } from "@leapsake/schema";
import { Breadcrumbs, ReminderScheduleFields } from "@leapsake/ui/web";
import { useState } from "react";
import { Form, useLoaderData } from "react-router-dom";

/**
 * One observer's reminder rules for one holiday. Observances start with every
 * action off, so nothing is reminded until a rule is switched on here.
 */
export function HolidayObservanceSchedule() {
  const { holiday, label, bearerType, bearerId, schedule } =
    useLoaderData() as {
      holiday: HolidayDetail;
      label: string;
      bearerType: "person" | "pet";
      bearerId: string;
      schedule: ReminderRuleInput[];
    };

  const [rules, setRules] = useState<ReminderRuleInput[]>(schedule);

  return (
    <main>
      <Breadcrumbs
        trail={[
          { label: "Holidays", href: "/holidays" },
          { label: holiday.name, href: `/holidays/${holiday.id}` },
          { label },
        ]}
      />

      <header>
        <h1>
          {label} — {holiday.name}
        </h1>
        {holiday.hidden && (
          <p>
            This holiday is hidden, so these reminders won't be generated until
            it is unhidden.
          </p>
        )}
      </header>

      <Form method="post">
        <ReminderScheduleFields
          value={rules}
          onChange={setRules}
          emptyText={`No reminders for ${label} at ${holiday.name}.`}
        />
        {/* Serialised to a hidden field the route action reads — the same
            controlled-field-with-a-name pattern MilestoneForm uses. */}
        <input
          type="hidden"
          name="reminderSchedule"
          value={JSON.stringify(rules)}
        />
        <input type="hidden" name="bearerType" value={bearerType} />
        <input type="hidden" name="bearerId" value={bearerId} />
        <button type="submit">Save reminders</button>
      </Form>
    </main>
  );
}
