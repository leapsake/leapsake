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

const PEOPLE = { marginInlineStart: "1.75em" } as const;

/** The key a wish checkbox and an added observer post under. */
export function bearerKeyOf(b: { bearerType: string; bearerId: string }) {
  return `${b.bearerType}:${b.bearerId}`;
}

/**
 * A holiday's question: a tick per errand, and one for wishing the people
 * listed under it. The action rebuilds the answer by name.
 */
export function HolidayPlanPrompt() {
  const { prompt } = useLoaderData() as { prompt: HolidayPrompt };
  const result = useActionData() as { needsYou?: boolean } | undefined;
  const m = useMessages();
  const people = [...prompt.wishes, ...prompt.addable]
    .filter((p) => p.bearerType === "person")
    .sort((a, b) => a.label.localeCompare(b.label));
  const offersWishes = prompt.wishes.length + prompt.addable.length > 0;
  const findable = [
    ...prompt.wishes.filter((w) => !w.wish),
    ...prompt.addable,
  ].sort((a, b) => a.label.localeCompare(b.label));

  const wishBlock = offersWishes && (
    <>
      <p>
        <label>
          <input
            type="checkbox"
            name="wishing"
            defaultChecked={prompt.wishes.some((w) => w.wish)}
          />{" "}
          {m.holidayPrompt.wishLine(prompt.greeting)}
        </label>
      </p>
      <div style={PEOPLE}>
        {prompt.wishes
          .filter((w) => w.wish)
          .map((w) => (
            <p key={bearerKeyOf(w)}>
              <label>
                <input
                  type="checkbox"
                  name="wish"
                  value={bearerKeyOf(w)}
                  defaultChecked
                />{" "}
                {w.label}
              </label>
            </p>
          ))}
        {findable.length > 0 && (
          <label>
            {m.holidayPrompt.addSomeone}{" "}
            <select name="add" multiple size={4}>
              {findable.map((c) => (
                <option key={bearerKeyOf(c)} value={bearerKeyOf(c)}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </>
  );

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
        {(prompt.errands.length > 0 || offersWishes) && (
          <p>{m.holidayPrompt.caption}</p>
        )}
        {prompt.errands.length > 0 ? (
          <>
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
            {wishBlock}
            <input
              type="text"
              name="somethingElse"
              aria-label={m.reminderPrompt.somethingElse}
              placeholder={m.reminderPrompt.somethingElse}
            />
          </>
        ) : (
          wishBlock
        )}
        {prompt.errands.length === 0 && !offersWishes && (
          <p>{m.holidayPrompt.nothingLeft}</p>
        )}
        <button type="submit">{m.holidayPrompt.done}</button>{" "}
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
