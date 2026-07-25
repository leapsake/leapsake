import type { HolidayListItem } from "@leapsake/core";
import { formatOccurrence } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";

/**
 * The holiday catalog: what Leapsake knows about, when each one next falls, and
 * how many people the user has attached to it. The entry point to the observer
 * picker, which is where the feature actually gets its data.
 *
 * Hidden holidays stay listed (sorted last, and marked) rather than being
 * filtered out — this screen is the only place to unhide one, so removing them
 * would strand them.
 */
export function HolidayList() {
  const holidays = useLoaderData() as HolidayListItem[];

  return (
    <main>
      <header>
        <h1>Holidays</h1>
      </header>

      {holidays.length === 0 && <p>No holidays yet.</p>}

      {holidays.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Holiday</th>
              <th>Next</th>
              <th>Observed by</th>
            </tr>
          </thead>
          <tbody>
            {holidays.map((holiday) => (
              <tr key={holiday.id}>
                <td>
                  <Link to={`/holidays/${holiday.id}`}>{holiday.name}</Link>
                  {holiday.hidden && " (hidden)"}
                </td>
                <td>
                  {holiday.nextOccurrence === null
                    ? "—"
                    : formatOccurrence(holiday.nextOccurrence)}
                </td>
                <td>
                  {holiday.observerCount === 0
                    ? "—"
                    : `${holiday.observerCount} ${
                        holiday.observerCount === 1 ? "person" : "people"
                      }`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
