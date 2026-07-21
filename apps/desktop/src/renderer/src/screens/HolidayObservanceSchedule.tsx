import type { HolidayDetail } from "@leapsake/core";
import type { ReminderRuleInput } from "@leapsake/schema";
import { useState } from "react";
import { Form, useLoaderData } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ReminderScheduleFields } from "../components/ReminderScheduleFields";

/**
 * One person's reminder schedule for one holiday — "what should Leapsake remind
 * me about for Alice at Christmas?"
 *
 * This is the screen that makes the feature do anything. Observances ship with
 * every action **off** (holidays all land on the same day, so a default-on wish
 * would flood late November), so saying someone celebrates a holiday records the
 * fact but generates nothing until a rule is switched on here.
 *
 * It is per-*observance* rather than per-holiday because the rule's bearer is
 * the observance (holidays/research.md §1): that is exactly what lets "gift
 * Alice 30 days before Christmas" and "just call Grandma day-of" coexist under
 * one holiday.
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
          { label: "Holidays", to: "/holidays" },
          { label: holiday.name, to: `/holidays/${holiday.id}` },
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
