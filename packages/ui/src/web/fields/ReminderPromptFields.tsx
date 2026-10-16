import {
  type OfferContext,
  type ReminderRuleInput,
  actionDefOf,
  leadTimeLabel,
  promptItemLabel,
  promptItemsOf,
  setPromptItem,
} from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";

/**
 * The prompt's answer form: a checkbox per offer with its lead time. Hands back
 * the whole set, so “chose nothing” stays visible.
 */
export function ReminderPromptFields({
  value,
  offer,
  onChange,
}: {
  value: readonly ReminderRuleInput[];
  /** The occasion and whose it is, which the labels may name. */
  offer: OfferContext;
  onChange: (next: ReminderRuleInput[]) => void;
}) {
  const m = useMessages();

  return (
    // Labelled, not captioned: the surrounding heading already asks it.
    <fieldset aria-label={m.reminderPrompt.legend}>
      <p>{m.reminderPrompt.caption}</p>
      <ul>
        {promptItemsOf(value).map(({ index, rule }) => {
          const def = actionDefOf(rule.action);
          const label = promptItemLabel(rule, offer);
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
    </fieldset>
  );
}
