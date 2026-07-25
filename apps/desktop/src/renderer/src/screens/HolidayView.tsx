import type { HolidayDetail, HolidayObserverCandidate } from "@leapsake/core";
import { formatOccurrence } from "@leapsake/schema";
import { Breadcrumbs, MultiAddCombobox } from "@leapsake/ui/web";
import { useRef, useState } from "react";
import { Form, Link, useLoaderData, useRevalidator } from "react-router-dom";

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
  const { holiday, candidates } = useLoaderData() as {
    holiday: HolidayDetail;
    candidates: HolidayObserverCandidate[];
  };
  const revalidator = useRevalidator();

  // One read serves both halves: who observes it, and who could be added.
  // Excluding current observers from the suggestions is what stops the same
  // person being added twice and shrinks the list as you go.
  const observers = candidates.filter((c) => c.observes);
  const addable = candidates.filter((c) => !c.observes);

  // Writes go straight through `window.api` rather than a route action, and the
  // reason matters: a `useFetcher` submission started while another is still in
  // flight *supersedes* it, so a fast type→Enter→type→Enter would silently drop
  // a pick. Awaiting each call behind this flag cannot. (Direct `window.api`
  // calls are well-precedented in the renderer — SearchBar, MentionTextField and
  // Settings all do it.) Hide/unhide stays on the route action, where a single
  // submit has nothing to race.
  const inFlight = useRef<Promise<void>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setObserves(candidate: HolidayObserverCandidate, observes: boolean) {
    setBusy(true);
    setError(null);
    // The `catch` is what keeps the queue alive: without it a single rejected
    // write would leave `inFlight` rejected, and every later pick would chain
    // off it and never run — the field would wedge with no visible cause.
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
        />
      )}

      {observers.length === 0 ? (
        <p>No one yet.</p>
      ) : (
        // Each observer links to their own schedule, because the reminder rule
        // bears on the observance, not the holiday — which is what lets one
        // person get a gift reminder and another only a day-of call.
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
