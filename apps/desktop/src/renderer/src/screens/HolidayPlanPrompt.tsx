import type { HolidayPrompt } from "@leapsake/core";
import {
  actionKeyOf,
  formatDueIn,
  formatOccurrence,
  holidayPlanQuestion,
} from "@leapsake/schema";
import { useMessages } from "@leapsake/ui/messages";
import { Form, Link, useActionData, useLoaderData } from "react-router-dom";

const TEXT = { cancel: "Cancel", stopAsking: "Don’t ask again…" } as const;

/** The key a wish checkbox and an added observer post under. */
export function bearerKeyOf(b: { bearerType: string; bearerId: string }) {
  return `${b.bearerType}:${b.bearerId}`;
}

/**
 * A holiday's question: your errands, then everyone else on one collapsed wish
 * line. Posts the ticks by name; the action rebuilds the answer from them.
 */
export function HolidayPlanPrompt() {
  const { prompt } = useLoaderData() as { prompt: HolidayPrompt };
  const result = useActionData() as { needsYou?: boolean } | undefined;
  const m = useMessages();
  const people = [...prompt.wishes, ...prompt.addable]
    .filter((p) => p.bearerType === "person")
    .sort((a, b) => a.label.localeCompare(b.label));
  const offersWishes = prompt.wishes.length + prompt.addable.length > 0;

  return (
    <main>
      <h1>{holidayPlanQuestion(prompt.name)}</h1>
      <p>
        {m.holidayPrompt.when(
          prompt.name,
          formatOccurrence(prompt.occurrence),
          formatDueIn(prompt.occurrenceDate),
        )}
      </p>
      {result?.needsYou === true && (
        <p role="alert">{m.holidayPrompt.youFirst}</p>
      )}
      <Form method="post">
        {prompt.errands.length > 0 && (
          <fieldset>
            <legend>{m.holidayPrompt.forYou}</legend>
            {prompt.selfId === null && (
              <p>
                <label>
                  {m.holidayPrompt.whichIsYou}{" "}
                  <select name="you" defaultValue="">
                    <option value="">{m.common.none}</option>
                    {people.map((p) => (
                      <option key={p.bearerId} value={p.bearerId}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              </p>
            )}
            {prompt.errands.map((errand) => (
              <p key={actionKeyOf(errand)}>
                <label>
                  <input
                    type="checkbox"
                    name="errand"
                    value={errand.label ?? ""}
                    defaultChecked={errand.enabled}
                  />{" "}
                  {errand.label}
                </label>
              </p>
            ))}
            <input
              type="text"
              name="somethingElse"
              aria-label={m.reminderPrompt.somethingElse}
              placeholder={m.reminderPrompt.somethingElse}
            />
          </fieldset>
        )}
        {offersWishes && (
          <details>
            <summary>{m.holidayPrompt.wishLine(prompt.greeting)}</summary>
            {prompt.wishes.map((w) => (
              <p key={bearerKeyOf(w)}>
                <label>
                  <input
                    type="checkbox"
                    name="wish"
                    value={bearerKeyOf(w)}
                    defaultChecked={w.wish}
                  />{" "}
                  {w.label}
                </label>
              </p>
            ))}
            {prompt.addable.length > 0 && (
              <label>
                {m.holidayPrompt.addSomeone}{" "}
                <select name="add" multiple size={4}>
                  {prompt.addable.map((c) => (
                    <option key={bearerKeyOf(c)} value={bearerKeyOf(c)}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </details>
        )}
        {prompt.errands.length === 0 && !offersWishes && (
          <p>{m.holidayPrompt.nothingLeft}</p>
        )}
        <button type="submit">{m.holidayPrompt.save}</button>{" "}
        <Link
          to={`/holidays/${prompt.holidayId}/stop-asking?reminder=${prompt.reminderId}`}
        >
          {TEXT.stopAsking}
        </Link>{" "}
        <Link to="/reminders">{TEXT.cancel}</Link>
      </Form>
    </main>
  );
}
