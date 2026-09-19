import type { HolidayDetail, HolidayObserverCandidate } from "@leapsake/core";
import { formatOccurrence } from "@leapsake/schema";
import { useMessages } from "@leapsake/ui/messages";
import { Breadcrumbs, MultiAddCombobox } from "@leapsake/ui/web";
import { useRef, useState } from "react";
import { Form, Link, useLoaderData, useRevalidator } from "react-router-dom";

/**
 * One holiday's dates and observers. No edit: a catalog holiday is read-only,
 * and a user hides it and makes their own instead.
 */
export function HolidayView() {
  const { holiday, candidates } = useLoaderData() as {
    holiday: HolidayDetail;
    candidates: HolidayObserverCandidate[];
  };
  const revalidator = useRevalidator();
  // The screen's own copy is still English inline; these two are the shared
  // combobox announcements, which the package no longer hardcodes.
  const messages = useMessages();

  // Suggestions exclude current observers, so nobody is added twice.
  const observers = candidates.filter((c) => c.observes);
  const addable = candidates.filter((c) => !c.observes);

  // Queued `window.api` calls, not a fetcher: a new fetcher submission cancels
  // one in flight, so fast picks would be dropped.
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setObserves(candidate: HolidayObserverCandidate, observes: boolean) {
    setBusy(true);
    setError(null);
    // Without the `catch`, one rejected write would wedge every later pick.
    inFlight.current = inFlight.current
      .then(() =>
        window.api.holidays.setObservers(holiday.id, [
          {
            bearerType: candidate.bearerType,
            bearerId: candidate.bearerId,
            observes,
          },
        ]),
      )
      .then(
        () => revalidator.revalidate(),
        (e: unknown) => setError(String(e)),
      )
      .finally(() => setBusy(false));
  }

  return (
    <main>
      <Breadcrumbs
        trail={[
          { label: "Holidays", href: "/holidays" },
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
        // A table run out, or a rule this build can't read: never guess.
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
      {error !== null && <p>Couldn't save: {error}</p>}
      {candidates.length === 0 ? (
        <p>Add some people first, then come back to say who celebrates.</p>
      ) : (
        <MultiAddCombobox
          label={`Add someone who observes ${holiday.name}`}
          placeholder="Add someone…"
          options={addable}
          getKey={(c) => `${c.bearerType}:${c.bearerId}`}
          getLabel={(c) => c.label}
          renderOption={(c) => (
            <>
              {c.label}
              {c.bearerType === "pet" && " (pet)"}
            </>
          )}
          onPick={(c) => setObserves(c, true)}
          announceAdded={messages.combobox.added}
          announceCount={messages.combobox.suggestionCount}
        />
      )}

      {observers.length === 0 ? (
        <p>No one yet.</p>
      ) : (
        // Rules belong to each observance, so each observer has a schedule.
        <ul>
          {observers.map((observer) => (
            <li key={`${observer.bearerType}:${observer.bearerId}`}>
              <Link
                to={`/holidays/${holiday.id}/observers/${observer.bearerType}/${observer.bearerId}`}
              >
                {observer.label}
              </Link>
              {observer.bearerType === "pet" && " (pet)"}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => setObserves(observer, false)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
