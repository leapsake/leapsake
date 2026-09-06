import {
  type ReminderRuleInput,
  actionDefOf,
  leadTimeLabel,
  promptGroupsOf,
  setPromptDelivery,
  setPromptItem,
} from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";

/**
 * The prompt's answer form: one checkbox per thing you might do, each wearing
 * its lead time, and — once something it could deliver is on — a single *in
 * person or by mail?* for the whole occasion.
 *
 * Deliberately **not** {@link ReminderScheduleFields}, though they write the same
 * rows. That editor is for someone who has decided to tune a schedule — it
 * offers lead times, an action picker, add and remove, and it lists every rule
 * flat, posting included. This is asked of someone who has not decided anything
 * yet, eight weeks before a birthday, and its whole value is that answering it
 * is nearly free. Every control it does not have is the point.
 *
 * The labels are `actionDefOf(...).label` **verbatim** rather than new copy. That
 * registry was written as offers — "Send a card", "Get a gift" — for the
 * schedule editor, which is the same list asked at a different moment. The lead
 * time beside each is the rule's own `offsetDays`, said out loud because it is
 * what a tick actually buys; moving one is still the full editor's job.
 *
 * Controlled, like its sibling: every tick calls `onChange` with the next array,
 * and the parent decides how it is submitted. It hands back the **whole** set
 * with `enabled` flipped, never just the ticks — rows existing is what makes
 * "asked, and chose nothing" distinguishable from "never asked". Every edit goes
 * through {@link setPromptItem} / {@link setPromptDelivery}, so the rule that a
 * posting cannot outlive the thing it posts lives in the model, once, for both
 * clients.
 */
export function ReminderPromptFields({
  value,
  onChange,
}: {
  value: readonly ReminderRuleInput[];
  onChange: (next: ReminderRuleInput[]) => void;
}) {
  const m = useMessages();
  const { items, delivery } = promptGroupsOf(value);

  return (
    // Labelled, not captioned: the surface that renders this already asks the
    // question as its heading — the prompt screen on desktop, the reminder's own
    // title on mobile — so a visible legend would say the same sentence twice.
    <fieldset aria-label={m.reminderPrompt.legend}>
      <p>{m.reminderPrompt.caption}</p>
      <ul>
        {items.map(({ index, rule }) => {
          const def = actionDefOf(rule.action);
          return (
            // Positional, like the schedule editor: no stable id until saved.
            <li key={index}>
              <label>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) =>
                    onChange(setPromptItem(value, index, e.target.checked))
                  }
                />{" "}
                {def.icon ? `${def.icon} ` : ""}
                {def.label} <small>{leadTimeLabel(rule.offsetDays)}</small>
              </label>
            </li>
          );
        })}
      </ul>
      {delivery?.visible === true && (
        // A radio group rather than a "post it" checkbox: handing it over is a
        // real answer and deserves to be said, not left as the absence of a tick.
        <fieldset>
          <legend>{m.reminderPrompt.deliveryLegend}</legend>
          <label>
            <input
              type="radio"
              name="prompt-delivery"
              checked={!delivery.mailed}
              onChange={() => onChange(setPromptDelivery(value, false))}
            />{" "}
            {m.reminderPrompt.deliveryHand}
          </label>{" "}
          <label>
            <input
              type="radio"
              name="prompt-delivery"
              checked={delivery.mailed}
              onChange={() => onChange(setPromptDelivery(value, true))}
            />{" "}
            {m.reminderPrompt.deliveryMail}
          </label>
          {/* Only when posting, and only when the deliveries it governs agree on
              a date — a note that had to name two would be describing a
              distinction the single control does not offer. */}
          {delivery.mailed && delivery.offsetDays !== null && (
            <p>
              <small>
                {m.reminderPrompt.deliveryNote(
                  leadTimeLabel(delivery.offsetDays),
                )}
              </small>
            </p>
          )}
        </fieldset>
      )}
    </fieldset>
  );
}
