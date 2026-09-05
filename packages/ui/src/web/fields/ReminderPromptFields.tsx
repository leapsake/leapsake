import { type ReminderRuleInput, actionDefOf } from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";

/**
 * The prompt's answer form: one checkbox per offered action, and nothing else.
 *
 * Deliberately **not** {@link ReminderScheduleFields}, though they write the same
 * rows. That editor is for someone who has decided to tune a schedule — it
 * offers lead times, an action picker, add and remove. This is asked of someone
 * who has not decided anything yet, eight weeks before a birthday, and its whole
 * value is that answering it is nearly free. Every control it does not have is
 * the point; the timings are the ones the actions already declare, and the full
 * editor is a link away for the rare user who wants to move one.
 *
 * The labels are `actionDefOf(...).label` **verbatim** rather than new copy. That
 * registry was written as offers — "Send a card", "Give a call" — for the
 * schedule editor, which is the same list asked at a different moment.
 *
 * Controlled, like its sibling: every tick calls `onChange` with the next array,
 * and the parent decides how it is submitted. It hands back the **whole** set
 * with `enabled` flipped, never just the ticks — rows existing is what makes
 * "asked, and chose nothing" distinguishable from "never asked".
 */
export function ReminderPromptFields({
  value,
  onChange,
}: {
  value: readonly ReminderRuleInput[];
  onChange: (next: ReminderRuleInput[]) => void;
}) {
  const m = useMessages();
  const toggle = (index: number, enabled: boolean) =>
    onChange(
      value.map((rule, i) => (i === index ? { ...rule, enabled } : rule)),
    );

  return (
    // Labelled, not captioned: the surface that renders this already asks the
    // question as its heading — the prompt screen on desktop, the reminder's own
    // title on mobile — so a visible legend would say the same sentence twice.
    <fieldset aria-label={m.reminderPrompt.legend}>
      <ul>
        {value.map((rule, i) => {
          const def = actionDefOf(rule.action);
          return (
            // Positional, like the schedule editor: no stable id until saved.
            <li key={i}>
              <label>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => toggle(i, e.target.checked)}
                />{" "}
                {def.icon ? `${def.icon} ` : ""}
                {def.label}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
