import type { HolidayDetail } from "@leapsake/core";
import { Form, Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { formatOccurrence } from "./HolidayList";

/**
 * One holiday: when it next falls, the dates after that, and who observes it.
 *
 * There is no edit affordance, and that is the design rather than an omission —
 * a catalog holiday is read-only, and a user who wants a different Mother's Day
 * hides this one and creates their own (holidays/research.md §2.6). That keeps a
 * user's edit from ever losing to, or blocking, a catalog update, with no fork
 * mechanism or lineage tracking to maintain.
 */
export function HolidayView() {
  const holiday = useLoaderData() as HolidayDetail;

  return (
    <main>
      <Breadcrumbs
        trail={[
          { label: "Holidays", to: "/holidays" },
          { label: holiday.name },
        ]}
      />

      <header>
        <h1>{holiday.name}</h1>
        {holiday.hidden && (
          <p>
            This holiday is hidden — it produces no reminders. Your saved
            answers about who observes it are kept.
          </p>
        )}
        <Form method="post">
          <input
            type="hidden"
            name="hidden"
            value={holiday.hidden ? "false" : "true"}
          />
          <button type="submit">
            {holiday.hidden ? "Unhide this holiday" : "Hide this holiday"}
          </button>
        </Form>
      </header>

      <h2>Upcoming</h2>
      {holiday.upcoming.length === 0 ? (
        // An honest empty state: a precomputed holiday past its date table, or a
        // rule this build doesn't understand, reports nothing rather than
        // guessing a date.
        <p>No upcoming dates are known for this holiday.</p>
      ) : (
        <ul>
          {holiday.upcoming.map((iso) => (
            <li key={iso}>
              {formatOccurrence(iso)}
              {holiday.durationDays !== null &&
                holiday.durationDays > 1 &&
                ` (${holiday.durationDays} days)`}
            </li>
          ))}
        </ul>
      )}

      <h2>Observed by</h2>
      <p>
        {holiday.observerCount === 0
          ? "No one yet."
          : `${holiday.observerCount} ${
              holiday.observerCount === 1 ? "person" : "people"
            }.`}
      </p>
      <p>
        <Link to={`/holidays/${holiday.id}/observers`}>
          {holiday.observerCount === 0
            ? "Choose who celebrates this"
            : "Change who celebrates this"}
        </Link>
      </p>
    </main>
  );
}
