import {
  type ReminderAction,
  type ReminderRuleInput,
  SCHEDULABLE_ACTIONS,
  actionDefOf,
  nextSchedulableRule,
  verbOf,
} from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";

/** The actions a user can schedule, in registry order, for the row picker. */
const ACTIONS = SCHEDULABLE_ACTIONS;

/** The schedule editor: rules, each an action some days before an occurrence,
 *  on or off. The bearer, milestone or observance, is the parent's concern. */
export function ReminderScheduleFields({
  value,
  onChange,
  emptyText,
}: {
  value: readonly ReminderRuleInput[];
  onChange: (next: ReminderRuleInput[]) => void;
  /** Copy for the no-rules case; defaults to the milestone wording. */
  emptyText?: string;
}) {
  const m = useMessages();
  const update = (index: number, patch: Partial<ReminderRuleInput>) =>
    onChange(
      value.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  const remove = (index: number) =>
    onChange(value.filter((_, i) => i !== index));
  // Both editors take Add's seed from `@leapsake/schema`, so they agree.
  const add = () => onChange([...value, nextSchedulableRule(value)]);

  return (
    <fieldset>
      <legend>{m.reminderSchedule.legend}</legend>
      {value.length === 0 ? (
        <p>{emptyText ?? m.reminderSchedule.emptyForMilestone}</p>
      ) : (
        <ul>
          {value.map((rule, i) => (
            // Positional: no stable id until saved.
            <li key={i}>
              <label>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => update(i, { enabled: e.target.checked })}
                />{" "}
                {m.reminderSchedule.on}
              </label>{" "}
              <select
                aria-label={m.reminderSchedule.action}
                value={rule.action}
                onChange={(e) => {
                  const action = e.target.value as ReminderAction;
                  // `other` needs an editable label; leaving it clears one.
                  update(i, {
                    action,
                    label:
                      verbOf(action) === "other" ? (rule.label ?? "") : null,
                  });
                }}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {actionDefOf(a).icon ? `${actionDefOf(a).icon} ` : ""}
                    {actionDefOf(a).label}
                  </option>
                ))}
              </select>{" "}
              {verbOf(rule.action) === "other" && (
                <input
                  aria-label={m.reminderSchedule.label}
                  value={rule.label ?? ""}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder={m.reminderSchedule.labelPlaceholder}
                  required
                />
              )}{" "}
              <label>
                <input
                  type="number"
                  min={0}
                  aria-label={m.reminderSchedule.daysBefore}
                  value={rule.offsetDays}
                  onChange={(e) =>
                    update(i, {
                      offsetDays: Math.max(
                        0,
                        Math.trunc(Number(e.target.value) || 0),
                      ),
                    })
                  }
                />{" "}
                {m.reminderSchedule.daysBeforeSuffix}
              </label>{" "}
              <button type="button" onClick={() => remove(i)}>
                {m.common.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={add}>
        {m.reminderSchedule.add}
      </button>
    </fieldset>
  );
}
