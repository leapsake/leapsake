import {
  type ReminderAction,
  type ReminderRuleInput,
  actionDefs,
  reminderActionSchema,
} from "@leapsake/schema";

/** The action options in registry order, for the per-row picker. */
const ACTIONS = reminderActionSchema.options;

/**
 * The staggered-reminder editor for a milestone: a list of rules, each an action
 * (get a gift, send a card…) some number of days before the milestone, on or
 * off. Seeded from the milestone kind's defaults (or the milestone's stored
 * rules when editing); the parent {@link MilestoneForm} serialises `value` to a
 * hidden field the route action reads. Controlled — every edit calls `onChange`
 * with the next array.
 *
 * `other` reveals a free-text label (the reminder's wording), mirroring how the
 * `other` milestone kind reveals its note. This increment only stores the
 * schedule; the reminder engine consumes it in a later increment.
 */
export function ReminderScheduleFields({
  value,
  onChange,
}: {
  value: ReminderRuleInput[];
  onChange: (next: ReminderRuleInput[]) => void;
}) {
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
      <legend>Reminders</legend>
      {value.length === 0 ? (
        <p>No reminders for this milestone.</p>
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
                On
              </label>{" "}
              <select
                aria-label="Reminder action"
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
                  aria-label="Reminder label"
                  value={rule.label ?? ""}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="e.g. Send flowers"
                  required
                />
              )}{" "}
              <label>
                <input
                  type="number"
                  min={0}
                  aria-label="Days before"
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
                days before
              </label>{" "}
              <button type="button" onClick={() => remove(i)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={add}>
        Add reminder
      </button>
    </fieldset>
  );
}
