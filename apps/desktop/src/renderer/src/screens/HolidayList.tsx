import type { HolidayListItem } from "@leapsake/core";
import { formatOccurrence } from "@leapsake/schema";
import { useMessages } from "@leapsake/ui/messages";
import { Link, useLoaderData } from "react-router-dom";

/**
 * The catalog, each holiday's next date and observer count. Hidden holidays
 * stay listed, last and marked, since only here can one be unhidden.
 */
export function HolidayList() {
  const holidays = useLoaderData() as HolidayListItem[];
  const m = useMessages();

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
                    ? m.common.none
                    : m.holidays.observerCount(holiday.observerCount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
