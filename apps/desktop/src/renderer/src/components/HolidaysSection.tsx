import type { BearerHolidayCandidate } from "@leapsake/core";
import type { ObservanceBearerType } from "@leapsake/schema";
import { useRef, useState } from "react";
import { Link, useRevalidator } from "react-router-dom";
import { formatOccurrence } from "../screens/HolidayList";
import { MultiAddCombobox } from "./MultiAddCombobox";

/**
 * The Holidays section on a Person or Pet screen — the mirror of the "Observed
 * by" field on a holiday. Adding an observance from either direction writes the
 * same row, so which surface a user reaches for is purely a matter of what they
 * happen to be looking at.
 *
 * Each row links to that observance's reminder schedule rather than editing
 * anything here, because the reminder rule bears on the *observance*: two people
 * who observe the same holiday can be reminded about entirely different things.
 */
export function HolidaysSection({
  bearerType,
  bearerId,
  holidays,
}: {
  bearerType: ObservanceBearerType;
  bearerId: string;
  holidays: BearerHolidayCandidate[];
}) {
  const revalidator = useRevalidator();

  const observed = holidays.filter((h) => h.observes);
  // Hidden holidays are excluded from *suggestions* because offering one would
  // be offering a no-op — a hidden holiday generates no reminders, so adding an
  // observance to it would appear to do nothing. The browse list deliberately
  // differs: that is where a user goes to unhide one, so filtering them out
  // there would strand them. A hidden holiday already observed still shows in
  // the list below, marked, or the state would be unexplainable.
  const addable = holidays.filter((h) => !h.observes && !h.hidden);

  // Serialised writes + direct `window.api`, for the same reason as HolidayView:
  // a fetcher submission started mid-flight supersedes the previous one, which
  // would silently drop a pick during rapid type→Enter→type→Enter.
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setObserves(holidayId: string, observes: boolean) {
    setBusy(true);
    setError(null);
    // The `catch` is what keeps the queue alive: without it a single rejected
    // write would leave `inFlight` rejected, and every later pick would chain
    // off it and never run — the field would wedge with no visible cause.
    inFlight.current = inFlight.current
      .then(() =>
        window.api.holidays.setObservers(holidayId, [
          { bearerType, bearerId, observes },
        ]),
      )
      .then(
        () => revalidator.revalidate(),
        (e: unknown) => setError(String(e)),
      )
      .finally(() => setBusy(false));
  }

  return (
    <section>
      <header>
        <h2>Holidays</h2>
      </header>

      {error !== null && <p>Couldn't save: {error}</p>}

      <MultiAddCombobox
        label={`Add a holiday this ${bearerType} observes`}
        placeholder="Add a holiday…"
        options={addable}
        getKey={(h) => h.id}
        getLabel={(h) => h.name}
        onPick={(h) => setObserves(h.id, true)}
      />

      {observed.length === 0 ? (
        <p>No holidays yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Holiday</th>
              <th>Next</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {observed.map((holiday) => (
              <tr key={holiday.id}>
                <td>
                  {holiday.name}
                  {holiday.hidden && " (hidden)"}
                </td>
                <td>
                  {holiday.nextOccurrence === null
                    ? "—"
                    : formatOccurrence(holiday.nextOccurrence)}
                </td>
                <td>
                  <Link
                    to={`/holidays/${holiday.id}/observers/${bearerType}/${bearerId}`}
                  >
                    Reminders
                  </Link>{" "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setObserves(holiday.id, false)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
