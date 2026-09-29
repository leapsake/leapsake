import {
  type ReminderRuleInput,
  actionDefOf,
  leadTimeLabel,
  offerLabel,
  promptGroupsOf,
  setPromptDelivery,
  setPromptItem,
} from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";

/**
 * The prompt's answer form: a checkbox per offer with its lead time, and one
 * delivery choice. Hands back the whole set, so “chose nothing” stays visible.
 */
export function ReminderPromptFields({
  value,
  greeting,
  onChange,
}: {
  value: readonly ReminderRuleInput[];
  /** The occasion's greeting, "a happy birthday", which the labels may name. */
  greeting: string;
  onChange: (next: ReminderRuleInput[]) => void;
}) {
  const m = useMessages();
  const { items, delivery } = promptGroupsOf(value);

  return (
    // Labelled, not captioned: the surrounding heading already asks it.
    <fieldset aria-label={m.reminderPrompt.legend}>
      <p>{m.reminderPrompt.caption}</p>
      <ul>
        {items.map(({ index, rule }) => {
          const def = actionDefOf(rule.action);
          const label = offerLabel(rule.action, greeting);
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
                {label} <small>{leadTimeLabel(rule.offsetDays)}</small>
              </label>
            </li>
          );
        })}
      </ul>
      {delivery?.visible === true && (
        // A radio group, since handing it over is a real answer.
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
          {/* Only when posting, and the deliveries it governs share a date. */}
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
