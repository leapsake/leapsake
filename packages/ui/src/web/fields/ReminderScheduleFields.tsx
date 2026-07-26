import {
  type ReminderAction,
  type ReminderRuleInput,
  actionDefs,
  reminderActionSchema,
} from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";

/** The action options in registry order, for the per-row picker. */
const ACTIONS = reminderActionSchema.options;

/**
 * The staggered-reminder editor: a list of rules, each an action (get a gift,
 * send a card…) some number of days before an occurrence, on or off. Controlled
 * — every edit calls `onChange` with the next array — and the parent serialises
 * `value` to a hidden field the route action reads.
 *
 * Shared by both things a reminder rule can bear on: a **milestone** (seeded
 * from its kind's defaults) and a **holiday observance** (seeded from the
 * observance defaults, where nothing is on until the user says so). The bearer
 * is entirely the parent's concern; this component only knows about rules.
 *
 * `other` reveals a free-text label (the reminder's wording), mirroring how the
 * `other` milestone kind reveals its note.
 */
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
  const add = () =>
    onChange([
      ...value,
      { action: "call", label: null, offsetDays: 7, enabled: true },
    ]);

  return (
    <fieldset>
      <legend>{m.reminderSchedule.legend}</legend>
      {value.length === 0 ? (
        <p>{emptyText ?? m.reminderSchedule.emptyForMilestone}</p>
      ) : (
        <ul>
          {value.map((rule, i) => (
            // Rows are positional (no stable id until saved), so the index is the key.
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
                  // Entering `other` needs an editable label; leaving it clears one.
                  update(i, {
                    action,
                    label: action === "other" ? (rule.label ?? "") : null,
                  });
                }}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {actionDefs[a].icon ? `${actionDefs[a].icon} ` : ""}
                    {actionDefs[a].label}
                  </option>
                ))}
              </select>{" "}
              {rule.action === "other" && (
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
