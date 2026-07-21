import type { HolidayDetail } from "@leapsake/core";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { formatOccurrence } from "./HolidayList";

/**
 * One holiday: when it next falls, the dates after that, and (once the observer
 * picker lands) who observes it.
 *
 * There is no edit affordance, and that is the design rather than an omission —
 * a catalog holiday is read-only, and a user who wants a different Mother's Day
 * hides this one and creates their own (holidays/research.md §2.6). That keeps a
 * user's edit from ever losing to, or blocking, a catalog update.
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
        {holiday.hidden && <p>This holiday is hidden.</p>}
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
    </main>
  );
}
